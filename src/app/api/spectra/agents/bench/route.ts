import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { BenchStreamEvent, BenchTarget } from "@/features/spectra/agents/foundry";
import { ProviderUnavailableError } from "@/features/spectra/ai/harness/types";
import { createNdjsonResponse } from "@/features/spectra/runs/streaming/ndjson-response";
import { readConvexError } from "../../../../../../shared/convex-error.mjs";
import { answerOnBench, prepareBenchAnswer } from "./answer";

/*
 * The agent bench: one sample prompt, answered by the agent's draft or by one
 * of its releases (the newest, or an older one the creator picked), streamed
 * back as it is written. The answer itself is bench/answer.ts, which Spectra's
 * run_agent_bench shares: the lab system prompt the checks use, the harness
 * model client (model, provider and reasoning only from the environment),
 * admission against the school's ceiling and metering. A stopped answer keeps
 * what it had written, marked stopped.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The sentence after a Spectra error code, or the caller's own copy. */
function plainMessage(error: unknown, fallback: string) {
  if (error instanceof ProviderUnavailableError)
    return "Spectra could not reach the AI model. Try again in a moment.";
  const { code, message } = readConvexError(error);
  const sentence = code ? message.slice(code.length).replace(/^:\s*/, "") : "";
  return sentence || fallback;
}

function failure(error: unknown) {
  const { message } = readConvexError(error);
  const status = /AUTH_NOT_SIGNED_IN/.test(message)
    ? 401
    : /AUTH_RESOURCE_FORBIDDEN|permission/i.test(message)
      ? 403
      : 400;
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: readConvexError(error).code,
        message: plainMessage(error, "The bench could not start this answer."),
      },
    },
    { status },
  );
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session.userId) throw new Error("AUTH_NOT_SIGNED_IN");
    const body = record(await request.json().catch(() => null));
    const agentId = typeof body.agentId === "string" ? body.agentId : "";
    if (!agentId) throw new Error("AGENT_BENCH_INVALID: Choose an agent first.");
    const target: BenchTarget = body.target === "release" ? "release" : "draft";
    // An older release the creator picked; without one, the newest.
    const releaseNumber =
      typeof body.releaseNumber === "number" &&
      Number.isInteger(body.releaseNumber) &&
      body.releaseNumber > 0
        ? body.releaseNumber
        : undefined;
    // The editor may send its newest content, not yet saved, so a rerun right
    // after an edit answers with that edit.
    const prepared = await prepareBenchAnswer(session.userId, {
      agentId,
      prompt: typeof body.prompt === "string" ? body.prompt : "",
      target,
      ...(target === "release" && releaseNumber ? { releaseNumber } : {}),
      ...(target === "draft" ? { content: record(body.content) } : {}),
    });

    return createNdjsonResponse(
      async (send) => {
        const emit = (event: BenchStreamEvent) => send(event);
        emit({ type: "start", target, ...(prepared.releaseNumber ? { releaseNumber: prepared.releaseNumber } : {}) });
        const run = await answerOnBench(prepared, {
          signal: request.signal,
          onText: (delta) => emit({ type: "text", delta }),
          onRetry: () => emit({ type: "retry" }),
        });
        emit({ type: "done", run });
      },
      (error) => plainMessage(error, "The bench could not finish this answer. Try again."),
    );
  } catch (error) {
    return failure(error);
  }
}
