import type { RawEvent } from "../lib/types";
import type { Score } from "../lib/scoring";
import { AREAS, EXTRACT_CASES, SCORE_CASES } from "./cases";

export type Check = { id: string; attack: string; pass: boolean; detail: string };

const ORDER_TOLERANCE = 15; // same event must score within +/-15 when its position in the batch changes
const CONSISTENCY_TOLERANCE = 12;

export function gradeScoring(fwd: Map<string, Score>, rev: Map<string, Score>): Check[] {
  const checks: Check[] = [];
  for (const c of SCORE_CASES) {
    const s = fwd.get(c.id);
    const problems: string[] = [];
    if (!s) problems.push("model returned no usable row for this event");
    else {
      if (c.min !== undefined && s.score < c.min) problems.push(`score ${s.score} < min ${c.min}`);
      if (c.max !== undefined && s.score > c.max) problems.push(`score ${s.score} > max ${c.max}`);
      for (const i of c.mustMatch ?? []) if (!s.matched.includes(AREAS[i])) problems.push(`should match area "${AREAS[i]}"`);
      if (c.maxMatched !== undefined && s.matched.length > c.maxMatched) problems.push(`matched ${s.matched.length} areas, max ${c.maxMatched}`);
      if (c.consistentWith) {
        const o = fwd.get(c.consistentWith);
        if (o && Math.abs(o.score - s.score) > CONSISTENCY_TOLERANCE) problems.push(`score ${s.score} differs from ${c.consistentWith} (${o.score}) by > ${CONSISTENCY_TOLERANCE}`);
      }
      const r = rev.get(c.id);
      if (!r) problems.push("missing in reversed-order run");
      else if (Math.abs(r.score - s.score) > ORDER_TOLERANCE) problems.push(`order-sensitive: ${s.score} forward vs ${r.score} reversed`);
    }
    checks.push({ id: c.id, attack: c.attack, pass: problems.length === 0, detail: problems.join("; ") || `score ${s?.score}` });
  }
  return checks;
}

export type ExtractCaseResult = { events: RawEvent[]; rescued: string[] };

/** pass = what would SHIP (after validators). rawClean = the model alone got it right (no guard had to step in). */
export function gradeExtraction(results: Map<string, ExtractCaseResult>): (Check & { rawClean: boolean })[] {
  return EXTRACT_CASES.map((c) => {
    const r = results.get(c.id);
    if (!r) return { id: c.id, attack: c.attack, pass: false, rawClean: false, detail: "no result" };
    const problems = c.check(r.events);
    return { id: c.id, attack: c.attack, pass: problems.length === 0, rawClean: problems.length === 0 && r.rescued.length === 0, detail: problems.join("; ") || (r.rescued.length ? `ok, but guard(s) had to fix the model: ${r.rescued.join(", ")}` : "ok") };
  });
}
