import type { Config, RawEvent } from "../types";
import { eventbriteSlug } from "../cities";
import { errMsg, fetchText, stripHtml, truncate } from "../util";

/**
 * Eventbrite's public search API was retired, so we read the same public search pages a person
 * would, using the schema.org Event JSON-LD that those pages embed (structured, no HTML scraping
 * of layout). NOTE: written against the public page format but must be verified against the live
 * site - the pipeline treats any failure here as "source unavailable", never as a crash.
 */

const WORD_STOP = new Set(["and", "the", "for", "with", "events", "event", "ecosystem", "meetups"]);

export function queryFromFocusArea(area: string): string {
  const w = area
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((x) => x.length > 3 && !WORD_STOP.has(x))
    .slice(0, 2);
  return w.join("-") || "conference";
}

type Json = Record<string, unknown>;

function collectEvents(node: unknown, acc: Json[]): void {
  if (Array.isArray(node)) return node.forEach((n) => collectEvents(n, acc));
  if (!node || typeof node !== "object") return;
  const o = node as Json;
  const t = o["@type"];
  const types = Array.isArray(t) ? t : [t];
  if (types.some((x) => typeof x === "string" && /Event$/.test(x))) acc.push(o);
  for (const k of ["itemListElement", "item", "@graph", "event"]) if (o[k]) collectEvents(o[k], acc);
}

export function parseEventbriteHtml(html: string): RawEvent[] {
  const events: Json[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      collectEvents(JSON.parse(m[1]), events);
    } catch {
      /* skip malformed block */
    }
  }
  const out: RawEvent[] = [];
  for (const e of events) {
    const title = typeof e.name === "string" ? e.name : "";
    const url = typeof e.url === "string" ? e.url : "";
    if (!title || !url) continue;
    const loc = (e.location ?? {}) as Json;
    const addr = (loc.address ?? {}) as Json;
    const online = /OnlineEventAttendanceMode/i.test(String(e.eventAttendanceMode ?? ""));
    out.push({
      title,
      url,
      source: "eventbrite",
      provenance: "structured",
      startDate: typeof e.startDate === "string" ? e.startDate : null,
      endDate: typeof e.endDate === "string" ? e.endDate : null,
      city: typeof addr.addressLocality === "string" ? addr.addressLocality : null,
      venue: typeof loc.name === "string" ? loc.name : null,
      isOnline: online,
      organiser: typeof (e.organizer as Json | undefined)?.name === "string" ? ((e.organizer as Json).name as string) : null,
      description: truncate(stripHtml(typeof e.description === "string" ? e.description : ""), 500),
      registrationDeadline: null, // listing pages do not publish it - stays "not listed", never guessed
    });
  }
  return out;
}

export async function fetchEventbrite(config: Config): Promise<RawEvent[]> {
  const jobs: string[] = [];
  for (const city of config.cities) {
    for (const area of config.focusAreas.slice(0, 3)) {
      jobs.push(`https://www.eventbrite.com/d/india--${eventbriteSlug(city)}/${queryFromFocusArea(area)}/`);
    }
  }
  const capped = jobs.slice(0, 12); // stay well inside the serverless time limit
  const results = await Promise.allSettled(capped.map((u) => fetchText(u).then(parseEventbriteHtml)));
  const ok = results.filter((r): r is PromiseFulfilledResult<RawEvent[]> => r.status === "fulfilled");
  if (!ok.length) {
    const first = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw new Error(`all ${capped.length} Eventbrite requests failed (${first ? errMsg(first.reason) : "unknown"})`);
  }
  return ok.flatMap((r) => r.value);
}
