import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceOk, validateScores, UNVERIFIED_CAP } from "../lib/scoring";
import { validateExtraction, type ExtractionAudit, type TextItem } from "../lib/extract";
import { dedupe } from "../lib/dedupe";
import { scoringPrompt, extractionPrompt } from "../lib/prompts";
import { AREAS, EXTRACT_CASES, NOW, SCORE_CASES, toEvent } from "../evals/cases";
import { gradeAll, promptJobs } from "../evals/run";
import type { Event } from "../lib/types";

const ev = (id: string, title: string, description = ""): Event => ({ id, title, description, url: "https://x.com/" + id, source: "s", sources: ["s"], provenance: "structured", startDate: null, city: null });

// ---------- scoring validator: defence against a lying / sloppy model
test("evidence: verbatim quote passes (case/punctuation tolerant), invented quote fails", () => {
  const e = ev("a", "CIO Roundtable: AI Operating Models", "Invite-only roundtable for CIOs.");
  assert.equal(evidenceOk("invite only roundtable for cios", e), true);
  assert.equal(evidenceOk("keynote by Sundar Pichai", e), false);
  assert.equal(evidenceOk("", e), false);
  assert.equal(evidenceOk(undefined, e), false);
});
test("score >=40 with fabricated evidence is capped and flagged; real evidence is kept", () => {
  const batch = [ev("a", "Founders Night", "Meetup for startup founders"), ev("b", "Gala", "Dinner")];
  const m = validateScores([
    { n: 1, score: 95, matched: [AREAS[2]], evidence: "Meetup for startup founders", reason: "startup meetup" },
    { n: 2, score: 95, matched: [AREAS[1]], evidence: "CIOs from Fortune 500 attend", reason: "CIO event" }, // invented
  ], batch, AREAS);
  assert.equal(m.get("a")!.score, 95);
  assert.equal(m.get("b")!.score, UNVERIFIED_CAP);
  assert.match(m.get("b")!.reason, /not verifiable/);
});
test("scoring validator survives junk rows, duplicates, out-of-range n, wrong types", () => {
  const batch = [ev("a", "A summit", "x")];
  const m = validateScores([null, 5, "str", { n: 0, score: 50 }, { n: 99, score: 50 }, { n: 1, score: "abc" }, { n: 1, score: 30, matched: "nope", evidence: "", reason: 7 }, { n: 1, score: 99, matched: [], evidence: "A summit", reason: "dup" }], batch, AREAS);
  assert.equal(m.size, 1);
  assert.equal(m.get("a")!.score, 30); // first usable row wins; later duplicate ignored
  assert.deepEqual(m.get("a")!.matched, []);
});
test("a model that echoes n as a string or returns an object (not array) yields nothing, not a crash", () => {
  assert.equal(validateScores({ n: 1, score: 5 }, [ev("a", "t")], AREAS).size, 0);
  assert.equal(validateScores([{ n: "1", score: 5 }], [ev("a", "t")], AREAS).size, 0);
});

// ---------- extraction validator: the deadline guards
const item = (text: string, title = "Evt"): TextItem => ({ title, text: `${title}. ${text}`, link: "https://n.com/1", source: "rss:n.com" });
const row = (o: Record<string, unknown>) => ({ item: 0, isUpcomingEvent: true, title: "Evt", isOnline: false, registrationClosed: false, ...o });
test("G2: a deadline without a verbatim quote from the text is nulled (hallucinated 'safe' date)", () => {
  const audit: ExtractionAudit = { rescued: [] };
  const out = validateExtraction([row({ startDate: "2026-11-05", registrationDeadline: "2030-01-01", deadlineEvidence: "register by 1 Jan 2030" })], [item("Takes place 5 November 2026.")], audit);
  assert.equal(out[0].registrationDeadline, null);
  assert.deepEqual(audit.rescued, ["0:G2-unverified-deadline"]);
  assert.equal(validateExtraction([row({ startDate: "2026-11-05", registrationDeadline: "2026-10-20" })], [item("x")])[0].registrationDeadline, null); // no quote at all
});
test("G2: a real quote keeps the deadline", () => {
  const out = validateExtraction([row({ startDate: "2026-11-05", registrationDeadline: "2026-10-20", deadlineEvidence: "Register by 20 October" })], [item("Takes place 5 Nov. Register by 20 October 2026.")]);
  assert.equal(out[0].registrationDeadline, "2026-10-20");
});
test("G3: deadline after the event is a mis-extraction", () => {
  const out = validateExtraction([row({ startDate: "2026-11-10", registrationDeadline: "2026-11-25", deadlineEvidence: "Registration closes 25 November" })], [item("Forum 10 November. Registration closes 25 November 2026.")]);
  assert.equal(out[0].registrationDeadline, null);
});
test("G1/G4: impossible dates, natural language dates and end-before-start are nulled", () => {
  const out = validateExtraction([row({ startDate: "tomorrow", endDate: "2026-02-30" }), row({ startDate: "2026-11-20", endDate: "2026-11-10" })], [item("x")]);
  assert.equal(out[0].startDate, null);
  assert.equal(out[0].endDate, null);
  assert.equal(out[1].endDate, null);
});
test("G5: model-written URLs are ignored; recaps and bad item indexes are dropped; one item can yield many events", () => {
  const rows = [row({ title: "A", url: "https://evil.com", startDate: "2026-11-01" }), row({ title: "B", startDate: "2026-11-02" }), row({ isUpcomingEvent: false }), row({ item: 9 })];
  const out = validateExtraction(rows, [item("x")]);
  assert.equal(out.length, 2);
  assert.ok(out.every((e) => e.url === "https://n.com/1"));
});
test("roundup: same-link events with different titles/dates are NOT merged by dedupe; true repeats are", () => {
  const mk = (title: string, startDate: string) => ({ title, url: "https://n.com/roundup", source: "rss:n.com", provenance: "ai-extracted" as const, startDate, city: "Pune" });
  assert.equal(dedupe([mk("Cloud Leaders Forum", "2026-10-21"), mk("AI in Banking Roundtable", "2026-10-27"), mk("Women in Tech Meetup", "2026-11-03")]).length, 3);
  assert.equal(dedupe([mk("Cloud Leaders Forum", "2026-10-21"), mk("Cloud Leaders Forum", "2026-10-21")]).length, 1);
});

test("G6: roundup rows without titles stay distinguishable instead of all becoming the newsletter headline", () => {
  const rows = [row({ title: undefined, city: "Pune", startDate: "2026-10-21" }), row({ title: undefined, city: "Mumbai", startDate: "2026-10-27" })];
  const out = validateExtraction(rows, [item("roundup text", "This month in tech")]);
  assert.equal(out.length, 2);
  assert.notEqual(out[0].title, out[1].title);
});

// ---------- prompt hygiene
test("prompts: v2 numbers events by position, carries the injection notice and the anti-guess rules", () => {
  const p = scoringPrompt(SCORE_CASES.map(toEvent), AREAS);
  assert.match(p, /UNTRUSTED DATA/);
  assert.match(p, /"n":1/);
  assert.equal(p.includes('"id"'), false); // no opaque ids for the model to mangle
  const x = extractionPrompt([EXTRACT_CASES[0].item], NOW);
  assert.match(x, /early-bird/i);
  assert.match(x, /call-for-speakers/i);
  assert.match(x, /never guess/i);
  assert.match(x, /EVENT's own name/); // v2.1: title rule
});

// ---------- the graders themselves must be able to FAIL a bad model
test("graders: a lazy model (everything 90, deadlines always invented) fails loudly", () => {
  const lazyScores = JSON.stringify(SCORE_CASES.map((_, i) => ({ n: i + 1, score: 90, matched: AREAS, evidence: "", reason: "great" })));
  const lazyExt1 = JSON.stringify(EXTRACT_CASES.slice(0, 10).map((c, i) => ({ item: i, isUpcomingEvent: true, title: c.item.title, startDate: "2026-10-30", registrationDeadline: "2026-10-20", deadlineEvidence: "made up", isOnline: false, registrationClosed: false })));
  const r = gradeAll("v2", { "scoring-fwd": lazyScores, "scoring-rev": lazyScores, "extraction-1": lazyExt1, "extraction-2": "[]" });
  assert.ok(r.scoring.filter((c) => !c.pass).length >= 10);
  assert.ok(r.extraction.filter((c) => !c.pass).length >= 8);
  assert.ok(r.unverified > 0);
});
test("graders: unusable output (prose instead of JSON) fails every case and does not throw", () => {
  const r = gradeAll("v2", { "scoring-fwd": "Sure! Here you go", "scoring-rev": undefined, "extraction-1": "nope", "extraction-2": "" });
  assert.equal(r.scoring.every((c) => !c.pass), true);
  assert.equal(promptJobs("v2").length, 4);
});
