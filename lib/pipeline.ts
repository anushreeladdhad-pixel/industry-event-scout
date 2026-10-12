import type { Config, Event, RunResult, ScoredEvent } from "./types";
import { collect, defaultCollectors, type Collector } from "./sources";
import { dedupe } from "./dedupe";
import { matchConfiguredCity } from "./cities";
import { classifyDeadline, parseWhen, startsSoonWithoutDeadline } from "./deadline";
import { scoreEvents } from "./scoring";

const DAY = 86_400_000;
const IST_OFFSET = 5.5 * 3_600_000;

/** Midnight (IST) at the start of today - events happening today must still count. */
export function startOfTodayIST(now: Date): Date {
  const shifted = now.getTime() + IST_OFFSET;
  return new Date(Math.floor(shifted / DAY) * DAY - IST_OFFSET);
}

export type RunOptions = {
  now?: Date;
  collectors?: Collector[]; // injectable for tests
  ai?: (prompt: string) => Promise<string>; // injectable for tests
};

export async function runDigest(config: Config, opts: RunOptions = {}): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const stats: RunResult["stats"] = {
    fetched: 0, afterDedupe: 0, droppedNoDate: 0, droppedOutsideWindow: 0, droppedWrongCity: 0,
    droppedDeadlinePassed: 0, droppedLowScore: 0, scoredByGemini: 0, scoredByKeyword: 0,
  };

  // 1. COLLECT from every enabled source (failures isolated, reported in `health`)
  const { events: raw, health } = await collect(opts.collectors ?? defaultCollectors(config, now));
  stats.fetched = raw.length;

  // 2. DEDUPE the same event announced on several platforms
  const unique = dedupe(raw);
  stats.afterDedupe = unique.length;

  // 3. WINDOW: starts between today and today + windowDays (IST). No date => cannot be placed => dropped.
  const lower = startOfTodayIST(now).getTime();
  const upper = lower + (config.windowDays + 1) * DAY;
  const inWindow: Event[] = [];
  for (const e of unique) {
    const s = parseWhen(e.startDate, false);
    if (!s) { stats.droppedNoDate++; continue; }
    const end = parseWhen(e.endDate ?? null, true);
    const t = s.getTime();
    const stillRunning = t < lower && end !== null && end.getTime() >= now.getTime();
    if ((t >= lower || stillRunning) && t < upper) inWindow.push(e);
    else stats.droppedOutsideWindow++;
  }

  // 4. CITY: configured cities (aliases + metro areas understood); online only if opted in
  const inCity: (Event & { matchedCity: string | null })[] = [];
  for (const e of inWindow) {
    const where = `${e.city ?? ""} ${e.venue ?? ""}`;
    const matched = matchConfiguredCity(where, config.cities);
    if (matched) inCity.push({ ...e, matchedCity: matched });
    else if (e.isOnline && config.includeOnline) inCity.push({ ...e, matchedCity: null });
    else stats.droppedWrongCity++;
  }

  // 5. DEADLINE: registration closed => useless, drop. Unknown stays (and is labelled, never "safe").
  const open: (Event & { matchedCity: string | null })[] = [];
  for (const e of inCity) {
    if (e.registrationClosed || classifyDeadline(e.registrationDeadline, now, config.urgentDays).status === "passed") stats.droppedDeadlinePassed++;
    else open.push(e);
  }

  // 6. RANK by match to focus areas (Gemini Flash; keyword fallback so the email always ships)
  const { scores, aiNote } = await scoreEvents(open, config.focusAreas, opts.ai);
  const scored: ScoredEvent[] = [];
  for (const e of open) {
    const sc = scores.get(e.id)!;
    if (sc.by === "gemini") stats.scoredByGemini++; else stats.scoredByKeyword++;
    if (sc.score < config.minScore) { stats.droppedLowScore++; continue; }
    const d = classifyDeadline(e.registrationDeadline, now, config.urgentDays);
    scored.push({
      ...e,
      score: sc.score, matched: sc.matched, reason: sc.reason, scoredBy: sc.by, evidence: sc.evidence,
      deadlineStatus: d.status, daysLeft: d.daysLeft,
      startsSoon: startsSoonWithoutDeadline(e.startDate, e.registrationDeadline, now, config.urgentDays),
    });
  }

  // 7. ASSEMBLE: urgent section (soonest deadline first, never trimmed) + best-match list (capped)
  const urgent = scored.filter((e) => e.deadlineStatus === "urgent").sort((a, b) => (a.daysLeft! - b.daysLeft!) || b.score - a.score);
  const rest = scored
    .filter((e) => e.deadlineStatus !== "urgent")
    .sort((a, b) => b.score - a.score || (parseWhen(a.startDate)!.getTime() - parseWhen(b.startDate)!.getTime()))
    .slice(0, Math.max(0, config.maxEvents - urgent.length));

  return {
    generatedAt: now.toISOString(),
    config,
    urgent,
    events: rest,
    health,
    stats,
    aiNote,
    hasSample: [...urgent, ...rest].some((e) => e.provenance === "sample"),
  };
}
