import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  BENCH_LIMITS,
  type BenchRun,
  type BenchStreamEvent,
  type BenchTarget,
} from "@/features/spectra/agents/foundry";
import { callSpectraModel } from "@/features/spectra/ai/harness/model";
import { ProviderUnavailableError } from "@/features/spectra/ai/harness/types";
import { createNdjsonResponse } from "@/features/spectra/runs/streaming/ndjson-response";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { readConvexError } from "../../../../../../shared/convex-error.mjs";
import { agentSystemPrompt, type LabAgent } from "../lab-prompt";
import { admitAgentModelWork, recordAgentModelWork } from "../model-work";

/*
 * The agent bench: one sample prompt, answered by the agent's draft or by one
 * of its releases (the newest, or an older one the creator picked), streamed
 * back as it is written. It asks the model the way the
 * checks do (the same lab system prompt) through the harness client, so the
 * model, provider and reasoning come only from the environment. The work is
 * admitted against the school's ceiling and metered like any agent model work.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

type DraftAgent = LabAgent & { blueprintKey: string };
type ReleaseAgent = LabAgent & { releaseNumber: number };

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
    const userId = session.userId;
    const body = record(await request.json().catch(() => null));
    const agentId = typeof body.agentId === "string" ? body.agentId : "";
    if (!agentId) throw new Error("AGENT_BENCH_INVALID: Choose an agent first.");
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt)
      throw new Error("AGENT_BENCH_PROMPT_REQUIRED: Write the question first.");
    if (prompt.length > BENCH_LIMITS.prompt)
      throw new Error(
        "AGENT_BENCH_PROMPT_INVALID: Keep the question under 4,000 characters.",
      );
    const target: BenchTarget = body.target === "release" ? "release" : "draft";
    // An older release the creator picked; without one, the newest.
    const pickedRelease =
      typeof body.releaseNumber === "number" &&
      Number.isInteger(body.releaseNumber) &&
      body.releaseNumber > 0
        ? body.releaseNumber
        : undefined;

    let agent: LabAgent;
    let releaseNumber: number | undefined;
    if (target === "release") {
      const release = await convexQuery<
        { agentId: string; releaseNumber?: number },
        ReleaseAgent | null
      >("spectraArtifacts:agentBenchRelease", {
        agentId,
        ...(pickedRelease ? { releaseNumber: pickedRelease } : {}),
      });
      if (!release)
        throw new Error(
          pickedRelease
            ? "AGENT_BENCH_NO_RELEASE: That release is not there any more. Pick another one."
            : "AGENT_BENCH_NO_RELEASE: This agent has no release to compare with yet.",
        );
      agent = release;
      releaseNumber = release.releaseNumber;
    } else {
      // Reading the draft checks the caller may edit this agent. The editor
      // may send its newest content, not yet saved, so a rerun right after an
      // edit answers with that edit.
      const draft = await convexQuery<{ agentId: string }, DraftAgent>(
        "agents:draftForEvaluation",
        { agentId },
      );
      if (draft.blueprintKey !== "agent")
        throw new Error("AGENT_BENCH_INVALID: This is not an agent.");
      const unsaved = record(body.content);
      agent = {
        title: draft.title,
        summary: draft.summary,
        content: Object.keys(unsaved).length > 0 ? unsaved : draft.content,
      };
    }
    await admitAgentModelWork(agentId);

    return createNdjsonResponse(
      async (send) => {
        const emit = (event: BenchStreamEvent) => send(event);
        emit({ type: "start", target, ...(releaseNumber ? { releaseNumber } : {}) });
        let streamed = "";
        const turn = await callSpectraModel({
          messages: [
            { role: "system", content: agentSystemPrompt(agent) },
            { role: "user", content: prompt },
          ],
          signal: request.signal,
          title: "Spectra agent bench",
          onText: (delta) => {
            streamed += delta;
            emit({ type: "text", delta });
          },
          onRetry: () => {
            streamed = "";
            emit({ type: "retry" });
          },
        });
        await recordAgentModelWork(userId, agentId, "agent_bench", {
          inputTokens: turn.usage?.promptTokens ?? 0,
          outputTokens: turn.usage?.completionTokens ?? 0,
        });
        const output = (turn.text || streamed).trim().slice(0, BENCH_LIMITS.output);
        if (!output)
          throw new Error("AGENT_BENCH_EMPTY: The agent gave no answer. Try again.");
        const createdAt = Date.now();
        // Keeping the answer lets the next run compare with it. If it cannot
        // be kept, the answer still shows.
        const kept = await convexMutation<
          {
            agentId: string;
            prompt: string;
            target: BenchTarget;
            releaseNumber?: number;
            output: string;
          },
          { runId: string; createdAt: number }
        >("agents:recordBenchRun", {
          agentId,
          prompt,
          target,
          ...(releaseNumber ? { releaseNumber } : {}),
          output,
        }).catch(() => null);
        const run: BenchRun = {
          id: kept?.runId ?? `unsaved-${createdAt}`,
          prompt,
          target,
          ...(releaseNumber ? { releaseNumber } : {}),
          output,
          createdAt: kept?.createdAt ?? createdAt,
        };
        emit({ type: "done", run });
      },
      (error) => plainMessage(error, "The bench could not finish this answer. Try again."),
    );
  } catch (error) {
    return failure(error);
  }
}
