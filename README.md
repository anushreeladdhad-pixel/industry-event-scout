# Industry Event Scout

A Monday-morning digest of relevant industry events for the next 30 days, ranked by fit to configurable focus areas, with registration deadlines under 7 days flagged. Built for Problem Statement 15. AI tasks use **Gemini Flash only**.

See `docs/STEPS_AND_NINE_CHECKS.md` for the problem breakdown, the nine checks and the reasoning.

## How it works

`collect (Eventbrite, RSS, Gemini search, sample)` then `dedupe` then `30-day window` then `city filter` then `deadline classify` then `Gemini rank (keyword fallback)` then `digest HTML/text` then `Resend email`, triggered by Vercel Cron every Monday 07:30 IST.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in keys
npm run dev                  # http://localhost:3000
npm test                     # 36 offline tests, no network needed
```

Without any keys it still works: sample data, keyword ranking, preview page. Add `GEMINI_API_KEY` for AI ranking and live search, `RESEND_API_KEY` and `DIGEST_TO` to send mail.

## Deploy (Vercel)

1. Push to GitHub and import the repo in Vercel.
2. Set the env vars from `.env.example` (`ADMIN_TOKEN` and `CRON_SECRET` should be long random strings).
3. Optional, for editable settings: create a Supabase project, run `supabase/schema.sql`, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
4. `vercel.json` already schedules `/api/cron` for Mondays at 02:00 UTC (07:30 IST).

## What is verified and what is not

Verified offline: deadline rules (including the exactly-7-days boundary), city aliases, dedupe, scoring validation and fallback, config sanitising, feed and JSON-LD parsers, the full pipeline on sample data, email escaping, TypeScript and the production build.

**Verified live (2026-10-12, from a developer machine with network):** the Eventbrite page format. A no-key run fetched 141 events from Eventbrite, parsed them from JSON-LD and placed them in the configured cities. This is a scraped page format, so re-check it if the source starts reporting 0 events.

**Verified live (2026-10-12):** Gemini scoring (`npm run eval`: 17/17 scoring cases pass with `gemini-3.5-flash`; `gemini-2.5-flash` is retired for new API keys, so the default model is now `gemini-3.5-flash`), Resend delivery (a real digest was emailed from the deployed app via `/api/send`), auth on `/api/send` and `/api/cron` (401 without credentials), and the Supabase `scout_config` table was created. The Vercel production deployment serves the preview.

**Observed limits:** the extraction eval scored 9/16 in one live run because the model sometimes returned a truncated answer (a one-off; the same prompt later returned all 12 rows). `extractEvents` now re-asks once for items the model skipped. A re-run was blocked by Gemini 429 rate limits, so extraction is NOT re-verified. Under 429s the app fell back to keyword ranking and said so in the email, as designed.

**Not verified:** Gemini Google Search grounding (every city search failed with 429), the Gemini extractor end to end, Supabase read/write from the app (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are not set on Vercel yet), and Vercel Cron actually firing on Monday.

## Stress test (2026-10-12)

Load: 20 simultaneous cold requests now share one pipeline run; `?fresh=1` (unauthenticated) is throttled to one rebuild per 30 s; 50 cached hits in 0.4 s. Auth: every protected route returns 401 for a missing, wrong, differently-cased or query-string credential, and fails closed when its env var is unset. Config fuzzing (null, wrong types, huge lists, prototype pollution, CRLF email injection, 99999 numbers) is sanitised or rejected. Fixed: feed URLs pointing at localhost / private / link-local addresses are rejected (SSRF), fetched bodies are capped at 2 MB. Not covered: sustained load over minutes, mail-client rendering, Gemini under paid quota (free tier returns 429 for Google Search grounding, so AI search stays unverified).

## Known limits

LinkedIn-only events cannot be scraped reliably; AI search may surface some, labelled "AI-found, verify". Eventbrite listing pages do not publish registration deadlines, so those show "not listed" rather than a guess.

## Prompts and evals

Prompts are versioned in `lib/prompts.ts`. `npm run eval` runs 33 adversarial cases against Gemini Flash. See `docs/PROMPT_STRESS_TEST.md` for design, guards, results and limits.
