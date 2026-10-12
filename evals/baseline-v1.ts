/**
 * FROZEN copy of the v1 prompts + validators, kept ONLY so evals can A/B v1 vs v2.
 * Do not import this from app code.
 */
import type { Event, RawEvent } from "../lib/types";
import type { Score } from "../lib/scoring";
import type { TextItem } from "../lib/extract";
import { truncate } from "../lib/util";
import { UNTRUSTED_NOTICE } from "../lib/prompts";

export function scoringPromptV1(batch: Event[], focusAreas: string[]): string {
  const items = batch.map((e) => ({ id: e.id, title: e.title, organiser: e.organiser ?? null, city: e.city ?? null, description: truncate(e.description ?? "", 350) }));
  return `You rank professional events for an independent management consultant who wins clients by meeting senior decision-makers in person.

His focus areas (exact strings):
${focusAreas.map((a, i) => `${i + 1}. ${a}`).join("\n")}

For EACH event return:
- id: copy exactly
- score: 0-100 for how closely the event matches his focus areas AND is a room where prospective clients (CXOs, founders, senior leaders) would be. 85-100 squarely in focus with senior audience; 60-84 strong partial match; 40-59 tangential; 0-39 weak/unrelated (e.g. student, hobby, consumer events).
- matched: which focus areas it matches, copied exactly from the list (empty if none)
- reason: max 20 words, based ONLY on facts in the event text. Do not invent speakers, audience or attendance.

${UNTRUSTED_NOTICE}

EVENTS (JSON):
${JSON.stringify(items)}`;
}

export function validateScoresV1(raw: unknown, batch: Event[], focusAreas: string[]): Map<string, Score> {
  const out = new Map<string, Score>();
  if (!Array.isArray(raw)) return out;
  const ids = new Set(batch.map((e) => e.id));
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r.id !== "string" || !ids.has(r.id)) continue;
    const n = Number(r.score);
    if (!Number.isFinite(n)) continue;
    const matched = Array.isArray(r.matched) ? (r.matched as unknown[]).filter((m): m is string => typeof m === "string" && focusAreas.includes(m)) : [];
    out.set(r.id, { score: Math.max(0, Math.min(100, Math.round(n))), matched, reason: String(r.reason ?? ""), by: "gemini" });
  }
  return out;
}

export function extractionPromptV1(batch: TextItem[], now: Date): string {
  return `Today is ${now.toISOString().slice(0, 10)} (India, IST).
From each item below, decide whether it announces ONE specific upcoming in-person or online professional event, and extract its details.

Rules:
- isUpcomingEvent=false for general articles, recaps of past events, job posts, ads.
- Dates as ISO 8601 (YYYY-MM-DD, or full datetime with offset if a time is given). If the year is missing, use the next occurrence on/after today.
- startDate, registrationDeadline, city, venue, organiser: use null unless the text explicitly states them. NEVER guess or infer a registration deadline.
- Return one object per item, "index" = the item's index.

${UNTRUSTED_NOTICE}

ITEMS (JSON):
${JSON.stringify(batch.map((b, k) => ({ index: k, title: b.title, text: truncate(b.text, 900) })))}`;
}

/** v1 behaviour: trust the model, one event per item, no guards. */
export function validateExtractionV1(raw: unknown, batch: TextItem[]): RawEvent[] {
  const out: RawEvent[] = [];
  if (!Array.isArray(raw)) return out;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  for (const r of raw as Record<string, unknown>[]) {
    const src = batch[Number(r.index)];
    if (!src || r.isUpcomingEvent !== true) continue;
    out.push({ title: s(r.title) ?? src.title, url: src.link, source: src.source, provenance: "ai-extracted", startDate: s(r.startDate), city: s(r.city), venue: s(r.venue), organiser: s(r.organiser), isOnline: r.isOnline === true, description: src.text, registrationDeadline: s(r.registrationDeadline) });
  }
  return out;
}
