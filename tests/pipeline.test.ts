import { test } from "node:test";
import assert from "node:assert/strict";
import { runDigest } from "../lib/pipeline";
import { DEFAULT_CONFIG } from "../lib/config";
import { sampleEvents } from "../lib/sources/sample";
import { renderDigestHtml, renderDigestText, subjectLine } from "../lib/digest";
import type { Collector } from "../lib/sources";

const NOW = new Date("2026-10-12T04:00:00Z");
const cfg = { ...DEFAULT_CONFIG, recipientEmail: "v@example.com" };
const sampleOnly: Collector[] = [{ name: "sample", enabled: true, run: async () => sampleEvents(NOW) }];
const noAi = async () => { throw new Error("no ai in test"); }; // forces keyword fallback

test("end to end on sample data: every edge case lands where it should", async () => {
  const r = await runDigest(cfg, { now: NOW, collectors: sampleOnly, ai: noAi });
  const titles = [...r.urgent, ...r.events].map((e) => e.title);
  // duplicate pair merged -> one CIO roundtable, in URGENT, with the EARLIER (3-day) deadline
  assert.equal(r.urgent.filter((e) => /CIO Roundtable/i.test(e.title)).length, 1);
  assert.equal(r.urgent[0].daysLeft! < 7 && r.urgent[0].daysLeft! >= 3, true);
  assert.equal(r.urgent[0].sources.length, 2);
  // dropped: closed registration, outside window, wrong city, no date, irrelevant
  for (const gone of ["registration closed", "Annual Strategy Conference", "Chennai", "date TBA", "Pottery"])
    assert.equal(titles.some((t) => t.includes(gone)), false, `should have dropped: ${gone}`);
  assert.equal(r.stats.droppedDeadlinePassed, 1);
  assert.equal(r.stats.droppedNoDate, 1);
  assert.equal(r.stats.droppedWrongCity, 1);
  assert.equal(r.stats.droppedOutsideWindow, 1);
  assert.ok(r.stats.droppedLowScore >= 1);
  // exactly-7-days-out is NOT flagged urgent
  assert.equal(r.urgent.some((e) => /Leaders Roundtable/.test(e.title)), false);
  assert.equal(r.events.some((e) => /Leaders Roundtable/.test(e.title)), true);
  // unknown deadline survives and is labelled; startsSoon flag set where relevant
  const founders = r.events.find((e) => /Founders/.test(e.title))!;
  assert.equal(founders.deadlineStatus, "unknown");
  assert.equal(r.events.find((e) => /Breakfast/.test(e.title))!.startsSoon, true);
  // best matches sorted by score desc
  const scores = r.events.map((e) => e.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.equal(r.hasSample, true);
});

test("one source failing does not stop the digest, and it is reported", async () => {
  const boom: Collector = { name: "eventbrite", enabled: true, run: async () => { throw new Error("HTTP 403"); } };
  const r = await runDigest(cfg, { now: NOW, collectors: [boom, ...sampleOnly], ai: noAi });
  assert.ok(r.urgent.length + r.events.length > 0);
  const h = r.health.find((x) => x.name === "eventbrite")!;
  assert.equal(h.ok, false);
  assert.match(renderDigestHtml(r), /could not be checked this week/);
});

test("every source down + sample off => empty digest is a valid, clearly-worded result", async () => {
  const boom: Collector = { name: "eventbrite", enabled: true, run: async () => { throw new Error("down"); } };
  const r = await runDigest(cfg, { now: NOW, collectors: [boom], ai: noAi });
  assert.equal(r.urgent.length + r.events.length, 0);
  assert.match(subjectLine(r), /no matching events/);
  assert.match(renderDigestHtml(r), /Nothing matched/);
  assert.match(renderDigestText(r), /Nothing matched/);
});

test("changing config changes results with no code change (cities + focus areas)", async () => {
  const r = await runDigest({ ...cfg, cities: ["Chennai"] }, { now: NOW, collectors: sampleOnly, ai: noAi });
  assert.equal([...r.urgent, ...r.events].every((e) => e.matchedCity === "Chennai"), true);
  assert.ok(r.urgent.length + r.events.length >= 1);
});

test("maxEvents caps the best-match list but never trims urgent events", async () => {
  const r = await runDigest({ ...cfg, maxEvents: 3 }, { now: NOW, collectors: sampleOnly, ai: noAi });
  assert.ok(r.urgent.length >= 1);
  assert.ok(r.events.length <= Math.max(0, 3 - r.urgent.length));
});

test("email HTML escapes hostile titles and blocks javascript: links", async () => {
  const evil: Collector = { name: "x", enabled: true, run: async () => [{ title: "<script>alert(1)</script> CIO summit", url: "javascript:alert(1)", source: "x", provenance: "structured", startDate: "2026-10-20", city: "Mumbai", description: "CIO digital transformation", registrationDeadline: null }] };
  const r = await runDigest(cfg, { now: NOW, collectors: [evil], ai: noAi });
  const html = renderDigestHtml(r);
  assert.equal(html.includes("<script>alert"), false);
  assert.equal(html.includes('href="javascript:'), false);
});

test("urgent card shows the REGISTER NOW flag", async () => {
  const r = await runDigest(cfg, { now: NOW, collectors: sampleOnly, ai: noAi });
  assert.match(renderDigestHtml(r), /REGISTER NOW/);
});
