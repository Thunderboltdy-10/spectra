import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { generateAgentCases, runAgentChecks } from "./checks";

export const runtime = "nodejs";
export const maxDuration = 300;

function errorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "The evaluation could not run.";
  const status = /not signed|AUTH_/i.test(message)
    ? 401
    : /permission|forbidden|not allowed/i.test(message)
      ? 403
      : 400;
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session.userId) throw new Error("AUTH_NOT_SIGNED_IN");
    const raw: unknown = await request.json();
    const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    if (typeof body.agentId !== "string" || !body.agentId)
      throw new Error("An agent is required.");
    const input = { userId: session.userId, agentId: body.agentId };
    if (body.action === "generate")
      return NextResponse.json({ ok: true, cases: await generateAgentCases(input) });
    return NextResponse.json({
      ok: true,
      ...(await runAgentChecks({ ...input, ...(typeof body.threshold === "number" ? { threshold: body.threshold } : {}) })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
