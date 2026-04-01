import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getUserByClerkId } from "./helpers";

export type WorkspaceMutationSource = "user" | "ai" | "system";

type WorkspaceCtx = Pick<MutationCtx, "db"> | Pick<QueryCtx, "db">;

export async function requireWorkspaceActor(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actorClerkId: string,
) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

export async function validateWorkspaceWorkstream(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireWorkspaceActor>>,
  workstreamId: Id<"workstreams"> | undefined,
) {
  if (!workstreamId) return;
  const workstream = await ctx.db.get(workstreamId);
  if (!workstream || workstream.ownerUserId !== actor._id || workstream.orgId !== actor.orgId) {
    throw new Error("Workstream not found");
  }
}

export async function validateWorkspaceSourceChat(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireWorkspaceActor>>,
  chatId: Id<"chats"> | undefined,
) {
  if (!chatId) return;
  const chat = await ctx.db.get(chatId);
  if (!chat || chat.ownerUserId !== actor._id || chat.orgId !== actor.orgId || chat.deletedAt) {
    throw new Error("Chat not found");
  }
}

export async function validateWorkspaceSourceArtifact(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireWorkspaceActor>>,
  artifactId: Id<"artifacts"> | undefined,
) {
  if (!artifactId) return;
  const artifact = await ctx.db.get(artifactId);
  if (!artifact || artifact.ownerUserId !== actor._id || artifact.orgId !== actor.orgId) {
    throw new Error("Artifact not found");
  }
}

export async function validateWorkspaceSourcePlannerItem(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireWorkspaceActor>>,
  plannerItemId: Id<"plannerItems"> | undefined,
) {
  if (!plannerItemId) return;
  const plannerItem = await ctx.db.get(plannerItemId);
  if (!plannerItem || plannerItem.ownerUserId !== actor._id || plannerItem.orgId !== actor.orgId) {
    throw new Error("Planner item not found");
  }
}

export async function assertWorkspaceItemOwnership(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireWorkspaceActor>>,
  itemId: Id<"workspaceItems">,
) {
  const item = await ctx.db.get(itemId);
  if (!item || item.ownerUserId !== actor._id || item.orgId !== actor.orgId) {
    throw new Error("Workspace item not found");
  }
  return item;
}

export function normalizeWorkspaceTitle(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Untitled Item";
}

export function summarizeWorkspaceContent(
  value: string | undefined,
  max = 180,
) {
  const compact = value?.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`;
}

export function resolveWorkspaceSourceKind(params: {
  sourceChatId?: Id<"chats">;
  sourceArtifactId?: Id<"artifacts">;
  sourcePlannerItemId?: Id<"plannerItems">;
  itemType?: Doc<"workspaceItems">["itemType"];
}) {
  if (params.sourceChatId) return "chat" as const;
  if (params.sourceArtifactId) return "artifact" as const;
  if (params.sourcePlannerItemId) return "plannerItem" as const;
  if (params.itemType === "utility") return "utility" as const;
  return params.itemType === "custom" ? "custom" as const : undefined;
}

export function resolveWorkspaceSourceId(params: {
  sourceChatId?: Id<"chats">;
  sourceArtifactId?: Id<"artifacts">;
  sourcePlannerItemId?: Id<"plannerItems">;
}) {
  if (params.sourceChatId) return params.sourceChatId;
  if (params.sourceArtifactId) return params.sourceArtifactId;
  if (params.sourcePlannerItemId) return params.sourcePlannerItemId;
  return undefined;
}

export function resolveCanonicalWorkspaceItemType(params: {
  legacyType?: Doc<"workspaceItems">["type"];
  itemType?: Doc<"workspaceItems">["itemType"];
  sourceChatId?: Id<"chats">;
  sourceArtifactId?: Id<"artifacts">;
  sourcePlannerItemId?: Id<"plannerItems">;
}) {
  if (params.itemType) return params.itemType;
  if (params.sourceChatId) return "thread" as const;
  if (params.sourcePlannerItemId) return "planner" as const;
  if (params.sourceArtifactId) return "artifact" as const;
  if (params.legacyType === "thread") return "thread" as const;
  if (params.legacyType === "planner") return "planner" as const;
  if (params.legacyType === "utility") return "utility" as const;
  if (params.legacyType === "custom") return "custom" as const;
  return "artifact" as const;
}

export function resolveWorkspaceCategory(params: {
  explicitCategory?: Doc<"workspaceItems">["category"];
  legacyType?: Doc<"workspaceItems">["type"];
  renderMode?: string;
  itemType?: Doc<"workspaceItems">["itemType"];
}) {
  if (params.explicitCategory) return params.explicitCategory;
  if (params.itemType === "thread" || params.legacyType === "thread") return "threads" as const;
  if (params.itemType === "planner" || params.legacyType === "planner") return "planner" as const;
  if (params.itemType === "utility") return "custom" as const;

  switch (params.renderMode) {
    case "document":
    case "note":
    case "study_plan":
    case "flashcard_deck":
    case "code_project":
      return "documents" as const;
    case "timetable":
      return "planner" as const;
    case "board":
      return "boards" as const;
    case "visualization":
    case "concept_map":
    case "quiz":
    case "whiteboard":
    case "code_output":
      return "visualizations" as const;
    case "image":
    case "diagram":
      return "media" as const;
    case "bookmark":
    case "collection":
      return "references" as const;
    default:
      break;
  }

  switch (params.legacyType) {
    case "document":
      return "documents" as const;
    case "board":
      return "boards" as const;
    case "visualization":
      return "visualizations" as const;
    case "media":
      return "media" as const;
    case "reference":
      return "references" as const;
    default:
      return "custom" as const;
  }
}

export async function recordWorkspaceMutation(
  ctx: Pick<MutationCtx, "db">,
  params: {
    orgId: Id<"orgs">;
    ownerUserId: Id<"users">;
    workstreamId?: Id<"workstreams">;
    targetWorkstreamId?: Id<"workstreams">;
    mutationType: string;
    source: WorkspaceMutationSource;
    summary?: string;
    targetItemIds?: Id<"workspaceItems">[];
    before?: unknown;
    after?: unknown;
    revertData?: unknown;
  },
) {
  const now = Date.now();
  return ctx.db.insert("workspaceMutations", {
    orgId: params.orgId,
    ownerUserId: params.ownerUserId,
    workstreamId: params.workstreamId,
    targetWorkstreamId: params.targetWorkstreamId,
    mutationType: params.mutationType,
    source: params.source,
    summary: params.summary,
    targetItemIds: params.targetItemIds,
    before: params.before,
    after: params.after,
    revertData: params.revertData,
    status: "applied",
    createdAt: now,
    updatedAt: now,
  });
}

export async function listOwnedWorkspaceItems(
  ctx: WorkspaceCtx,
  ownerUserId: Id<"users">,
) {
  return ctx.db
    .query("workspaceItems")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", ownerUserId))
    .collect();
}
