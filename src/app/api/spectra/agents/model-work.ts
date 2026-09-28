import { createHmac, randomUUID } from "node:crypto";
import { convexMutation } from "@/lib/convex-server";

/**
 * Model work the agent routes do outside a Spectra run (Agent Foundry, agent
 * evaluation) is admitted against the school's model-token ceiling and its
 * tokens are metered to the school, as a run's are. The route reports what it
 * spent under the user's session; the server-held bridge key signs the report
 * so a browser cannot invent or alter it (convex/agents.ts verifyAgentBridge).
 */

export type ModelTokens = { inputTokens: number; outputTokens: number };
export type AgentModelWorkPurpose = "agent_foundry" | "agent_eval_generate";

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
