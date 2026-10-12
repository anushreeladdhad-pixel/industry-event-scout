export async function sendEmail(opts: { to: string; subject: string; html: string; text: string }): Promise<{ id: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  if (!opts.to) throw new Error("No recipient email configured (set it in Settings or DIGEST_TO)");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Event Scout <onboarding@resend.dev>",
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });
  const body = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!r.ok || !body.id) throw new Error(`Email send failed (HTTP ${r.status}): ${body.message ?? "unknown error"}`);
  return { id: body.id };
}
