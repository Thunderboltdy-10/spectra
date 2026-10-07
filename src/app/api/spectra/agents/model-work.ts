import { createHmac, randomUUID } from "node:crypto";
import { estimateTokens } from "@/features/spectra/ai/harness/compaction";
import type { HarnessMessage } from "@/features/spectra/ai/harness/types";
import { insideRunUsageLedger, recordProviderUsage } from "@/features/spectra/ai/run-usage";
import { convexMutation } from "@/lib/convex-server";

/**
 * Model work the agent routes do outside a Spectra run (Agent Foundry, agent
 * evaluation) is admitted against the school's model-token ceiling and its
 * tokens are metered to the school, as a run's are. The route reports what it
 * spent under the user's session; the server-held bridge key signs the report
 * so a browser cannot invent or alter it (convex/agents.ts verifyAgentBridge).
 */

export type ModelTokens = { inputTokens: number; outputTokens: number };
export type AgentModelWorkPurpose =
  | "agent_foundry"
  | "agent_eval_generate"
  | "agent_bench";

export function agentBridgeKey() {
  const key =
    process.env.SPECTRA_AGENT_EVAL_BRIDGE_KEY ??
    process.env.SPECTRA_SECRET_BRIDGE_KEY;
  if (!key || key.length < 32)
    throw new Error(
      "Agent evaluation is not configured with a strong server bridge key.",
    );
  return key;
}

export function signAgentBridge(
  operation: "agent-eval-settle" | "agent-model-work",
  userId: string,
  subjectId: string,
  payloadDigest: string,
) {
  const timestamp = Date.now();
  const nonce = randomUUID();
  const signature = createHmac("sha256", agentBridgeKey())
    .update(
      [operation, userId, subjectId, timestamp, nonce, payloadDigest].join("|"),
    )
    .digest("base64url");
  return { timestamp, nonce, signature };
}

/** OpenRouter reports prompt/completion tokens on every completion. */
export function openRouterTokens(usage: unknown): ModelTokens {
  const record =
    usage && typeof usage === "object" && !Array.isArray(usage)
      ? (usage as Record<string, unknown>)
      : {};
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.round(value))
      : 0;
  return {
    inputTokens: count(record.prompt_tokens),
    outputTokens: count(record.completion_tokens),
  };
}

/** What a harness turn (callSpectraModel) reported it spent. */
export function turnTokens(usage?: { promptTokens?: number; completionTokens?: number }): ModelTokens {
  return { inputTokens: usage?.promptTokens ?? 0, outputTokens: usage?.completionTokens ?? 0 };
}

/**
 * A stopped stream ends before the provider reports usage, so what it spent
 * is estimated: the messages sent, and the text that came back before Stop.
 */
export function stoppedTokens(messages: readonly HarnessMessage[], streamedChars: number): ModelTokens {
  return { inputTokens: estimateTokens(messages), outputTokens: Math.ceil(Math.max(0, streamedChars) / 3.5) };
}

/**
 * Meters agent model work done through the harness client. Inside a Spectra
 * run, the run's ledger already counts every provider response the client
 * reads, so a finished turn is not metered twice; a stopped one reported no
 * usage, so its estimate joins the run's ledger. Outside a run it is metered
 * as agent model work, signed by the server.
 */
export async function recordHarnessModelWork(
  userId: string,
  agentId: string,
  purpose: AgentModelWorkPurpose,
  spent: ModelTokens,
  options: { stopped?: boolean } = {},
) {
  if (insideRunUsageLedger()) {
    if (options.stopped)
      recordProviderUsage({ promptTokens: spent.inputTokens, completionTokens: spent.outputTokens });
    return;
  }
  await recordAgentModelWork(userId, agentId, purpose, spent);
}

/** Throws the school's plain "AI usage limit" message once it is reached. */
export async function admitAgentModelWork(agentId: string) {
  await convexMutation("agents:admitModelWork", { agentId });
}

/**
 * Meter what was spent. The model work already happened, so a failure here
 * does not fail the user's request; it is logged (no ids or content).
 */
export async function recordAgentModelWork(
  userId: string,
  agentId: string,
  purpose: AgentModelWorkPurpose,
  spent: ModelTokens,
) {
  const inputTokens = Math.max(0, Math.round(spent.inputTokens));
  const outputTokens = Math.max(0, Math.round(spent.outputTokens));
  if (inputTokens <= 0 && outputTokens <= 0) return;
  try {
    const signed = signAgentBridge(
      "agent-model-work",
      userId,
      agentId,
      `${purpose}:${inputTokens}:${outputTokens}`,
    );
    await convexMutation("agents:recordModelWork", {
      agentId,
      purpose,
      inputTokens,
      outputTokens,
      ...signed,
    });
  } catch (error) {
    console.warn("[spectra.agents.model_work.meter_failed]", {
      purpose,
      reason: error instanceof Error ? error.message.slice(0, 160) : "unknown",
    });
  }
}
