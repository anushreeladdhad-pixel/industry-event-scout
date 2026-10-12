import type { Event, RawEvent } from "./types";
import { hashId } from "./util";
import { parseWhen } from "./deadline";

const STOP = new Set(["the", "a", "an", "of", "and", "in", "at", "for", "to", "on", "by", "with", "2025", "2026", "2027"]);
const RANK: Record<RawEvent["provenance"], number> = { structured: 0, "ai-extracted": 1, "ai-search": 2, sample: 3 };

export function normalizeUrl(u: string): string {
  try {
    const p = new URL(u);
    const keep = new URLSearchParams();
    p.searchParams.forEach((v, k) => {
      if (!/^(utm_|fbclid|gclid|ref|aff|source)/i.test(k)) keep.set(k, v);
    });
    const q = keep.toString();
    return `${p.hostname.replace(/^www\./, "").toLowerCase()}${p.pathname.replace(/\/+$/, "")}${q ? "?" + q : ""}`;
  } catch {
    return u.trim().toLowerCase();
  }
}

export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/\[sample\]/g, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w && !STOP.has(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  if (!a.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function dayOf(s: string | null | undefined): number | null {
  const d = parseWhen(s, false);
  return d ? Math.floor((d.getTime() + 5.5 * 3_600_000) / 86_400_000) : null; // IST calendar day
}

/** Same event announced on two platforms? Same link, OR near-identical title on (about) the same day. */
export function isSameEvent(a: RawEvent, b: RawEvent): boolean {
  const da = dayOf(a.startDate);
  const db = dayOf(b.startDate);
  const ta = titleTokens(a.title);
  const tb = titleTokens(b.title);
  if (normalizeUrl(a.url) === normalizeUrl(b.url)) {
    // A newsletter roundup announces several DIFFERENT events under one link, so for AI-extracted
    // rows a shared URL alone is not proof of identity: dates must not clash and titles must overlap.
    const roundupRisk = a.provenance === "ai-extracted" && b.provenance === "ai-extracted";
    if (!roundupRisk) return true;
    if (da !== null && db !== null && Math.abs(da - db) > 1) return false;
    return jaccard(ta, tb) >= 0.3;
  }
  if (da === null || db === null || Math.abs(da - db) > 1) return false; // never merge when dates disagree/unknown
  if (jaccard(ta, tb) >= 0.7) return true;
  return (isSubset(ta, tb) || isSubset(tb, ta)) && Math.min(ta.size, tb.size) >= 3;
}

function earlier(a?: string | null, b?: string | null): string | null {
  const da = parseWhen(a, true);
  const db = parseWhen(b, true);
  if (da && db) return da <= db ? (a as string) : (b as string);
  return (da ? a : b) ?? null;
}

function merge(base: Event, other: RawEvent): Event {
  const [best, rest] = RANK[other.provenance] < RANK[base.provenance] ? [other, base] : [base, other];
  const sources = Array.from(new Set([...base.sources, other.source]));
  return {
    ...best,
    id: base.id,
    sources,
    description: (best.description?.length ?? 0) >= (rest.description?.length ?? 0) ? best.description : rest.description,
    city: best.city ?? rest.city,
    venue: best.venue ?? rest.venue,
    organiser: best.organiser ?? rest.organiser,
    endDate: best.endDate ?? rest.endDate,
    registrationClosed: base.registrationClosed || other.registrationClosed || undefined,
    // If two sources disagree on the deadline, trust the EARLIER one: a false alarm costs a click,
    // a missed deadline costs the event.
    registrationDeadline: earlier(base.registrationDeadline, other.registrationDeadline),
  };
}

export function dedupe(raw: RawEvent[]): Event[] {
  const out: Event[] = [];
  for (const r of raw) {
    if (!r.title?.trim() || !r.url?.trim()) continue; // unusable row
    const idx = out.findIndex((e) => isSameEvent(e, r));
    if (idx === -1) out.push({ ...r, id: hashId(normalizeUrl(r.url) + r.title), sources: [r.source] });
    else out[idx] = merge(out[idx], r);
  }
  return out;
}
