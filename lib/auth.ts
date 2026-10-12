import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Fails CLOSED: if the secret env var is not set, nobody is authorised. */
export function isAdmin(req: Request): boolean {
  const secret = process.env.ADMIN_TOKEN;
  const given = req.headers.get("x-admin-token") ?? "";
  return !!secret && safeEqual(given, secret);
}

export function isCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return !!secret && safeEqual(given, secret);
}
