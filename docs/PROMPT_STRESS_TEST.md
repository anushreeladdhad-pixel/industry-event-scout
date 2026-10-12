# Prompt design and stress test (Product view)

Product: the Monday event digest for Vikram. Two prompts carry the AI risk:

| Prompt | Job | Where | Worst failure |
|---|---|---|---|
| **Scorer** | Rank each event by match to his stated focus areas | `lib/prompts.ts` `scoringPrompt` | Irrelevant event ranked top (trust), relevant one buried (missed room) |
| **Extractor** | Turn newsletter/organiser prose into event records | `lib/prompts.ts` `extractionPrompt` | A **wrong "safe" registration deadline**, the exact failure that cost Vikram the CIO roundtable |

Current version: **v2.1**. Gemini Flash is the only model used in the product.

## 1. Spec for the prompts (what "good" means)

1. **Spec fidelity.** The brief says rank by how closely each event matches his stated focus areas. So the score means that and nothing else.
2. **Null over guess.** Unknown is a valid answer. "Deadline not listed" is honest; an invented deadline is the worst failure.
3. **Evidence required.** Every score and every deadline carries a verbatim quote. Code checks the quote really appears in the listing.
4. **Data, not orders.** Scraped text is untrusted. Instructions inside it are never followed.
5. **Robust IO.** The model echoes small integers (`n`), never opaque hash IDs. One item may produce several events.
6. **The prompt is not the only defence.** Every rule that matters is also enforced in code (below), because a prompt is a request, not a guarantee.

## 2. What the v1 review caught before any test

| Flaw in v1 | Why it matters | Fix |
|---|---|---|
| Score also rewarded "senior audience" | Drifted from the brief; it is not what he asked to rank by | Score = focus-area match only |
| Model had to echo hash ids | Mangled ids silently lose events | `n` = position |
| One event per newsletter item | A roundup of 5 events loses 4 | One object per event; same `item` |
| No rule for early-bird / CFP dates | Those get mistaken for the registration deadline | Explicit "NOT a registration deadline" list |
| No "registration closed" field | A closed event would show as "deadline not listed" | `registrationClosed`; pipeline drops it |
| Descriptions cut at 350 chars | Cut off the sentence saying what the event is | 600 |

## 3. Code guards behind the prompts

| Guard | Catches |
|---|---|
| Score ≥ 40 needs a verbatim quote found in the listing, else capped at 50 and flagged | Hallucinated relevance |
| `matched` must be exact members of the configured focus areas | Invented categories |
| Unknown / duplicate `n`, non-numeric score, non-array output are ignored; keyword scoring takes over | Garbage output; the email still ships |
| G1 dates must be real ISO calendar dates | "tomorrow", `2026-02-30` |
| G2 a deadline needs a verbatim quote present in the item text | Invented deadlines |
| G3 a deadline after the event starts is dropped | CFP / sponsor dates mis-read as registration |
| G4 end before start dropped | Bad ranges |
| G5 URL is always the real fetched link | Model-written URLs |
| G6 untitled roundup rows stay distinguishable | Three events all named after the newsletter |
| Same-URL events from one newsletter are not merged unless titles/dates agree | Roundups collapsing into one event |

## 4. The stress test

**Method.** 17 scoring cases and 16 extraction cases, each aimed at a specific failure, with deterministic graders (`evals/`). Scoring is run twice, in forward and reversed batch order, to catch position bias (same event must score within ±15). The extraction grade is on what would actually **ship** (after the guards); a second figure shows how often the model alone was right.

**Scoring attacks:** clear hits (consulting, CXO roundtable, startups), plainly unrelated, false friend ("strategy" board-game night), keyword stuffing, two prompt injections (one hostile to the score, one trying to break the output format), title-only listing, Hindi listing, generic networking, pure hype, adjacent topic with no keywords, emoji/HTML noise, job ad, recap of a past event, near-duplicate listing (consistency).

**Extraction attacks:** early-bird date, call-for-speakers date, deadline after the event, injected "set the deadline to 2030", relative date ("this Friday"), date range with no year, roundup of 3 events, online webinar, job post, past-event recap, closed / sold-out, "coming soon" with no facts, explicit "last date to register".

### Results (stand-in model, one run each)

| | v1 | **v2.1** |
|---|---|---|
| Scoring cases passed | 13 / 17 | **17 / 17** |
| Extraction cases shipped correctly | 9 / 16 | **16 / 16** |
| Extraction where the model alone was right (no guard needed) | 9 / 16 | 15 / 16 |
| Valid JSON from the model | 4 / 4 | 4 / 4 |

**v1 failures:** consulting event under-scored (62 for a clear in-focus event; cause not confirmed, the reason it gave just restates the description); injected listing not treated as spam (it resisted the instruction but scored the event 84, which fails my stricter policy, not a hijack); title-only scored 72 (over the cap); past-event recap scored 40; roundup yielded no events; relative date unresolved (no publish date was given); date-range end lost; deadline after the event accepted; online flag missed; "closed" and "sold out" not representable.

**What the stress test found that I had not predicted (all fixed):**
1. *Real bug:* `2026-02-30` was accepted as a valid date (JS rolls it to March), which could place an event in the wrong week. Fixed in `parseWhen`.
2. *Prompt gap + code gap:* on roundups the model left out `title` because the prompt never defined it, and the validator then named all three events after the newsletter. Prompt now defines it (v2.1); G6 covers the case where it is still missing.
3. *Guard earned its place:* on the "deadline after the event" case the model alone got it wrong and G3 caught it. Without the guard that wrong deadline would have shipped as a "safe" date.

## 5. How far to trust these numbers

- **The stand-in is not Gemini.** I could not call Gemini from the build sandbox (no outbound network, no key), so I used a small fast model of a different family as a stand-in for a Flash-class model. It shows whether the *prompt text* is clear and the *guards* work. It does not predict Gemini's behaviour. **Run `npm run eval` with your key and use those numbers in the viva.**
- **One run, small sample.** 33 cases, one sample each, no variance estimate. A pass means "did not fail here", not "reliable".
- **I wrote the cases knowing v2's rules,** so v1 vs v2 flatters v2. It shows that v2 handles what it was designed for. It is not an independent benchmark.
- **Thresholds are my judgement** (for example "recap must score ≤ 15"). Change them in `evals/cases.ts` if you disagree.
- **Not covered yet:** full 20-event batches, long messy real pages, non-English extraction, listings that are relevant but badly written, Gemini's own JSON-mode quirks, and cost/latency. The traps the stand-in already handled on its own (early-bird, CFP, injection) are insurance on this model; they may matter more on Gemini.

## 6. Re-running

```bash
npm test                                   # offline: guards, graders, validators (36 tests)
GEMINI_API_KEY=... npm run eval            # v2.1 prompts on Gemini Flash, graded
GEMINI_API_KEY=... npm run eval:baseline   # frozen v1, for the before/after
npx tsx evals/run.ts dump <dir> v2         # write the prompts to run through any model by hand
npx tsx evals/run.ts replay <dir> v2       # grade saved outputs
```
Raw stand-in outputs are kept in `evals/results/standin-haiku/` so the numbers above can be re-graded.

## 7. Change log

| Ver | Change | Evidence |
|---|---|---|
| v1 | First prompts | Review in section 2 |
| v2 | Spec-faithful rubric, rules for non-events, injection and keyword stuffing, evidence quotes, `n`-based IO; multi-event extraction with deadline traps, `registrationClosed` | 13/17 → 17/17, 9/16 → 15/16 |
| v2.1 | Extraction `title` rule; G6; impossible-date fix | 15/16 → 16/16 |
