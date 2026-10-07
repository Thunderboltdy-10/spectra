import {
  BENCH_LIMITS,
  type BenchRun,
  type BenchTarget,
} from "@/features/spectra/agents/foundry";
import { callSpectraModel } from "@/features/spectra/ai/harness/model";
import type { HarnessMessage } from "@/features/spectra/ai/harness/types";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { agentSystemPrompt, type LabAgent } from "../lab-prompt";
import {
  admitAgentModelWork,
  recordHarnessModelWork,
  stoppedTokens,
  turnTokens,
} from "../model-work";

/*
 * One bench answer, shared by the studio's bench route and Spectra's
 * run_agent_bench: the same agent (its draft, or one of its releases), the
 * same lab system prompt, the same model client and the same record of the
 * answer. Reading the draft or the release checks that the caller may edit
 * the agent, and the work is admitted against the school's ceiling first.
 *
 * Stop is not a failure. A stopped answer keeps what it had written, marked
 * stopped, and what it spent is estimated and metered like a finished answer.
 */

type DraftAgent = LabAgent & { blueprintKey: string };
type ReleaseAgent = LabAgent & { releaseNumber: number };

export type BenchQuestion = {
  agentId: string;
  prompt: string;
  target: BenchTarget;
  /** The release to answer as; the newest when left out. */
  releaseNumber?: number;
  /** The draft's newest content, not yet saved; the saved draft when left out. */
  content?: Record<string, unknown>;
};

export type PreparedBenchAnswer = {
  userId: string;
  agentId: string;
  prompt: string;
  target: BenchTarget;
  releaseNumber?: number;
  messages: HarnessMessage[];
};

/** Validates the question, loads the agent and admits the model work. */
export async function prepareBenchAnswer(
  userId: string,
  question: BenchQuestion,
): Promise<PreparedBenchAnswer> {
  const prompt = question.prompt.trim();
  if (!prompt) throw new Error("AGENT_BENCH_PROMPT_REQUIRED: Write the question first.");
  if (prompt.length > BENCH_LIMITS.prompt)
    throw new Error("AGENT_BENCH_PROMPT_INVALID: Keep the question under 4,000 characters.");
  const { agentId, target } = question;
  let agent: LabAgent;
  let releaseNumber: number | undefined;
  if (target === "release") {
    const picked = question.releaseNumber;
    const release = await convexQuery<
      { agentId: string; releaseNumber?: number },
      ReleaseAgent | null
    >("spectraArtifacts:agentBenchRelease", {
      agentId,
      ...(picked ? { releaseNumber: picked } : {}),
    });
    if (!release)
      throw new Error(
        picked
          ? "AGENT_BENCH_NO_RELEASE: That release is not there any more. Pick another one."
          : "AGENT_BENCH_NO_RELEASE: This agent has no release to compare with yet.",
      );
    agent = release;
    releaseNumber = release.releaseNumber;
  } else {
    // Reading the draft checks the caller may edit this agent.
    const draft = await convexQuery<{ agentId: string }, DraftAgent>(
      "agents:draftForEvaluation",
      { agentId },
    );
    if (draft.blueprintKey !== "agent")
      throw new Error("AGENT_BENCH_INVALID: This is not an agent.");
    const unsaved = question.content ?? {};
    agent = {
      title: draft.title,
      summary: draft.summary,
      content: Object.keys(unsaved).length > 0 ? unsaved : draft.content,
    };
  }
  await admitAgentModelWork(agentId);
  return {
    userId,
    agentId,
    prompt,
    target,
    ...(releaseNumber ? { releaseNumber } : {}),
    messages: [
      { role: "system", content: agentSystemPrompt(agent) },
      { role: "user", content: prompt },
    ],
  };
}

/** Keeps the answer so the next run can be compared with it; it still shows if it cannot be kept. */
async function keep(prepared: PreparedBenchAnswer, output: string, stopped: boolean): Promise<BenchRun> {
  const createdAt = Date.now();
  const kept = await convexMutation<
    {
      agentId: string;
      prompt: string;
      target: BenchTarget;
      releaseNumber?: number;
      output: string;
      stopped?: boolean;
    },
    { runId: string; createdAt: number }
  >("agents:recordBenchRun", {
    agentId: prepared.agentId,
    prompt: prepared.prompt,
    target: prepared.target,
    ...(prepared.releaseNumber ? { releaseNumber: prepared.releaseNumber } : {}),
    output,
    ...(stopped ? { stopped: true } : {}),
  }).catch(() => null);
  return {
    id: kept?.runId ?? `unsaved-${createdAt}`,
    prompt: prepared.prompt,
    target: prepared.target,
    ...(prepared.releaseNumber ? { releaseNumber: prepared.releaseNumber } : {}),
    output,
    createdAt: kept?.createdAt ?? createdAt,
    ...(stopped ? { stopped: true as const } : {}),
  };
}

/**
 * Asks the agent and streams its answer into `onText`. Resolves with the
 * answer as kept, stopped or finished; a stop before any text rethrows.
 */
export async function answerOnBench(
  prepared: PreparedBenchAnswer,
  options: {
    signal: AbortSignal;
    onText?: (delta: string) => void;
    onRetry?: () => void;
  },
): Promise<BenchRun> {
  let streamed = "";
  let turn: Awaited<ReturnType<typeof callSpectraModel>>;
  try {
    turn = await callSpectraModel({
      messages: prepared.messages,
      signal: options.signal,
      title: "Spectra agent bench",
      onText: (delta) => {
        streamed += delta;
        options.onText?.(delta);
      },
      onRetry: () => {
        streamed = "";
        options.onRetry?.();
      },
    });
  } catch (error) {
    if (!options.signal.aborted) throw error;
    await recordHarnessModelWork(
      prepared.userId,
      prepared.agentId,
      "agent_bench",
      stoppedTokens(prepared.messages, streamed.length),
      { stopped: true },
    );
    const partial = streamed.trim().slice(0, BENCH_LIMITS.output);
    if (!partial) throw error;
    return keep(prepared, partial, true);
  }
  await recordHarnessModelWork(prepared.userId, prepared.agentId, "agent_bench", turnTokens(turn.usage));
  const output = (turn.text || streamed).trim().slice(0, BENCH_LIMITS.output);
  if (!output) throw new Error("AGENT_BENCH_EMPTY: The agent gave no answer. Try again.");
  return keep(prepared, output, false);
}
