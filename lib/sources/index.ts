import type { Config, RawEvent, SourceHealth } from "../types";
import { errMsg, withTimeout } from "../util";
import { fetchEventbrite } from "./eventbrite";
import { fetchRss, SkipSource } from "./rss";
import { fetchGeminiSearch } from "./geminiSearch";
import { sampleEvents } from "./sample";

export type Collector = { name: string; enabled: boolean; run: () => Promise<RawEvent[]> };

export function defaultCollectors(config: Config, now: Date): Collector[] {
  return [
    { name: "eventbrite", enabled: config.sources.eventbrite, run: () => fetchEventbrite(config) },
    { name: "newsletters/RSS", enabled: config.sources.rss, run: () => fetchRss(config, now) },
    { name: "gemini-search", enabled: config.sources.geminiSearch, run: () => fetchGeminiSearch(config, now) },
    { name: "sample", enabled: config.sources.sample, run: async () => sampleEvents(now) },
  ];
}

/**
 * Run every source in parallel, each with its own timeout. One slow or broken source must never
 * stop the others - its failure is recorded in `health` and shown in the email footer instead.
 */
export async function collect(
  collectors: Collector[],
  perSourceTimeoutMs = 55_000
): Promise<{ events: RawEvent[]; health: SourceHealth[] }> {
  const live = collectors.filter((c) => c.enabled);
  const results = await Promise.all(
    live.map(async (c): Promise<{ health: SourceHealth; events: RawEvent[] }> => {
      const t0 = Date.now();
      try {
        const events = await withTimeout(c.run(), perSourceTimeoutMs, c.name);
        return { events, health: { name: c.name, ok: true, count: events.length, ms: Date.now() - t0 } };
      } catch (e) {
        const base = { name: c.name, count: 0, ms: Date.now() - t0 };
        return e instanceof SkipSource
          ? { events: [], health: { ...base, ok: true, skipped: e.message } }
          : { events: [], health: { ...base, ok: false, error: errMsg(e) } };
      }
    })
  );
  return { events: results.flatMap((r) => r.events), health: results.map((r) => r.health) };
}
