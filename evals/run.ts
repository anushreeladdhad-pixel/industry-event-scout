/**
 * Prompt evaluation harness.
 *   npx tsx evals/run.ts live   [v1|v2]        run against Gemini Flash (needs GEMINI_API_KEY)
 *   npx tsx evals/run.ts dump   <dir> [v1|v2]  write prompt files (to run them through any model by hand)
 *   npx tsx evals/run.ts replay <dir> [v1|v2]  grade saved model outputs (<name>.out.json)
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { AREAS, EXTRACT_CASES, NOW, SCORE_CASES, toEvent } from "./cases";
import { gradeExtraction, gradeScoring, type Check, type ExtractCaseResult } from "./grade";
import { scoringPromptV1, validateScoresV1, extractionPromptV1, validateExtractionV1 } from "./baseline-v1";
import { EXTRACTION_SCHEMA, SCORING_SCHEMA, extractionPrompt, scoringPrompt } from "../lib/prompts";
import { validateScores } from "../lib/scoring";
import { validateExtraction, type ExtractionAudit } from "../lib/extract";
import { parseJsonLoose, generate } from "../lib/gemini";
import type { Event } from "../lib/types";

type Ver = "v1" | "v2";
const events: Event[] = SCORE_CASES.map(toEvent);
const fwd = events;
const rev = [...events].reverse();
const items = EXTRACT_CASES.map((c) => c.item);
const xBatches = [items.slice(0, 10), items.slice(10)];

export function promptJobs(v: Ver): { name: string; prompt: string; schema: Record<string, unknown> }[] {
  const sp = v === "v1" ? scoringPromptV1 : scoringPrompt;
  const xp = v === "v1" ? extractionPromptV1 : extractionPrompt;
  const sSchema = v === "v1" ? {} : SCORING_SCHEMA;
  return [
    { name: "scoring-fwd", prompt: sp(fwd, AREAS), schema: sSchema },
    { name: "scoring-rev", prompt: sp(rev, AREAS), schema: sSchema },
    { name: "extraction-1", prompt: xp(xBatches[0], NOW), schema: EXTRACTION_SCHEMA },
    { name: "extraction-2", prompt: xp(xBatches[1], NOW), schema: EXTRACTION_SCHEMA },
  ];
}

const safeParse = (t: string | undefined): unknown => { try { return t ? parseJsonLoose(t) : null; } catch { return null; } };

export function gradeAll(v: Ver, out: Record<string, string | undefined>) {
  const vs = v === "v1" ? validateScoresV1 : validateScores;
  const sf = vs(safeParse(out["scoring-fwd"]), fwd, AREAS);
  const sr = vs(safeParse(out["scoring-rev"]), rev, AREAS);
  const scoring = gradeScoring(sf, sr);

  const results = new Map<string, ExtractCaseResult>();
  xBatches.forEach((batch, bi) => {
    const raw = safeParse(out[`extraction-${bi + 1}`]);
    const audit: ExtractionAudit = { rescued: [] };
    const evs = v === "v1" ? validateExtractionV1(Array.isArray(raw) ? (raw as Record<string, unknown>[]).map((r) => ({ ...r, index: r.index ?? r.item })) : raw, batch) : validateExtraction(raw, batch, audit);
    batch.forEach((it, i) => {
      const caseId = EXTRACT_CASES.find((c) => c.item === it)!.id;
      results.set(caseId, { events: evs.filter((e) => e.url === it.link), rescued: audit.rescued.filter((x) => x.startsWith(`${i}:`)) });
    });
  });
  const extraction = gradeExtraction(results);
  const validJson = { scoringFwd: sf.size > 0, scoringRev: sr.size > 0, ext1: Array.isArray(safeParse(out["extraction-1"])), ext2: Array.isArray(safeParse(out["extraction-2"])) };
  const unverified = [...sf.values()].filter((s) => /not verifiable/.test(s.reason)).length;
  return { scoring, extraction, validJson, unverified };
}

function printReport(v: Ver, r: ReturnType<typeof gradeAll>) {
  const row = (c: Check) => `${c.pass ? "PASS" : "FAIL"}  ${c.id}  ${c.attack.padEnd(58)} ${c.pass ? "" : c.detail}`;
  console.log(`\n===== PROMPT ${v} =====`);
  console.log("valid JSON:", JSON.stringify(r.validJson));
  console.log("\n-- SCORING --");
  r.scoring.forEach((c) => console.log(row(c)));
  console.log("\n-- EXTRACTION --");
  r.extraction.forEach((c) => console.log(row(c) + (c.pass && !c.rawClean ? `  [guard rescued]` : "")));
  const sp = r.scoring.filter((c) => c.pass).length;
  const ep = r.extraction.filter((c) => c.pass).length;
  const er = r.extraction.filter((c) => c.rawClean).length;
  console.log(`\nSCORING ${sp}/${r.scoring.length} | EXTRACTION shipped ${ep}/${r.extraction.length} (model alone correct on ${er}) | unverifiable-evidence rows: ${r.unverified}`);
}

async function main() {
  const [mode, a, b] = process.argv.slice(2);
  if (mode === "dump") {
    const v = (b as Ver) || "v2";
    mkdirSync(a, { recursive: true });
    for (const j of promptJobs(v)) writeFileSync(join(a, `${j.name}.prompt.txt`), j.prompt);
    console.log(`wrote ${promptJobs(v).length} prompt files to ${a} (${v})`);
  } else if (mode === "replay") {
    const v = (b as Ver) || "v2";
    const out: Record<string, string | undefined> = {};
    for (const j of promptJobs(v)) { const f = join(a, `${j.name}.out.json`); out[j.name] = existsSync(f) ? readFileSync(f, "utf8") : undefined; }
    const r = gradeAll(v, out);
    printReport(v, r);
    process.exitCode = [...r.scoring, ...r.extraction].every((c) => c.pass) ? 0 : 1;
  } else if (mode === "live") {
    const v = (a as Ver) || "v2";
    if (!process.env.GEMINI_API_KEY) { console.error("GEMINI_API_KEY is not set."); process.exit(2); }
    const dir = join("evals", "results", v); mkdirSync(dir, { recursive: true });
    const out: Record<string, string> = {};
    for (const j of promptJobs(v)) {
      const { text } = await generate({ prompt: j.prompt, schema: Object.keys(j.schema).length ? j.schema : undefined });
      out[j.name] = text; writeFileSync(join(dir, `${j.name}.out.json`), text);
    }
    const r = gradeAll(v, out);
    printReport(v, r);
    writeFileSync(join(dir, "report.json"), JSON.stringify(r, null, 2));
    process.exitCode = [...r.scoring, ...r.extraction].every((c) => c.pass) ? 0 : 1;
  } else {
    console.log("usage: tsx evals/run.ts live [v1|v2] | dump <dir> [v1|v2] | replay <dir> [v1|v2]");
  }
}
if (process.argv[1]?.endsWith("run.ts")) main();
