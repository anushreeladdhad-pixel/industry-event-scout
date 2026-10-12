import type { Config } from "./types";
import { isPublicHttpUrl } from "./util";

export const DEFAULT_CONFIG: Config = {
  recipientEmail: process.env.DIGEST_TO ?? "",
  focusAreas: [
    "Management consulting & strategy",
    "CXO / CIO / CTO roundtables and summits",
    "Startup ecosystem and founder meetups",
    "Digital transformation & enterprise technology",
  ],
  cities: ["Bengaluru", "Mumbai", "Delhi NCR", "Hyderabad"],
  includeOnline: false,
  windowDays: 30,
  urgentDays: 7,
  maxEvents: 15,
  minScore: 40,
  rssFeeds: [],
  sources: { eventbrite: true, rss: true, geminiSearch: true, sample: true },
};

const list = (v: unknown, max: number, itemMax = 80): string[] =>
  Array.from(
    new Set(
      (Array.isArray(v) ? v : [])
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().slice(0, itemMax))
        .filter(Boolean)
    )
  ).slice(0, max);

const num = (v: unknown, def: number, min: number, max: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
};

/** Never trust config input (it arrives from a form): coerce, bound and de-duplicate. */
export function sanitizeConfig(input: unknown): Config {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const s = (i.sources && typeof i.sources === "object" ? i.sources : {}) as Record<string, unknown>;
  const d = DEFAULT_CONFIG;
  const focusAreas = list(i.focusAreas, 12, 120);
  const cities = list(i.cities, 12, 60);
  const feeds = list(i.rssFeeds, 20, 300).filter((u) => isPublicHttpUrl(u));
  const email = typeof i.recipientEmail === "string" ? i.recipientEmail.trim() : d.recipientEmail;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("recipientEmail is not a valid email address");
  const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
  return {
    recipientEmail: email,
    focusAreas: focusAreas.length ? focusAreas : d.focusAreas, // an empty list would silently match nothing
    cities: cities.length ? cities : d.cities,
    includeOnline: bool(i.includeOnline, d.includeOnline),
    windowDays: num(i.windowDays, d.windowDays, 1, 90),
    urgentDays: num(i.urgentDays, d.urgentDays, 1, 30),
    maxEvents: num(i.maxEvents, d.maxEvents, 3, 40),
    minScore: num(i.minScore, d.minScore, 0, 100),
    rssFeeds: feeds,
    sources: {
      eventbrite: bool(s.eventbrite, d.sources.eventbrite),
      rss: bool(s.rss, d.sources.rss),
      geminiSearch: bool(s.geminiSearch, d.sources.geminiSearch),
      sample: bool(s.sample, d.sources.sample),
    },
  };
}

const sb = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
};

export const configStorageEnabled = () => sb() !== null;

export async function loadConfig(): Promise<Config> {
  const s = sb();
  if (!s) return sanitizeConfig({ ...DEFAULT_CONFIG });
  try {
    const r = await fetch(`${s.url}/rest/v1/scout_config?id=eq.1&select=data`, {
      headers: { apikey: s.key, authorization: `Bearer ${s.key}` },
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const rows = (await r.json()) as { data: unknown }[];
    return rows[0] ? sanitizeConfig({ ...DEFAULT_CONFIG, ...(rows[0].data as object) }) : sanitizeConfig({ ...DEFAULT_CONFIG });
  } catch {
    return sanitizeConfig({ ...DEFAULT_CONFIG }); // storage hiccup must not stop the Monday email
  }
}

export async function saveConfig(input: unknown): Promise<Config> {
  const s = sb();
  if (!s) throw new Error("Config storage is not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).");
  const cfg = sanitizeConfig(input);
  const r = await fetch(`${s.url}/rest/v1/scout_config`, {
    method: "POST",
    headers: {
      apikey: s.key,
      authorization: `Bearer ${s.key}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ id: 1, data: cfg, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`Could not save settings (HTTP ${r.status})`);
  return cfg;
}
