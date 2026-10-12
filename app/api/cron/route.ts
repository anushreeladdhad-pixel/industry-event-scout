import { NextResponse } from "next/server";
import { isCron } from "@/lib/auth";
import { loadConfig } from "@/lib/config";
import { runDigest } from "@/lib/pipeline";
import { renderDigestHtml, renderDigestText, subjectLine } from "@/lib/digest";
import { sendEmail } from "@/lib/email";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron hits this every Monday 02:00 UTC = 07:30 IST (see vercel.json), sending
 * `Authorization: Bearer $CRON_SECRET`. Even a quiet week sends an email ("nothing matched"),
 * so silence always means "the system is broken", never "nothing happened".
 */
export async function GET(req: Request) {
  if (!isCron(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const cfg = await loadConfig();
    const result = await runDigest(cfg);
    const sent = await sendEmail({ to: cfg.recipientEmail, subject: subjectLine(result), html: renderDigestHtml(result), text: renderDigestText(result) });
    return NextResponse.json({ ok: true, id: sent.id, events: result.urgent.length + result.events.length, health: result.health });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unexpected error" }, { status: 500 });
  }
}
