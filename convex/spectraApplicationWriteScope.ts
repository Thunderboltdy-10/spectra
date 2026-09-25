import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortedValue(child)]));
}

/** Exact structural comparison, independent of JSON property ordering. */
export function applicationOperationScope(operation: { type: string; input: unknown }) {
  return JSON.stringify(sortedValue({ type: operation.type, input: operation.input }));
}

export function applicationWriteReceipt(output: unknown): { scope: string; result: unknown } | undefined {
  if (!output || typeof output !== "object") return undefined;
  const receipt = (output as Record<string, unknown>).applicationWriteReceipt;
  return receipt && typeof receipt === "object" && typeof (receipt as Record<string, unknown>).scope === "string" && "result" in receipt
    ? receipt as { scope: string; result: unknown } : undefined;
}

// These are review limits, not truncation. Larger deletions need a smaller plan;
// an approval must never silently describe only the first part of its effect.
const MAX_APPROVAL_NODES = 1_000;
const MAX_APPROVAL_REPLICAS = 1_000;
const MAX_REPLICAS_PER_WORK = 50;
const row = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function deletionTargets(
  ctx: QueryCtx | MutationCtx,
  operation: Doc<"spectraOperations">,
  run: Doc<"spectraAiRuns">,
) {
  const args = row(row(operation.input).args);
  if (!Array.isArray(args.targetIds) || args.targetIds.length > 200)
    throw new Error("AI_APPLICATION_APPROVAL_SCOPE_TOO_LARGE: Review at most 200 roots at a time.");
  const nodes = new Map<string, Doc<"orgNodes">>();
  const queue: Doc<"orgNodes">[] = [];
  const add = (node: Doc<"orgNodes">) => {
    if (node.accountId !== run.ownerAccountId || (node.schoolId && node.schoolId !== run.schoolId))
      throw new Error("AI_APPLICATION_APPROVAL_TARGET_UNAVAILABLE");
    if (nodes.has(node._id)) return;
    if (nodes.size >= MAX_APPROVAL_NODES)
      throw new Error("AI_APPLICATION_APPROVAL_SCOPE_TOO_LARGE: Review a smaller subtree.");
    nodes.set(node._id, node);
    queue.push(node);
  };
  for (const target of new Set(args.targetIds)) {
    const id = typeof target === "string" ? ctx.db.normalizeId("orgNodes", target) : null;
    const node = id ? await ctx.db.get(id) : null;
    if (!node) throw new Error("AI_APPLICATION_APPROVAL_TARGET_UNAVAILABLE");
    add(node);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const parent = queue[cursor];
    if (parent.deletedAt !== undefined || (parent.kind !== "folder" && parent.kind !== "workspace")) continue;
    // The extra row detects overflow. The indexed live filter also avoids
    // loading an arbitrarily large trash history to describe a live deletion.
    const children = await ctx.db.query("orgNodes")
      .withIndex("by_parent_live_activity", q => q.eq("parentId", parent._id).eq("deletedAt", undefined))
      .take(MAX_APPROVAL_NODES + 1);
    for (const child of children) add(child);
  }
  const localTargets: Record<string, unknown>[] = [];
  const seenWorks = new Set<string>();
  for (const node of nodes.values()) {
    if (node.kind !== "work" || !node.sourceId || seenWorks.has(node.sourceId)) continue;
    seenWorks.add(node.sourceId);
    const workId = ctx.db.normalizeId("spectraArtifacts", node.sourceId);
    if (!workId) throw new Error("AI_APPLICATION_APPROVAL_TARGET_UNAVAILABLE");
    const replicas = await ctx.db.query("workReplicas")
      .withIndex("by_work_kind", q => q.eq("workId", workId).eq("kind", "local"))
      .take(Math.min(MAX_REPLICAS_PER_WORK, MAX_APPROVAL_REPLICAS - localTargets.length) + 1);
    if (replicas.length > MAX_REPLICAS_PER_WORK || localTargets.length + replicas.length > MAX_APPROVAL_REPLICAS)
      throw new Error("AI_APPLICATION_APPROVAL_SCOPE_TOO_LARGE: Review fewer connected files.");
    for (const replica of replicas) localTargets.push({
      id: replica._id, workId, accountId: replica.accountId,
      deviceId: replica.deviceId, mountId: replica.mountId,
      localResourceId: replica.localResourceId, relativePath: replica.relativePath,
      available: replica.state !== "unavailable",
    });
  }
  const available = localTargets.filter(target => target.available).length;
  if (available > Number(args.localFileCount ?? 0) && args.localFileCountUnknown !== true)
    throw new Error("AI_APPLICATION_LOCAL_EFFECT_CHANGED");
  return {
    nodes: [...nodes.values()].sort((a, b) => a._id.localeCompare(b._id)).map(node => ({
      id: node._id, accountId: node.accountId, schoolId: node.schoolId,
      parentId: node.parentId, kind: node.kind, sourceId: node.sourceId,
      name: node.name, workspaceContextId: node.workspaceContextId, deletedAt: node.deletedAt,
    })),
    localTargets: localTargets.sort((a, b) => String(a.id).localeCompare(String(b.id))),
  };
}

/** Bind approval to what was presented, including the effects of tree expansion.
 * The caller rechecks this inside the same transaction as acceptance or writing.
 * Receipts retain their original structural scope so old completed writes can
 * still be recovered without repeating a now-changed/deleted target's effect. */
export async function applicationApprovalScope(
  ctx: QueryCtx | MutationCtx,
  operation: Doc<"spectraOperations">,
  run: Doc<"spectraAiRuns">,
) {
  const input = row(operation.input);
  const args = row(input.args);
  const value = sortedValue({
    version: 2, runId: run._id, executionId: operation.executionId, operationId: operation._id,
    type: operation.type, input: operation.input,
    ...(input.command === "organize_library" && !args.destinationId
      ? { scopeNodeId: row(run.contextSnapshot).scopeNodeId } : {}),
    ...(input.command === "delete_library_items" ? { targets: await deletionTargets(ctx, operation, run) } : {}),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return `v2:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
