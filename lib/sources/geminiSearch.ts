import type { Config, RawEvent } from "../types";
import { generate, geminiAvailable, parseJsonLoose, UNTRUSTED_NOTICE } from "../gemini";
import { SkipSource } from "./rss";
import { truncate } from "../util";

/**
 * Catches what fixed scrapers can't: conference sites, iSpirit, organiser pages, LinkedIn-announced
 * events. Uses Gemini Flash with Google Search grounding (still Gemini, as the brief requires).
 * Everything found this way is labelled "AI-found - verify" in the digest.
 */
export async function fetchGeminiSearch(config: Config, now: Date): Promise<RawEvent[]> {
  if (!geminiAvailable()) throw new SkipSource("needs GEMINI_API_KEY");
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + config.windowDays * 86_400_000).toISOString().slice(0, 10);

  const perCity = await Promise.allSettled(
    config.cities.slice(0, 6).map(async (city) => {
      const prompt = `Find real, upcoming professional events in ${city}, India between ${from} and ${to}: conferences, CXO/CIO roundtables, summits, industry meetups and startup ecosystem events.
Relevant to: ${config.focusAreas.join("; ")}.
Search event platforms (Eventbrite, Luma, Meetup), iSpirt, conference websites and organisers' announcements.

Return ONLY a JSON array (no prose). Each item: {"title","url","startDate","city","venue","organiser","description","registrationDeadline"}.
- url must be the event's own page that you actually found. Do not invent URLs.
- Use null for anything not stated on the page, especially registrationDeadline. NEVER guess a deadline.
- Dates as YYYY-MM-DD. Skip events you cannot confirm exist. Max 10 items.

${UNTRUSTED_NOTICE}`;
      const { text, groundingUrls } = await generate({ prompt, search: true, timeoutMs: 50_000 });
      const arr = parseJsonLoose(text);
      if (!Array.isArray(arr)) return [];
      const out: RawEvent[] = [];
      for (const r of arr as Record<string, unknown>[]) {
        const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
        const title = s(r.title);
        const url = s(r.url);
        if (!title || !url || !/^https?:\/\//i.test(url)) continue;
        out.push({
          title,
          url,
          source: "gemini-search",
          provenance: "ai-search",
          startDate: s(r.startDate),
          city: s(r.city) ?? city,
          venue: s(r.venue),
          organiser: s(r.organiser),
          description: truncate(s(r.description) ?? "", 500),
          registrationDeadline: s(r.registrationDeadline),
          isOnline: false,
        });
      }
      void groundingUrls; // kept for future "was this URL actually in the search results?" verification
      return out;
    })
  );
  const ok = perCity.filter((r): r is PromiseFulfilledResult<RawEvent[]> => r.status === "fulfilled");
  if (!ok.length) throw new Error("search failed for every city");
  return ok.flatMap((r) => r.value);
}
