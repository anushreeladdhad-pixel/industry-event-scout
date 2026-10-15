import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { runDigest } from "@/lib/pipeline";
import { renderDigestHtml, subjectLine, deadlineBadge, fmtDate } from "@/lib/digest";
import type { Config, RunResult } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Tiny per-instance cache so repeated page loads don't burn Gemini quota.
let cache: { at: number; key: string; body: unknown } | null = null; // key = the settings used, so saving settings shows up immediately
let inflight: { key: string; p: Promise<unknown> } | null = null; // concurrent requests share ONE pipeline run
const TTL = 5 * 60_000;
const FRESH_MIN_GAP = 30_000; // ?fresh=1 is unauthenticated: it may refresh at most every 30s per instance

export async function GET(req: Request) {
  const wantFresh = new URL(req.url).searchParams.get("fresh") === "1";
  try {
    const config = await loadConfig();
    const key = JSON.stringify(config);
    const age = cache && cache.key === key ? Date.now() - cache.at : Infinity;
    if (cache && cache.key === key && (wantFresh ? age < FRESH_MIN_GAP : age < TTL)) return NextResponse.json(cache.body);
    if (!inflight || inflight.key !== key) {
      const p = build(config, key).finally(() => { if (inflight?.p === p) inflight = null; });
      inflight = { key, p };
    }
    return NextResponse.json(await inflight.p);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unexpected error" }, { status: 500 });
  }
}

async function build(config: Config, key: string) {
  {
    const result: RunResult = await runDigest(config);
    const row = (e: RunResult["events"][number], urgent: boolean) => {
      const b = deadlineBadge(e, result.config.urgentDays);
      return {
        urgent, title: e.title, url: /^https?:\/\//i.test(e.url) ? e.url : "", start: e.startDate, startLabel: fmtDate(e.startDate),
        city: e.matchedCity ?? "Online", venue: e.venue ?? "", organiser: e.organiser ?? "", score: e.score, reason: e.reason,
        badge: b.text, badgeKind: b.kind, daysLeft: e.daysLeft, sources: e.sources.length, sample: e.provenance === "sample", aiFound: e.provenance === "ai-search",
      };
    };
    const rows = [...result.urgent.map((e) => row(e, true)), ...result.events.map((e) => row(e, false))];
    const body = { rows, subject: subjectLine(result), html: renderDigestHtml(result), health: result.health, stats: result.stats, counts: { urgent: result.urgent.length, events: result.events.length }, cities: result.config.cities, aiNote: result.aiNote ?? null, generatedAt: result.generatedAt };
    cache = { at: Date.now(), key, body };
    return body;
  }
}
