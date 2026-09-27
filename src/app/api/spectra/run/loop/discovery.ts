import { mapOperationArtifactReferences } from "@/features/spectra/operations/dependencies";
import type { SpectraPlan } from "@/features/spectra/operations/schema";
import { buildContext, rows, summarizeArtifact } from "./gather";
import { query } from "./io";

type Context = Awaited<ReturnType<typeof buildContext>>;
export type AuthenticatedPlacement = { id: string; workspaceId: string; artifactId?: string };

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

/** Only canonical result fields confer discovery. Never traverse authored
 * content, messages, memory claims, source bundles or arbitrary nested ids. */
export function authenticatedArtifactObservations(name: string, result: unknown) {
  const value = record(result);
  if (value?.ok !== true) return [];
  const candidates = name === "read_artifact" ? [value.artifact]
    : name === "search_objects" ? rows(value.results)
    : name === "read_workspace" ? rows(record(value.workspace)?.items).map((item) => item.artifact) : [];
  return candidates.flatMap((candidate) => {
    const item = record(candidate);
    const id = item?.id ?? item?._id;
    if (!item || typeof id !== "string" || typeof item.blueprintKey !== "string") return [];
    return [{ id, blueprintKey: item.blueprintKey, title: item.title,
      summary: item.summary, placements: rows(item.placements).map((placement) => ({
        workspaceId: placement.workspaceId, workspaceTitle: placement.workspaceTitle, nodeId: placement.nodeId,
      })) }];
  });
}

/** Reauthorize exact final references before the resolver. Discovery is a
 * planning observation, not continuing permission. These reads never change
 * the user's focus, selection or viewport, and never load editor bodies. */
export async function gatherPlanReferenceContext(actorClerkId: string, context: Context, plan: SpectraPlan): Promise<Context & {
  authenticatedPlacementNodes: AuthenticatedPlacement[];
}> {
  const artifactIds = new Set<string>();
  const workspaceIds = new Set<string>();
  const threadIds = new Set<string>();
  const nodeIds = new Set<string>();
  for (const operation of plan.operations) {
    mapOperationArtifactReferences(operation, (id) => {
      if (!id.startsWith("@created:")) artifactIds.add(id);
      return id;
    });
    if ("workspaceId" in operation.input && typeof operation.input.workspaceId === "string") workspaceIds.add(operation.input.workspaceId);
    if (operation.type === "workspaceItem.hide" || operation.type === "workspaceItem.setPinned") nodeIds.add(operation.input.nodeId);
    if (operation.type === "artifact.create" && operation.input.blueprintKey === "planner_task")
      for (const id of operation.input.content.linkedThreadIds ?? []) threadIds.add(id);
  }
  // The plan schema bounds operation count; references inside content have
  // their own schemas. Refuse excess rather than silently dropping targets.
  if (artifactIds.size + workspaceIds.size + threadIds.size + nodeIds.size > 128)
    throw new Error("This plan has too many distinct references. Split the remaining work into smaller steps.");
  const read = async (name: string, args: Record<string, unknown>) => {
    const value = record(await query(name, { actorClerkId, ...args }));
    if (!value) throw new Error("A requested target object ID is no longer accessible. Read it again before proposing changes.");
    return value;
  };
  const [artifacts, workspaces, threads, nodes] = await Promise.all([
    Promise.all([...artifactIds].map(async (artifactId) => {
      const value = await read("spectraContext:getArtifact", { artifactId });
      if (value._id !== artifactId) throw new Error("The requested artifact object ID could not be verified.");
      return summarizeArtifact(value);
    })),
    Promise.all([...workspaceIds].map(async (workspaceId) => {
      const value = record((await read("spectraContext:getWorkspace", { workspaceId })).workspace);
      if (value?._id !== workspaceId) throw new Error("The requested workspace object ID could not be verified.");
      return { id: value._id, title: value.title, description: value.description, explicit: false, objects: undefined };
    })),
    Promise.all([...threadIds].map(async (threadId) => {
      const value = await read("spectraThreads:getSummary", { threadId });
      const thread = record(value.thread) ?? value;
      if (thread._id !== threadId) throw new Error("The requested conversation object ID could not be verified.");
      return thread;
    })),
    Promise.all([...nodeIds].map(async (nodeId) => {
      const node = record((await read("orgTree:path", { nodeId })).node);
      if (node?._id !== nodeId || node.deletedAt != null || typeof node.workspaceContextId !== "string")
        throw new Error("The requested workspace item object ID is no longer available.");
      return { id: nodeId, workspaceId: node.workspaceContextId,
        ...(node.kind === "work" && typeof node.sourceId === "string" ? { artifactId: node.sourceId } : {}) };
    })),
  ]);
  return {
    ...context,
    artifacts: [...context.artifacts.filter((item) => !artifactIds.has(String(item.id))), ...artifacts],
    workspaces: [...context.workspaces.filter((item) => !workspaceIds.has(String(item.id))), ...workspaces],
    threads: [...context.threads, ...threads.map((item) => ({
      id: item._id, title: item.title, summary: item.summaryShort, explicit: false,
      workspaceId: item.workspaceId, lastMessageAt: item.lastMessageAt, contextExcerpt: undefined,
    }))],
    authenticatedPlacementNodes: nodes,
  };
}
