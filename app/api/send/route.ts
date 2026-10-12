import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { loadConfig } from "@/lib/config";
import { runDigest } from "@/lib/pipeline";
import { renderDigestHtml, renderDigestText, subjectLine } from "@/lib/digest";
import { sendEmail } from "@/lib/email";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "Send now" for demos/testing. Admin-token protected so strangers can't trigger emails. */
export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const cfg = await loadConfig();
    const result = await runDigest(cfg);
    const sent = await sendEmail({ to: cfg.recipientEmail, subject: subjectLine(result), html: renderDigestHtml(result), text: renderDigestText(result) });
    return NextResponse.json({ ok: true, id: sent.id, to: cfg.recipientEmail });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unexpected error" }, { status: 500 });
  }
}
