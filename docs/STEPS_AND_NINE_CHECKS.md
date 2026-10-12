# Industry Event Scout: Problem Steps and the Nine Checks

Problem Statement 15 (Medium). Persona: Vikram, independent management consultant. Goal: a Monday-morning email of relevant events in the next 30 days, ranked by fit, with deadlines under 7 days clearly flagged, with categories and cities changeable without touching code.

---

## Part 1. The problem in steps

| # | Step | The logic | Edge cases handled | Code |
|---|------|-----------|--------------------|------|
| 0 | **Scope** | One user, one weekly email, advisory only. The system finds and ranks; Vikram decides and registers. | No auto-registration, no multi-user, no calendar sync (explicitly out of scope). | n/a |
| 1 | **Configure** | Focus areas, cities, window, urgency threshold, feeds and sources live in a database row edited at `/settings`, so a shift in practice focus needs no deploy. | Input is sanitised and bounded; empty lists fall back to defaults instead of silently matching nothing; storage outage falls back to defaults so the Monday email still ships. | `lib/config.ts`, `app/settings` |
| 2 | **Collect** | No single source exists, so query several in parallel: Eventbrite pages (structured JSON-LD), newsletter/organiser RSS feeds (prose, read by Gemini), and Gemini with Google Search grounding (conference sites, iSpirt, LinkedIn-announced events). Sample data is the safety net. | Each source has its own timeout; one failure never blocks the others; failures are recorded and shown in the email ("could not be checked this week"). | `lib/sources/*` |
| 3 | **Extract** | Prose sources are turned into records by Gemini Flash. Anything not stated in the text is `null`. | The model may never guess a deadline; URLs are always the real fetched link, never model-written; scraped text is treated as untrusted (prompt-injection notice); non-events and recaps are filtered out. | `lib/extract.ts` |
| 4 | **Dedupe** | The same event appears on several platforms. Merge when the link matches, or the titles are near-identical and the dates are within one day. | Recurring series on different dates are not merged; tracking parameters ignored; if two sources disagree on the deadline, keep the earlier one (a false alarm costs a click, a missed deadline costs the event). | `lib/dedupe.ts` |
| 5 | **Window** | Keep events starting from today (IST) to today + 30 days. | No date means it cannot be placed, so it is dropped and counted; events already running today still count. | `lib/pipeline.ts` |
| 6 | **City** | Keep events in configured cities. | Aliases and metros understood (Bangalore = Bengaluru; Gurugram and Noida = Delhi NCR); online events only if opted in. | `lib/cities.ts` |
| 7 | **Deadline** | Classify each event as urgent (fewer than 7 days, per the brief), open, passed or unknown. | Exactly 7 days is not urgent; a date-only deadline is open until end of that day (IST); passed means drop; unknown is labelled "not listed", never treated as safe; "starts soon, no deadline" gets its own amber flag. | `lib/deadline.ts` |
| 8 | **Rank** | Gemini Flash scores each event 0-100 against the focus areas and gives a one-line reason, in batches with a strict JSON schema. | Output is validated: invented IDs ignored, scores clamped, invented focus areas dropped; malformed or failed output falls back to deterministic keyword scoring so the email always ships; the reason is limited to facts in the text. | `lib/scoring.ts` |
| 9 | **Assemble** | Urgent section first (soonest deadline first, never trimmed), then best matches (capped), with date, city, match score, why, deadline badge and link. | Empty week still sends ("nothing matched") so silence always means broken; HTML escaped and only http(s) links rendered. | `lib/digest.ts` |
| 10 | **Deliver** | Vercel Cron fires Monday 02:00 UTC = 07:30 IST and sends through Resend. | Endpoints fail closed without their secrets; "email it to me now" exists for demos. | `app/api/cron`, `lib/email.ts` |
| 11 | **Observe** | The digest footer reports fetched/deduped/dropped counts and per-source health. | Gemini fallback is stated in the email, not hidden. | `lib/digest.ts` |

---

## Part 2. The Nine Checks: does this deserve to be built?

The slide groups them as **Kill Switches** (any No: don't build), **Sizing** (any No: build something smaller) and **Boundary** (any No: put a human exactly here). The slide states the questions and the rule per group. The reasoning and the effect on the design below are my application to this problem, so adjust the wording to what was taught in class.

### Kill switches

**01 Problem real? YES.** Events drive 40% of Vikram's new business, and face-to-face conversion is 3x any cold channel. The pain is concrete: 45 minutes every Monday, and a missed CIO roundtable that was the right room for three active prospects. *Caveat:* the evidence comes from one persona in the brief.

**02 Workflow repeated? YES.** It happens every Monday, indefinitely, and his focus shifts through the year, so the config page matters. *Consequence:* a scheduled job plus an editable config is justified, where a one-off script would not be.

**03 Input available? PARTLY (the one to watch).** Eventbrite listings, RSS and newsletters, and organiser and conference pages are public and machine-readable. LinkedIn-only announcements (the exact failure in the story) are not reliably available. *Decision:* build, because most sources are accessible, but do not claim full coverage. Use Gemini search grounding for the long tail, label those results "AI-found, verify", and show failed sources in the email. If the only source were LinkedIn this would be a No and we would not build.

### Sizing

**04 Output valuable? YES, but kept small.** The value is a scannable, ranked, deadline-flagged list, not a platform. *Smaller build:* one email, one settings page, no accounts, no auto-registration.

**05 Impact measurable? PARTLY.** Measurable: minutes saved (45 to under 5), events surfaced per week, urgent flags raised, and conversions from events attended. The MVP instruments counts and source health but has no feedback loop yet. *Next step:* add thumbs up/down per event to measure ranking precision.

**08 ROI worth it? YES.** The cost is tiny: Gemini Flash tokens for about 20 to 100 events a week, free-tier hosting, one email a week. The benefit is about 40 minutes a week saved (more than 30 hours a year) plus the chance of one extra client from one event. *Smaller build:* a single user and a single cron job keep it that way.

### Boundary

**06 Failure risk OK? YES, with mitigations.** The failures are a missed event or a wrong deadline. The consequence is a lost opportunity, not harm. Mitigations: a source link on every event; "verify on the organiser's page" in the footer; unknown deadlines labelled, never assumed; failed sources disclosed; the earlier deadline kept when sources disagree. *Human here:* Vikram confirms date and deadline before registering.

**07 Judgment protected? YES.** Gemini ranks and explains; it does not decide. There is no auto-registration, no outreach and no calendar writes. Scores are advisory and always show a reason. *Human here:* the attend and register decision, and which prospects to meet there.

**09 Owner clear? YES.** Vikram owns what he cares about (focus areas, cities, the decision). The builder or maintainer owns the pipeline, sources and keys. A failed Monday run is visible because the email never goes silent: either it arrives, or its absence is the alert. *Next step:* send a failure alert to the maintainer if the cron errors.

### Verdict

Build it, small: a single-user weekly digest with an advisory AI ranker. The one real risk (03) is handled by being honest about coverage rather than pretending to cover LinkedIn.
