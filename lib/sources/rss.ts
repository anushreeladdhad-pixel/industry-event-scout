import type { Config, RawEvent } from "../types";
import { extractEvents, type TextItem } from "../extract";
import { geminiAvailable } from "../gemini";
import { errMsg, fetchText, isPublicHttpUrl, stripHtml } from "../util";

/** Minimal RSS/Atom reader (no dependency). Newsletters, organiser blogs and iSpirit-style feeds. */
export function parseFeed(xml: string, feedHost: string): TextItem[] {
  const items: TextItem[] = [];
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  for (const b of blocks) {
    const get = (tag: string) => b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "";
    const title = stripHtml(get("title"));
    const link =
      stripHtml(get("link")) || b.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] || "";
    const body = stripHtml(get("content:encoded") || get("description") || get("summary") || get("content"));
    const pub = stripHtml(get("pubDate") || get("published") || get("updated") || get("dc:date"));
    const published = pub && !Number.isNaN(Date.parse(pub)) ? new Date(pub).toISOString().slice(0, 10) : undefined;
    if (title && /^https?:\/\//i.test(link)) items.push({ title, link, text: `${title}. ${body}`, source: `rss:${feedHost}`, published });
  }
  return items.slice(0, 40);
}

export async function fetchRss(config: Config, now: Date): Promise<RawEvent[]> {
  if (!config.rssFeeds.length) throw new SkipSource("no RSS feeds configured (add some in Settings)");
  if (!geminiAvailable()) throw new SkipSource("needs GEMINI_API_KEY to read newsletter text");
  const results = await Promise.allSettled(
    config.rssFeeds.filter(isPublicHttpUrl).map(async (feed) => {
      const host = new URL(feed).hostname.replace(/^www\./, "");
      return parseFeed(await fetchText(feed), host);
    })
  );
  const items = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  if (!items.length && failed.length) throw new Error(`all feeds failed (${errMsg(failed[0].reason)})`);
  return extractEvents(items, now);
}

/** Thrown for "not applicable right now" so health shows SKIPPED rather than a scary error. */
export class SkipSource extends Error {}
