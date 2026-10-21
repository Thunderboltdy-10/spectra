import { act, mutate, query } from "./io";
import { isPermissionCategory, type PermissionCategory } from "@/features/spectra/settings/schema/ai-permissions";

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

/** An agent with fewer words of instructions than this is still blank: it runs only when chosen. */
const READY_INSTRUCTION_CHARS = 80;
/** Up to this many ready agents are offered as they are; past it, only the ones the request is about. */
const OFFERED_AGENTS = 5;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

/** What the model reads about an agent: what it is for, a few requests it takes and what it is not for. */
function describeAgent(value: Record<string, unknown>) {
  const purpose = text(value.description) || text(value.purpose);
  const examples = strings(value.examples).slice(0, 3);
  const not = strings(value.negativeExamples).slice(0, 2);
  return [
    purpose,
    examples.length ? `Takes requests like: ${examples.map((example) => `"${example}"`).join(", ")}.` : "",
    not.length ? `Not for: ${not.map((example) => `"${example}"`).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 400);
}

/**
 * The user's agents Spectra may hand this request to. Only agents that are
 * ready (real instructions, a stated purpose) are offered; a blank one runs
 * only when the user picks it in the island. With a handful they are all
 * offered; with more, the request's meaning picks the few it could be about,
 * so a long list never tempts the model into using one for everything.
 */
export async function readAgentIndex(actorClerkId: string, prompt = ""): Promise<AgentIndexEntry[]> {
  const rows = await query<unknown & object, unknown>("spectraArtifacts:listAgentRoutingDescriptors", { actorClerkId }).catch(
    () => [],
  );
  if (!Array.isArray(rows)) return [];
  const ready = rows.flatMap((row) => {
    const value = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const id = text(value.agentId);
    const title = text(value.title);
    const description = describeAgent(value);
    const chars = typeof value.instructionChars === "number" ? value.instructionChars : 0;
    if (!id || !title || !description || chars < READY_INSTRUCTION_CHARS) return [];
    return [{ id, title: title.slice(0, 120), description }];
  });
  if (ready.length <= OFFERED_AGENTS || !prompt.trim()) return ready.slice(0, OFFERED_AGENTS);
  const found = await act<unknown & object, { results?: Array<{ itemId?: unknown }> }>("semantic:search", {
    query: prompt.trim().slice(0, 500),
    kinds: ["artifact"],
    limit: 30,
  }).catch(() => null);
  const rank = new Map((found?.results ?? []).map((result, index) => [String(result.itemId ?? ""), index]));
  return ready
    .filter((agent) => rank.has(agent.id))
    .sort((left, right) => rank.get(left.id)! - rank.get(right.id)!)
    .slice(0, OFFERED_AGENTS);
}

export type ThreadSummary = { retainedAgentId?: string; needsTitle: boolean; allowedPermissionCategories: PermissionCategory[] };

/**
 * What a run needs to know about its thread: the agent it used last (unless
 * the user cleared it) and whether it still needs a generated title.
 */
export async function readThreadSummary(actorClerkId: string, threadId: string | undefined): Promise<ThreadSummary | null> {
  if (!threadId) return null;
  const summary = await query<unknown & object, { retainedAgentId?: unknown; needsTitle?: unknown; allowedPermissionCategories?: unknown } | null>(
    "spectraThreads:getSummary",
    { actorClerkId, threadId },
  ).catch(() => null);
  if (!summary) return null;
  return {
    ...(typeof summary.retainedAgentId === "string" ? { retainedAgentId: summary.retainedAgentId } : {}),
    needsTitle: summary.needsTitle === true,
    allowedPermissionCategories: Array.isArray(summary.allowedPermissionCategories)
      ? summary.allowedPermissionCategories.filter(isPermissionCategory)
      : [],
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
