/**
 * Indian cities are known by several names and metro areas span several towns.
 * Each group is one "canonical city"; the first entry is its canonical name.
 * Without this, "Bangalore" would never match a configured "Bengaluru".
 */
const GROUPS: string[][] = [
  ["bengaluru", "bangalore", "bengalooru"],
  ["mumbai", "bombay", "navi mumbai", "thane"],
  ["delhi ncr", "delhi", "new delhi", "ncr", "gurgaon", "gurugram", "noida", "faridabad", "ghaziabad"],
  ["hyderabad", "secunderabad"],
  ["pune"],
  ["chennai", "madras"],
  ["kolkata", "calcutta"],
  ["ahmedabad"],
];

const EVENTBRITE_SLUG: Record<string, string> = {
  bengaluru: "bengaluru",
  mumbai: "mumbai",
  "delhi ncr": "new-delhi",
  hyderabad: "hyderabad",
  pune: "pune",
  chennai: "chennai",
  kolkata: "kolkata",
  ahmedabad: "ahmedabad",
};

function wordIn(text: string, word: string): boolean {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`, "i").test(text);
}

/** Canonical city name for free text like "Koramangala, Bangalore" -> "bengaluru". */
export function canonicalCity(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  // Longest alias first so "navi mumbai"/"new delhi" win over shorter ones
  let best: { canon: string; len: number } | null = null;
  for (const g of GROUPS) {
    for (const alias of g) {
      if (wordIn(t, alias) && (!best || alias.length > best.len)) best = { canon: g[0], len: alias.length };
    }
  }
  return best ? best.canon : null;
}

/** Returns the configured city name this event belongs to, or null if none. */
export function matchConfiguredCity(
  eventText: string,
  configuredCities: string[]
): string | null {
  const evCanon = canonicalCity(eventText);
  const lower = eventText.toLowerCase();
  for (const c of configuredCities) {
    const cCanon = canonicalCity(c);
    if (cCanon && evCanon && cCanon === evCanon) return c;
    if (!cCanon && lower.includes(c.toLowerCase())) return c; // unknown city: plain substring
  }
  return null;
}

export function eventbriteSlug(city: string): string {
  const canon = canonicalCity(city);
  return (canon && EVENTBRITE_SLUG[canon]) || city.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
}
