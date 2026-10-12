import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDeadline, parseWhen, startsSoonWithoutDeadline } from "../lib/deadline";
import { canonicalCity, matchConfiguredCity } from "../lib/cities";
import { dedupe, isSameEvent } from "../lib/dedupe";
import { keywordScore, scoreEvents } from "../lib/scoring";
import { sanitizeConfig, DEFAULT_CONFIG } from "../lib/config";
import { parseEventbriteHtml } from "../lib/sources/eventbrite";
import { parseFeed } from "../lib/sources/rss";
import type { RawEvent } from "../lib/types";

const NOW = new Date("2026-10-12T04:00:00Z"); // Mon 09:30 IST

const ev = (o: Partial<RawEvent>): RawEvent => ({
  title: "T", url: "https://x.com/" + Math.random(), source: "s", provenance: "structured",
  startDate: "2026-10-20", city: "Mumbai", registrationDeadline: null, ...o,
});

test("deadline: strictly fewer than 7 days is urgent; exactly 7 is not", () => {
  assert.equal(classifyDeadline("2026-10-18", NOW, 7).status, "urgent"); // ~6.6 days
  assert.equal(classifyDeadline("2026-10-19", NOW, 7).status, "open"); // ~7.6 days
});
test("deadline: date-only deadline is open until END of that day (IST)", () => {
  assert.equal(classifyDeadline("2026-10-12", NOW, 7).status, "urgent"); // today, still open
  assert.equal(classifyDeadline("2026-10-11", NOW, 7).status, "passed");
});
test("deadline: missing or garbage is 'unknown', never safe/open", () => {
  assert.equal(classifyDeadline(null, NOW).status, "unknown");
  assert.equal(classifyDeadline("next friday-ish", NOW).status, "unknown");
  assert.equal(parseWhen("not a date"), null);
  assert.equal(parseWhen("2026-02-30"), null); // impossible calendar date must not roll over to March
  assert.equal(parseWhen("2026-13-01"), null);
  assert.notEqual(parseWhen("2028-02-29"), null); // real leap day is fine
});
test("startsSoon only when deadline missing and event within window", () => {
  assert.equal(startsSoonWithoutDeadline("2026-10-15", null, NOW), true);
  assert.equal(startsSoonWithoutDeadline("2026-10-15", "2026-10-14", NOW), false);
  assert.equal(startsSoonWithoutDeadline("2026-11-15", null, NOW), false);
});

test("cities: aliases and metro areas resolve", () => {
  assert.equal(canonicalCity("Koramangala, Bangalore"), "bengaluru");
  assert.equal(canonicalCity("Cyber City, Gurugram"), "delhi ncr");
  assert.equal(canonicalCity("Navi Mumbai"), "mumbai");
  assert.equal(matchConfiguredCity("Bangalore", ["Bengaluru", "Mumbai"]), "Bengaluru");
  assert.equal(matchConfiguredCity("Noida", ["Delhi NCR"]), "Delhi NCR");
  assert.equal(matchConfiguredCity("Chennai", ["Bengaluru", "Mumbai"]), null);
  assert.equal(matchConfiguredCity("", ["Bengaluru"]), null);
});

test("dedupe: same event on two platforms merges, keeps EARLIER deadline and both sources", () => {
  const a = ev({ title: "CIO Roundtable: AI Operating Models", url: "https://a.com/1", source: "a", registrationDeadline: "2026-10-15", city: null });
  const b = ev({ title: "CIO Roundtable - AI Operating Models (Bangalore)", url: "https://b.com/2", source: "b", registrationDeadline: "2026-10-18", city: "Bangalore", provenance: "ai-search" });
  const out = dedupe([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].registrationDeadline, "2026-10-15");
  assert.deepEqual(out[0].sources.sort(), ["a", "b"]);
  assert.equal(out[0].city, "Bangalore"); // filled the gap from the other source
});
test("dedupe: similar titles on DIFFERENT dates are NOT merged (recurring series)", () => {
  const a = ev({ title: "Founders Meetup", url: "https://a.com/1", startDate: "2026-10-14" });
  const b = ev({ title: "Founders Meetup", url: "https://a.com/2", startDate: "2026-11-14" });
  assert.equal(isSameEvent(a, b), false);
  assert.equal(dedupe([a, b]).length, 2);
});
test("dedupe: tracking params don't hide the same link; junk rows are dropped", () => {
  const a = ev({ title: "X Summit", url: "https://www.a.com/e/1?utm_source=news" });
  const b = ev({ title: "Totally different words", url: "https://a.com/e/1/" });
  assert.equal(dedupe([a, b]).length, 1);
  assert.equal(dedupe([ev({ title: "", url: "https://a.com/z" }), ev({ title: "ok", url: "" })]).length, 0);
});

test("scoring: keyword fallback ranks relevant above irrelevant", () => {
  const areas = DEFAULT_CONFIG.focusAreas;
  assert.ok(keywordScore({ title: "CIO Roundtable on digital transformation", description: "" }, areas).score >= 40);
  assert.ok(keywordScore({ title: "Pottery workshop", description: "beginner class" }, areas).score < 40);
});
test("scoring: valid Gemini JSON is used; hallucinated ids and bad scores are ignored", async () => {
  const e = dedupe([ev({ title: "CIO Summit", url: "https://a.com/1" })]);
  const reply = JSON.stringify([
    { n: 1, score: 140, matched: [DEFAULT_CONFIG.focusAreas[1], "made-up area"], evidence: "CIO Summit", reason: "CIO audience" },
    { n: 7, score: 99, matched: [], evidence: "x", reason: "x" },
  ]);
  const { scores } = await scoreEvents(e, DEFAULT_CONFIG.focusAreas, async () => reply);
  const s = scores.get(e[0].id)!;
  assert.equal(s.by, "gemini");
  assert.equal(s.score, 100); // clamped
  assert.deepEqual(s.matched, [DEFAULT_CONFIG.focusAreas[1]]); // invented area dropped
  assert.equal(scores.size, 1); // row for non-existent n=7 ignored
});
test("scoring: garbage / failing Gemini falls back to keywords with a note, never throws", async () => {
  const e = dedupe([ev({ title: "CIO digital transformation summit", url: "https://a.com/1" })]);
  const r1 = await scoreEvents(e, DEFAULT_CONFIG.focusAreas, async () => "sorry I cannot do that");
  assert.equal(r1.scores.get(e[0].id)!.by, "keyword");
  assert.ok(r1.aiNote);
  const r2 = await scoreEvents(e, DEFAULT_CONFIG.focusAreas, async () => { throw new Error("HTTP 429"); });
  assert.equal(r2.scores.get(e[0].id)!.by, "keyword");
  assert.match(r2.aiNote!, /429/);
});
test("scoring: fenced JSON from the model is recovered", async () => {
  const e = dedupe([ev({ title: "A", url: "https://a.com/1" })]);
  const reply = "```json\n" + JSON.stringify([{ n: 1, score: 70, matched: [], evidence: "A", reason: "ok" }]) + "\n```";
  const { scores } = await scoreEvents(e, DEFAULT_CONFIG.focusAreas, async () => reply);
  assert.equal(scores.get(e[0].id)!.by, "gemini");
});

test("config: sanitizer bounds values, rejects bad email, never leaves focus/cities empty", () => {
  const c = sanitizeConfig({ focusAreas: [], cities: ["  Pune ", "Pune"], windowDays: 9999, urgentDays: -4, rssFeeds: ["javascript:alert(1)", "https://ok.com/feed"], recipientEmail: "a@b.co" });
  assert.deepEqual(c.cities, ["Pune"]);
  assert.ok(c.focusAreas.length > 0);
  assert.equal(c.windowDays, 90);
  assert.equal(c.urgentDays, 1);
  assert.deepEqual(c.rssFeeds, ["https://ok.com/feed"]);
  assert.throws(() => sanitizeConfig({ recipientEmail: "not-an-email" }));
});

test("eventbrite parser reads schema.org JSON-LD and survives malformed blocks", () => {
  const html = `<script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"@type":"ListItem","item":{"@type":"BusinessEvent","name":"CIO Meet","url":"https://e.com/1","startDate":"2026-10-20","location":{"name":"Hall","address":{"addressLocality":"Bengaluru"}}}}]}</script><script type="application/ld+json">{broken</script>`;
  const r = parseEventbriteHtml(html);
  assert.equal(r.length, 1);
  assert.equal(r[0].city, "Bengaluru");
  assert.equal(r[0].registrationDeadline, null);
});
test("rss parser handles RSS and Atom", () => {
  const rss = `<rss><channel><item><title>Summit</title><link>https://n.com/a</link><description><![CDATA[<p>Join us 20 Oct</p>]]></description></item></channel></rss>`;
  const atom = `<feed><entry><title>Meetup</title><link href="https://n.com/b"/><summary>Details</summary></entry></feed>`;
  assert.equal(parseFeed(rss, "n.com")[0].link, "https://n.com/a");
  assert.equal(parseFeed(atom, "n.com")[0].link, "https://n.com/b");
  assert.equal(parseFeed("<html>not a feed</html>", "n.com").length, 0);
});

test("feed URLs: only public http(s); loopback, private, link-local and IP tricks are rejected", async () => {
  const { isPublicHttpUrl } = await import("../lib/util");
  const { sanitizeConfig } = await import("../lib/config");
  for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "http://localhost/x", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/", "http://192.168.1.1/", "http://172.20.0.1/", "http://[::1]/", "http://2130706433/", "http://0x7f000001/", "http://metadata.google.internal/", "not a url"])
    assert.equal(isPublicHttpUrl(bad), false, bad);
  assert.equal(isPublicHttpUrl("https://example.com/feed.xml"), true);
  assert.deepEqual(sanitizeConfig({ rssFeeds: ["http://169.254.169.254/x", "https://ok.example.com/rss"] }).rssFeeds, ["https://ok.example.com/rss"]);
});
