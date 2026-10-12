import type { RawEvent } from "./types";
import { generate, parseJsonLoose } from "./gemini";
import { EXTRACTION_SCHEMA, extractionPrompt } from "./prompts";
import { truncate } from "./util";
import { parseWhen } from "./deadline";

export type TextItem = { title: string; link: string; text: string; source: string; published?: string };

const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.+\-Z]+)?$/;
const str = (v: unknown) => (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim() : null);
const isoOrNull = (v: unknown): string | null => {
  const s = str(v);
  return s && ISO.test(s) && parseWhen(s) ? s : null; // a malformed or impossible date is "unknown", not a crash
};
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

export type ExtractionAudit = { rescued: string[] }; // which guards had to correct the model (a quality metric)

/**
 * Turn raw model rows into trusted RawEvents. Code-level guards behind the prompt, because the
 * single worst failure in this product is a wrong "safe" deadline:
 *   G1 dates must be valid ISO, else null
 *   G2 a registration deadline needs a verbatim quote that really appears in the item text
 *   G3 a deadline AFTER the event starts is a mis-extraction (e.g. a CFP date), so null
 *   G4 an end date before the start date is dropped
 *   G5 the event URL is always the real fetched link, never model-written
 */
export function validateExtraction(raw: unknown, batch: TextItem[], audit?: ExtractionAudit): RawEvent[] {
  const out: RawEvent[] = [];
  if (!Array.isArray(raw)) return out;
  const perItem = new Map<number, number>(); // events per item: a roundup must not give every event the same name
  for (const r of raw as Record<string, unknown>[]) if (r && r.isUpcomingEvent === true && typeof r.item === "number") perItem.set(r.item, (perItem.get(r.item) ?? 0) + 1);
  let cur = -1;
  const note = (g: string) => audit?.rescued.push(`${cur}:${g}`); // "<item index>:<guard>"
  for (const r of raw as Record<string, unknown>[]) {
    const src = r && typeof r.item === "number" ? batch[r.item] : undefined;
    if (!src || r.isUpcomingEvent !== true) continue;
    cur = r.item as number;
    const startDate = isoOrNull(r.startDate);
    let endDate = isoOrNull(r.endDate);
    if (str(r.startDate) && !startDate) note("G1-bad-start");
    if (endDate && startDate && parseWhen(endDate)! < parseWhen(startDate)!) { endDate = null; note("G4-end-before-start"); }

    let deadline = isoOrNull(r.registrationDeadline);
    if (str(r.registrationDeadline) && !deadline) note("G1-bad-deadline");
    if (deadline) {
      const quote = str(r.deadlineEvidence);
      if (!quote || !norm(`${src.title} ${src.text}`).includes(norm(quote))) { deadline = null; note("G2-unverified-deadline"); }
    }
    if (deadline && startDate && parseWhen(deadline, true)! > new Date(parseWhen(startDate)!.getTime() + 86_400_000)) {
      deadline = null; note("G3-deadline-after-event");
    }

    // G6 a missing title falls back to the item headline - but in a roundup that would label several
    // different events identically, so add city/date to keep them distinguishable
    const title = str(r.title) ?? ((perItem.get(cur) ?? 1) > 1 ? truncate([src.title, str(r.city), startDate].filter(Boolean).join(" - "), 140) : src.title);
    if (!str(r.title)) note("G6-missing-title");
    out.push({
      title,
      url: src.link,
      source: src.source,
      provenance: "ai-extracted",
      startDate,
      endDate,
      city: str(r.city),
      venue: str(r.venue),
      organiser: str(r.organiser),
      isOnline: r.isOnline === true,
      description: truncate(src.text, 500),
      registrationDeadline: deadline,
      registrationClosed: r.registrationClosed === true,
    });
  }
  return out;
}

/**
 * Newsletters/blogs are prose, not data. Gemini turns them into event records; `validateExtraction`
 * then refuses anything it cannot back up. One item may yield several events (roundups).
 */
export async function extractEvents(items: TextItem[], now: Date): Promise<RawEvent[]> {
  const out: RawEvent[] = [];
  const BATCH = 10;
  const askModel = async (batch: TextItem[]) => {
    const { text } = await generate({ prompt: extractionPrompt(batch, now), schema: EXTRACTION_SCHEMA });
    const raw = parseJsonLoose(text);
    return { raw, events: validateExtraction(raw, batch) };
  };
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    try {
      const { raw, events } = await askModel(batch);
      out.push(...events);
      // The model sometimes truncates its answer and silently skips items. Ask once more for just those.
      const seen = new Set(Array.isArray(raw) ? (raw as { item?: unknown }[]).map((r) => r?.item) : []);
      const missing = batch.filter((_, n) => !seen.has(n));
      if (missing.length) {
        try { out.push(...(await askModel(missing)).events); } catch { /* keep what we have */ }
      }
    } catch {
      // one bad batch must not lose the others; the source health line reports overall counts
    }
  }
  return out;
}
