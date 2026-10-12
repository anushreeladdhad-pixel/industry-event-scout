/**
 * Thin Gemini Flash client (REST, no SDK -> fewer moving parts on Vercel).
 * The brief requires Gemini Flash for ALL AI tasks, so this is the only AI entry point.
 */
export const geminiModel = () => process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
export const geminiAvailable = () => !!process.env.GEMINI_API_KEY;

type GenArgs = {
  prompt: string;
  /** JSON schema (Gemini OpenAPI subset). Cannot be combined with `search` on Flash. */
  schema?: Record<string, unknown>;
  /** Enable Google Search grounding. */
  search?: boolean;
  timeoutMs?: number;
};

export type GenResult = { text: string; groundingUrls: string[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function generate({ prompt, schema, search, timeoutMs = 45_000 }: GenArgs): Promise<GenResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent`;
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1, // we want extraction/ranking, not creativity
      ...(schema ? { responseMimeType: "application/json", responseSchema: schema } : {}),
    },
    ...(search ? { tools: [{ google_search: {} }] } : {}),
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
      });
      if (r.status === 429 || r.status >= 500) throw new Error(`Gemini HTTP ${r.status} (retryable)`);
      if (!r.ok) throw new Error(`Gemini HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = (await r.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string } }[] } }[];
      };
      const cand = j.candidates?.[0];
      const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      if (!text) throw new Error("Gemini returned an empty response");
      const groundingUrls = (cand?.groundingMetadata?.groundingChunks ?? []).map((c) => c.web?.uri).filter((u): u is string => !!u);
      return { text, groundingUrls };
    } catch (e) {
      lastErr = e;
      const retryable = e instanceof Error && (/retryable|abort|fetch failed/i.test(e.message) || e.name === "AbortError");
      if (!retryable || attempt === 2) break;
      await sleep(1000 * 2 ** attempt);
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Models sometimes wrap JSON in ```fences``` or add a preamble. Recover instead of failing. */
export function parseJsonLoose(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const a = cleaned.indexOf("[");
    const b = cleaned.lastIndexOf("]");
    if (a !== -1 && b > a) return JSON.parse(cleaned.slice(a, b + 1)); // throws if still invalid -> caller handles
    throw new Error("Model output was not valid JSON");
  }
}

export { UNTRUSTED_NOTICE } from "./prompts";
