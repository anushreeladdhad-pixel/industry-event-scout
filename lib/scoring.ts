import type { Event } from "./types";
import { generate, geminiAvailable, parseJsonLoose } from "./gemini";
import { SCORING_SCHEMA, scoringPrompt } from "./prompts";
import { errMsg, truncate } from "./util";

export type Score = { score: number; matched: string[]; reason: string; by: "gemini" | "keyword"; evidence?: string };

const WORD_STOP = new Set(["and", "the", "for", "with", "from", "into", "that", "this", "events", "event"]);

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !WORD_STOP.has(w));
}

/**
 * Deterministic fallback ranking. Used when Gemini is unavailable or returns garbage, so the
 * Monday email ALWAYS goes out with a sensible (if cruder) ranking instead of failing.
 */
export function keywordScore(ev: Pick<Event, "title" | "description" | "organiser">, focusAreas: string[]): Score {
  const text = `${ev.title} ${ev.description ?? ""} ${ev.organiser ?? ""}`.toLowerCase();
  const matched: string[] = [];
  for (const area of focusAreas) {
    const ws = words(area);
    if (!ws.length) continue;
    const hits = ws.filter((w) => text.includes(w)).length;
    if (hits >= Math.max(1, Math.ceil(ws.length / 3))) matched.push(area);
  }
  const score = matched.length ? Math.min(100, 40 + Math.round((60 * matched.length) / Math.max(1, focusAreas.length))) : 10;
  return {
    score,
    matched,
    reason: matched.length ? `Keyword match: ${matched.join("; ")}` : "No focus-area keywords found",
    by: "keyword",
  };
}

/** Lower-case, collapse whitespace and punctuation so a quote survives trivial formatting drift. */
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

/** Is the model's quote really in the listing? (Catches invented justifications.) */
export function evidenceOk(evidence: unknown, ev: Pick<Event, "title" | "description" | "organiser">): boolean {
  if (typeof evidence !== "string") return false;
  const q = norm(evidence);
  if (q.length < 3) return false;
  return norm(`${ev.title} ${ev.description ?? ""} ${ev.organiser ?? ""}`).includes(q);
}

export const UNVERIFIED_CAP = 50;

/**
 * Turn raw model output into trusted scores. Never throws. Rules:
 *  - rows map back by n (1-based position); unknown / duplicate n are ignored
 *  - scores are clamped; matched areas must be exact members of the configured list
 *  - a score of 40+ must come with a quote that really appears in the listing, otherwise it is capped
 *    at the cap (UNVERIFIED_CAP) and flagged (the model may be hallucinating relevance)
 *  - baselines (v1 prompt) that return `id` instead of `n` are still understood, for A/B evals
 */
export function validateScores(raw: unknown, batch: Event[], focusAreas: string[]): Map<string, Score> {
  const out = new Map<string, Score>();
  if (!Array.isArray(raw)) return out;
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const ev = typeof r.n === "number" ? batch[r.n - 1] : typeof r.id === "string" ? batch.find((e) => e.id === r.id) : undefined;
    if (!ev || out.has(ev.id)) continue;
    const num = Number(r.score);
    if (!Number.isFinite(num)) continue;
    let score = Math.max(0, Math.min(100, Math.round(num)));
    const matched = Array.isArray(r.matched) ? (r.matched as unknown[]).filter((m): m is string => typeof m === "string" && focusAreas.includes(m)) : [];
    let reason = truncate(typeof r.reason === "string" && r.reason.trim() ? r.reason.trim() : "Matched by AI", 160);
    const verified = evidenceOk(r.evidence, ev);
    if (score >= 40 && !verified) {
      score = Math.min(score, UNVERIFIED_CAP);
      reason = truncate(`${reason} (match not verifiable from the listing text)`, 180);
    }
    out.set(ev.id, { score, matched, reason, by: "gemini", evidence: verified ? (r.evidence as string) : undefined });
  }
  return out;
}

export type ScoreRun = { scores: Map<string, Score>; aiNote?: string };

/** Score every event. Gemini first; per-event keyword fallback for anything Gemini didn't return. */
export async function scoreEvents(
  events: Event[],
  focusAreas: string[],
  ai?: (prompt: string) => Promise<string> // injectable so tests never hit the network
): Promise<ScoreRun> {
  const scores = new Map<string, Score>();
  let aiNote: string | undefined;
  const runner = ai ?? (geminiAvailable() ? async (p: string) => (await generate({ prompt: p, schema: SCORING_SCHEMA })).text : null);
  const canUseAi = runner !== null;

  if (!runner) aiNote = "GEMINI_API_KEY not set - ranked by keyword match instead of AI.";
  else {
    const BATCH = 20;
    const CONCURRENCY = 3; // a few batches at once: the cold load drops from ~45s to ~15s without hammering the API
    const batches: Event[][] = [];
    for (let i = 0; i < events.length; i += BATCH) batches.push(events.slice(i, i + BATCH));
    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        try {
          const text = await runner(scoringPrompt(batch, focusAreas));
          for (const [k, v] of validateScores(parseJsonLoose(text), batch, focusAreas)) scores.set(k, v);
        } catch (e) {
          aiNote = `Gemini scoring failed for part of the list (${errMsg(e)}); used keyword ranking for those.`;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  }
  for (const e of events) if (!scores.has(e.id)) scores.set(e.id, keywordScore(e, focusAreas));
  const missing = events.filter((e) => scores.get(e.id)?.by === "keyword").length;
  if (canUseAi && missing && !aiNote) aiNote = `${missing} event(s) ranked by keyword fallback (Gemini omitted them).`;
  return { scores, aiNote };
}
