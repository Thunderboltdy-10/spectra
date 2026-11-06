import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { runtimeStatus } from "@/features/spectra/ai/harness/subscription-runtime";

export const dynamic = "force-dynamic";

/* What this person's computer offers: Codex and Claude Code, installed, logged in, which models. */
export async function GET() {
  const actor = await requireActor();
  return NextResponse.json(await runtimeStatus(String(actor.accountId)));
}
