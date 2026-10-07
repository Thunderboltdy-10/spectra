import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  BENCH_LIMITS,
  benchSuggestionMessages,
  normalizeBenchChecks,
  normalizeFoundryContent,
  parseBenchSuggestions,
  readBenchInstructions,
  benchChecksEmpty,
} from "@/features/spectra/agents/foundry";
import { callSpectraModel } from "@/features/spectra/ai/harness/model";
import { ProviderUnavailableError } from "@/features/spectra/ai/harness/types";
import { convexQuery } from "@/lib/convex-server";
import { readConvexError } from "../../../../../../../shared/convex-error.mjs";
import { admitAgentModelWork, recordAgentModelWork } from "../../model-work";

/*
 * Model-written suggestions for one bench answer: the model reads the draft's
 * instructions, the question, the answer and how the creator's checks went,
 * and proposes edits to the instructions. Nothing is applied here; the bench
 * shows them and the creator applies one to the draft. The model, provider and
 * reasoning come only from the environment, through the harness client, and
 * the work is admitted and metered like any other bench answer.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

type DraftAgent = { title: string; summary?: string; blueprintKey: string; content: unknown };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function plainMessage(error: unknown, fallback: string) {
  if (error instanceof ProviderUnavailableError)
    return "Spectra could not reach the AI model. Try again in a moment.";
  const { code, message } = readConvexError(error);
  const sentence = code ? message.slice(code.length).replace(/^:\s*/, "") : "";
  return sentence || fallback;
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
    const output = typeof body.output === "string" ? body.output.trim() : "";
    if (!prompt || !output)
      throw new Error("AGENT_BENCH_SUGGEST_INVALID: Run the question first, then ask for suggestions.");
    if (prompt.length > BENCH_LIMITS.prompt || output.length > BENCH_LIMITS.output)
      throw new Error("AGENT_BENCH_SUGGEST_INVALID: This answer is too long to suggest changes for.");

    // Reading the draft checks the caller may edit this agent. The editor may
    // send its newest content, not yet saved, so suggestions fit what it shows.
    const draft = await convexQuery<{ agentId: string }, DraftAgent>("agents:draftForEvaluation", { agentId });
    if (draft.blueprintKey !== "agent") throw new Error("AGENT_BENCH_INVALID: This is not an agent.");
    const unsaved = record(body.content);
    const content = normalizeFoundryContent(Object.keys(unsaved).length > 0 ? unsaved : draft.content);
    if (!content.foundry.foundationEstablished)
      throw new Error("AGENT_BENCH_SUGGEST_UNAVAILABLE: Compile the agent's skills first, then ask for suggestions.");
    const instructions = readBenchInstructions(content);
    const checks = normalizeBenchChecks(body.checks);

    await admitAgentModelWork(agentId);
    const turn = await callSpectraModel({
      messages: benchSuggestionMessages({
        instructions,
        prompt,
        output,
        ...(benchChecksEmpty(checks) ? {} : { checks }),
      }),
      signal: request.signal,
      title: "Spectra agent bench suggestions",
    });
    await recordAgentModelWork(userId, agentId, "agent_bench", {
      inputTokens: turn.usage?.promptTokens ?? 0,
      outputTokens: turn.usage?.completionTokens ?? 0,
    });
    return NextResponse.json({ suggestions: parseBenchSuggestions(turn.text, instructions) });
  } catch (error) {
    const { message } = readConvexError(error);
    const status = /AUTH_NOT_SIGNED_IN/.test(message)
      ? 401
      : /AUTH_RESOURCE_FORBIDDEN|permission/i.test(message)
        ? 403
        : error instanceof ProviderUnavailableError
          ? 503
          : 400;
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: readConvexError(error).code,
          message: plainMessage(error, "Spectra could not suggest changes this time. Try again."),
        },
      },
      { status },
    );
  }
}
