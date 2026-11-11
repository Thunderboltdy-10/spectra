import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { runtimeStatus, warmRuntime } from "@/features/spectra/ai/harness/subscription-runtime";

export const dynamic = "force-dynamic";

/* What this person's computer offers: Codex and Claude Code, installed, logged in, which models. */
export async function GET() {
  const actor = await requireActor();
  return NextResponse.json(await runtimeStatus(String(actor.accountId)));
}

/* Start the person's runtime as the composer takes focus, so the first turn does not wait for it. */
export async function POST(request: Request) {
  const actor = await requireActor();
  const body = (await request.json().catch(() => null)) as { runtime?: unknown } | null;
  if (body?.runtime === "codex") await warmRuntime("codex", String(actor.accountId));
  return new NextResponse(null, { status: 204 });
}
