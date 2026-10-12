const MAX_BODY = 2_000_000;

/** http(s) only, and never a loopback / private / link-local host (blocks SSRF to internal or metadata addresses). */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return false;
  if (h === "::1" || h === "::" || /^(fc|fd|fe80)/.test(h) || h.startsWith("::ffff:")) return false;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return false;
  }
  if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) return false; // integer / hex IP tricks
  return true;
}

export async function fetchText(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {}
): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 15000);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; EventScoutBot/0.1)",
        "accept-language": "en-IN,en;q=0.8",
        ...opts.headers,
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    return text.length > MAX_BODY ? text.slice(0, MAX_BODY) : text; // a huge page must not hog memory
  } finally {
    clearTimeout(t);
  }
}

export function stripHtml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only http(s) links are ever rendered as hrefs (blocks javascript: etc. from scraped/AI data). */
export function safeUrl(u: string): string {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" ? p.toString() : "#";
  } catch {
    return "#";
  }
}

export function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(t!);
  }
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
