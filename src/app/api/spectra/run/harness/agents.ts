import { mutate, query } from "./io";

/*
 * The user's custom agents. Spectra lists them for the model, which hands a
 * request to one with use_agent when it clearly fits; a thread keeps the agent
 * it last used until the user clears it.
 */

export type AgentIndexEntry = { id: string; title: string; description: string };

export type AgentRouting = {
  actorClerkId: string;
  runId: string;
  executionId: string;
};

const MAX_AGENTS = 20;

export const AGENT_UNAVAILABLE = "AI_AGENT_UNAVAILABLE";
export const AGENT_UNAVAILABLE_MESSAGE =
  "The agent you chose is no longer available to you. Choose another agent or switch back to Auto.";

/** The agent the user chose cannot run: never a silent fallback to Auto. */
export class AgentUnavailableError extends Error {
  readonly code = AGENT_UNAVAILABLE;
  constructor() {
    super(AGENT_UNAVAILABLE_MESSAGE);
    this.name = "AgentUnavailableError";
  }
}

/** Agents the user owns or was granted that accept routed requests. */
export async function readAgentIndex(actorClerkId: string): Promise<AgentIndexEntry[]> {
  const rows = await query<unknown & object, unknown>("spectraArtifacts:listAgentRoutingDescriptors", { actorClerkId }).catch(
    () => [],
  );
  if (!Array.isArray(rows)) return [];
  return rows
    .flatMap((row) => {
      const value = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      const id = typeof value.agentId === "string" ? value.agentId : "";
      const title = typeof value.title === "string" ? value.title.trim() : "";
      if (!id || !title) return [];
      const description =
        (typeof value.description === "string" && value.description.trim()) ||
        (typeof value.summary === "string" && value.summary.trim()) ||
        "";
      return [{ id, title: title.slice(0, 120), description: description.replace(/\s+/g, " ").slice(0, 300) }];
    })
    .slice(0, MAX_AGENTS);
}

export type ThreadSummary = { retainedAgentId?: string; needsTitle: boolean };

/**
 * What a run needs to know about its thread: the agent it used last (unless
 * the user cleared it) and whether it still needs a generated title.
 */
export async function readThreadSummary(actorClerkId: string, threadId: string | undefined): Promise<ThreadSummary | null> {
  if (!threadId) return null;
  const summary = await query<unknown & object, { retainedAgentId?: unknown; needsTitle?: unknown } | null>(
    "spectraThreads:getSummary",
    { actorClerkId, threadId },
  ).catch(() => null);
  if (!summary) return null;
  return {
    ...(typeof summary.retainedAgentId === "string" ? { retainedAgentId: summary.retainedAgentId } : {}),
    needsTitle: summary.needsTitle === true,
  };
}

/**
 * Loads an agent's instructions and records it on the run (and its thread).
 * Returns null when the agent is unavailable or no longer permitted.
 */
export async function loadAgent(
  routing: AgentRouting,
  agentId: string,
  source: "explicit" | "continued" | "automatic",
  reason: string,
): Promise<{ id: string; title: string; instructions: string } | null> {
  const runtime = await query<unknown & object, { agentId: string; title: string; instructions?: unknown } | null>(
    "spectraArtifacts:getAgentRuntime",
    { actorClerkId: routing.actorClerkId, agentId },
  ).catch(() => null);
  if (!runtime || typeof runtime.agentId !== "string") return null;
  await mutate("spectraRuns:setAgentRouting", {
    ...routing,
    agentId: runtime.agentId,
    confidence: 1,
    reason,
    source,
  }).catch(() => null);
  return {
    id: runtime.agentId,
    title: typeof runtime.title === "string" ? runtime.title : "Agent",
    instructions: typeof runtime.instructions === "string" ? runtime.instructions : "",
  };
}
