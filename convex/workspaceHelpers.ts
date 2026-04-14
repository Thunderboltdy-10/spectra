/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import type { Id } from "./_generated/dataModel";

export type WorkspaceItemStorageType =
  | "thread"
  | "artifact"
  | "planner"
  | "utility"
  | "custom";

export type WorkspaceItemCategory =
  | "threads"
  | "documents"
  | "planner"
  | "boards"
  | "visualizations"
  | "media"
  | "references"
  | "custom";

export type WorkspaceSearchResultSource =
  | "workstream"
  | "artifact"
  | "planner"
  | "thread";

export function normalizeCanonicalWorkspaceItemType(
  value: string | null | undefined,
): WorkspaceItemStorageType {
  if (
    value === "thread"
    || value === "artifact"
    || value === "planner"
    || value === "utility"
    || value === "custom"
  ) {
    return value;
  }
  return "custom";
}

export function resolveCanonicalWorkspaceItemType(params: {
  itemType?: string | null;
  legacyType?: string | null;
  sourceChatId?: Id<"chats"> | null;
  sourceArtifactId?: Id<"artifacts"> | null;
  sourcePlannerItemId?: Id<"plannerItems"> | null;
}): WorkspaceItemStorageType {
  if (params.itemType) return normalizeCanonicalWorkspaceItemType(params.itemType);
  if (params.sourceChatId) return "thread";
  if (params.sourcePlannerItemId) return "planner";
  if (params.sourceArtifactId) return "artifact";
  if (params.legacyType === "thread") return "thread";
  if (params.legacyType === "planner") return "planner";
  if (params.legacyType === "utility") return "utility";
  if (params.legacyType === "custom") return "custom";
  return "artifact";
}

export function resolveWorkspaceCategory(params: {
  category?: string | null;
  itemType?: string | null;
  renderMode?: string | null;
  legacyType?: string | null;
}): WorkspaceItemCategory {
  if (
    params.category === "threads"
    || params.category === "documents"
    || params.category === "planner"
    || params.category === "boards"
    || params.category === "visualizations"
    || params.category === "media"
    || params.category === "references"
    || params.category === "custom"
  ) {
    return params.category;
  }

  const itemType = normalizeCanonicalWorkspaceItemType(params.itemType);
  if (itemType === "thread") return "threads";
  if (itemType === "planner") return "planner";

  switch (params.renderMode ?? params.legacyType) {
    case "board":
      return "boards";
    case "visualization":
    case "diagram":
    case "concept_map":
    case "image":
    case "timeline":
      return "visualizations";
    case "media":
      return "media";
    case "reference":
      return "references";
    default:
      return "documents";
  }
}

export async function recordWorkspaceMutation(
  ctx: { db: { insert: Function; get: Function; patch: Function } },
  args: {
    orgId: Id<"orgs">;
    ownerUserId: Id<"users">;
    workstreamId?: Id<"workstreams">;
    targetWorkstreamId?: Id<"workstreams">;
    mutationType: string;
    source: "user" | "ai" | "system";
    entity?: string;
    action?: string;
    includeHub?: boolean;
    refreshHub?: boolean;
    summary?: string;
    targetItemIds?: Id<"workspaceItems">[];
    before?: unknown;
    after?: unknown;
    revertData?: unknown;
    revisionKey?: string;
  },
): Promise<Id<"workspaceMutations"> | undefined> {
  const now = Date.now();
  const touched = Array.from(new Set([args.workstreamId, args.targetWorkstreamId].filter(Boolean))) as Id<"workstreams">[];
  const summary = args.summary ?? ([args.action, args.entity, args.mutationType.replace(/_/g, " ")].filter(Boolean).join(" ") || args.mutationType.replace(/_/g, " "));
  const revertData = args.revertData ?? {
    entity: args.entity,
    action: args.action,
    includeHub: args.includeHub ?? false,
    refreshHub: args.refreshHub ?? false,
    before: args.before,
    after: args.after,
    targetWorkstreamId: args.targetWorkstreamId,
    targetItemIds: args.targetItemIds,
  };
  const revisionKey = args.revisionKey ?? `${args.mutationType}:${now}`;

  const mutationId = await ctx.db.insert("workspaceMutations", {
    orgId: args.orgId,
    ownerUserId: args.ownerUserId,
    workstreamId: args.workstreamId,
    targetWorkstreamId: args.targetWorkstreamId,
    mutationType: args.mutationType,
    source: args.source,
    summary,
    targetItemIds: args.targetItemIds,
    before: args.before,
    after: args.after,
    revertData,
    revisionKey,
    affectedWorkstreamIds: touched,
    status: "applied",
    createdAt: now,
    updatedAt: now,
  });

  for (const workstreamId of touched) {
    const workstream = await ctx.db.get(workstreamId);
    if (!workstream) continue;
    await ctx.db.patch(workstreamId, {
      updatedAt: now,
      lastActivityAt: now,
      workspaceRevision: now,
      workspaceRevisionKey: `${revisionKey}:${workstreamId}`,
      lastWorkspaceMutationId: mutationId,
    });
  }

  return mutationId;
}

export function computeWorkspaceItemDefaultFrame(params: {
  itemType: WorkspaceItemStorageType;
  renderMode?: string | null;
  pinned?: boolean;
}) {
  if (params.itemType === "thread") {
    return {
      x: 120,
      y: 420,
      width: 320,
      height: 180,
    };
  }

  if (params.itemType === "planner") {
    return {
      x: 80,
      y: 220,
      width: 280,
      height: 160,
    };
  }

  switch (params.renderMode) {
    case "board":
      return { x: 120, y: 120, width: 520, height: 360 };
    case "diagram":
    case "concept_map":
    case "timeline":
    case "image":
    case "visualization":
      return { x: 120, y: 120, width: 420, height: 280 };
    default:
      return {
        x: params.pinned ? 80 : 120,
        y: params.pinned ? 120 : 120,
        width: 320,
        height: 200,
      };
  }
}

export function buildWorkspaceSearchText(...parts: Array<string | null | undefined>) {
  return parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
