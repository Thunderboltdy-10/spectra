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

export function normalizeWorkspaceWidgetState(
  kind: string | null | undefined,
  state: unknown,
) {
  const base =
    state && typeof state === "object" && !Array.isArray(state)
      ? { ...(state as Record<string, unknown>) }
      : {};

  if (kind === "timer") {
    const totalSecsRaw = typeof base.totalSecs === "number" && Number.isFinite(base.totalSecs)
      ? base.totalSecs
      : typeof base.secs === "number" && Number.isFinite(base.secs)
        ? base.secs
        : 25 * 60;
    const totalSecs = Math.max(60, Math.floor(totalSecsRaw));
    const secsRaw = typeof base.secs === "number" && Number.isFinite(base.secs) ? base.secs : totalSecs;
    const secs = Math.max(0, Math.min(totalSecs, Math.floor(secsRaw)));
    const elapsedSecsRaw =
      typeof base.elapsedSecs === "number" && Number.isFinite(base.elapsedSecs)
        ? base.elapsedSecs
        : Math.max(0, totalSecs - secs);
    const elapsedSecs = Math.max(0, Math.min(totalSecs, Math.floor(elapsedSecsRaw)));
    const cycleCount =
      typeof base.cycleCount === "number" && Number.isFinite(base.cycleCount)
        ? Math.max(0, Math.floor(base.cycleCount))
        : 0;
    return {
      ...base,
      secs,
      totalSecs,
      elapsedSecs,
      cycleCount,
      running: base.running === true,
      completedAt: typeof base.completedAt === "number" && Number.isFinite(base.completedAt) ? base.completedAt : undefined,
      lastStartedAt: typeof base.lastStartedAt === "number" && Number.isFinite(base.lastStartedAt) ? base.lastStartedAt : undefined,
      lastTickedAt: typeof base.lastTickedAt === "number" && Number.isFinite(base.lastTickedAt) ? base.lastTickedAt : undefined,
      lastPausedAt: typeof base.lastPausedAt === "number" && Number.isFinite(base.lastPausedAt) ? base.lastPausedAt : undefined,
    };
  }

  return base;
}

export function normalizeWorkspaceResultMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  const input = metadata as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (
      value === null
      || typeof value === "string"
      || typeof value === "number"
      || typeof value === "boolean"
    ) {
      normalized[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      normalized[key] = value.slice(0, 50).map((entry) => {
        if (
          entry === null
          || typeof entry === "string"
          || typeof entry === "number"
          || typeof entry === "boolean"
        ) {
          return entry;
        }
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          return Object.fromEntries(
            Object.entries(entry as Record<string, unknown>).filter(([, nested]) =>
              nested === null
              || typeof nested === "string"
              || typeof nested === "number"
              || typeof nested === "boolean",
            ),
          );
        }
        return String(entry);
      });
      continue;
    }
    if (typeof value === "object") {
      normalized[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(([, nested]) =>
          nested === null
          || typeof nested === "string"
          || typeof nested === "number"
          || typeof nested === "boolean",
        ),
      );
    }
  }

  return normalized;
}
