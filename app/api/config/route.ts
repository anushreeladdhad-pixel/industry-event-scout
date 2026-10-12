import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { configStorageEnabled, loadConfig, saveConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ config: await loadConfig(), editable: configStorageEnabled() });
}

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Wrong or missing admin token" }, { status: 401 });
  try {
    const cfg = await saveConfig(await req.json());
    return NextResponse.json({ ok: true, config: cfg });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save" }, { status: 400 });
  }
}
