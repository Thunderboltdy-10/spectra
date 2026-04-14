/* eslint-disable @typescript-eslint/no-unsafe-function-type, @typescript-eslint/no-explicit-any */
import type { Doc, Id } from "./_generated/dataModel";
import {
  buildWorkspaceSearchText,
  computeWorkspaceItemDefaultFrame,
  resolveCanonicalWorkspaceItemType,
  resolveWorkspaceCategory,
} from "./workspaceHelpers";

function normalizeSummary(value: string | null | undefined) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed.slice(0, 280) : undefined;
}

function workspaceLegacyTypeForArtifact(
  artifactType: string,
): Doc<"workspaceItems">["type"] {
  switch (artifactType) {
    case "board":
      return "board";
    case "diagram":
    case "concept_map":
    case "timeline":
    case "image":
    case "visualization":
      return "visualization";
    case "bookmark":
    case "reference":
      return "reference";
    case "audio":
    case "video":
    case "media":
      return "media";
    default:
      return "document";
  }
}

async function findWorkspaceItemForArtifact(
  ctx: { db: { query: Function } },
  artifactId: Id<"artifacts">,
  ownerUserId: Id<"users">,
  orgId: Id<"orgs">,
) {
  const rows = await ctx.db
    .query("workspaceItems")
    .withIndex("by_source_artifact", (q: any) => q.eq("sourceArtifactId", artifactId))
    .collect();

  return rows.find((row: Doc<"workspaceItems">) => row.ownerUserId === ownerUserId && row.orgId === orgId) ?? null;
}

async function findWorkspaceItemForChat(
  ctx: { db: { query: Function } },
  chatId: Id<"chats">,
  ownerUserId: Id<"users">,
  orgId: Id<"orgs">,
) {
  const rows = await ctx.db
    .query("workspaceItems")
    .withIndex("by_source_chat", (q: any) => q.eq("sourceChatId", chatId))
    .collect();

  return rows.find((row: Doc<"workspaceItems">) => row.ownerUserId === ownerUserId && row.orgId === orgId) ?? null;
}

export async function syncWorkspaceItemForChat(
  ctx: { db: { patch: Function; insert: Function; query: Function } },
  args: {
    chatId: Id<"chats">;
    ownerUserId: Id<"users">;
    orgId: Id<"orgs">;
    workstreamId?: Id<"workstreams">;
    deletedAt?: number;
    title: string;
    latestUserPrompt?: string;
    contextSummary?: string;
    createdAt: number;
    updatedAt: number;
    provenanceSource?: Doc<"workspaceItems">["provenanceSource"];
  },
): Promise<void> {
  const existing = await findWorkspaceItemForChat(ctx, args.chatId, args.ownerUserId, args.orgId);
  const shouldArchive = Boolean(args.deletedAt) || !args.workstreamId;
  const contentSummary = normalizeSummary(args.latestUserPrompt ?? args.contextSummary);
  const now = Date.now();

  if (shouldArchive) {
    if (existing && existing.status !== "archived") {
      await ctx.db.patch(existing._id, {
        status: "archived",
        updatedAt: now,
      });
    }
    return;
  }

  const fields = {
    workstreamId: args.workstreamId,
    type: "thread" as const,
    itemType: "thread" as const,
    sourceKind: "chat" as const,
    sourceId: args.chatId as unknown as string,
    sourceChatId: args.chatId,
    renderMode: "thread",
    title: args.title,
    contentSummary,
    searchText: buildWorkspaceSearchText(args.title, contentSummary, "thread", "threads"),
    category: "threads" as const,
    status: "active" as const,
    updatedAt: args.updatedAt,
  };

  if (existing) {
    await ctx.db.patch(existing._id, fields);
    return;
  }

  const frame = computeWorkspaceItemDefaultFrame({
    itemType: "thread",
    renderMode: "thread",
  });

  await ctx.db.insert("workspaceItems", {
    orgId: args.orgId,
    ownerUserId: args.ownerUserId,
    workstreamId: args.workstreamId,
    type: "thread",
    itemType: "thread",
    sourceKind: "chat",
    sourceId: args.chatId as unknown as string,
    sourceChatId: args.chatId,
    renderMode: "thread",
    title: args.title,
    contentSummary,
    searchText: buildWorkspaceSearchText(args.title, contentSummary, "thread", "threads"),
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    zIndex: 0,
    category: "threads",
    status: "active",
    pinned: false,
    collapsed: false,
    hidden: false,
    provenanceSource: args.provenanceSource ?? "user",
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
  });
}

export async function removeWorkspaceItemForChat(
  ctx: { db: { patch: Function; query: Function } },
  args: {
    chatId: Id<"chats">;
    ownerUserId: Id<"users">;
    orgId: Id<"orgs">;
  },
): Promise<void> {
  const existing = await findWorkspaceItemForChat(ctx, args.chatId, args.ownerUserId, args.orgId);
  if (!existing) return;
  await ctx.db.patch(existing._id, {
    status: "archived",
    updatedAt: Date.now(),
  });
}

export async function syncWorkspaceItemForArtifact(
  ctx: { db: { patch: Function; insert: Function; query: Function } },
  args: {
    artifactId: Id<"artifacts">;
    ownerUserId: Id<"users">;
    orgId: Id<"orgs">;
    workstreamId?: Id<"workstreams">;
    status: "active" | "archived";
    title: string;
    artifactType: string;
    contentPlaintext?: string;
  },
): Promise<void> {
  const existing = await findWorkspaceItemForArtifact(ctx, args.artifactId, args.ownerUserId, args.orgId);
  const now = Date.now();
  const shouldArchive = args.status !== "active" || !args.workstreamId;

  if (shouldArchive) {
    if (existing && existing.status !== "archived") {
      await ctx.db.patch(existing._id, {
        status: "archived",
        updatedAt: now,
      });
    }
    return;
  }

  const legacyType = workspaceLegacyTypeForArtifact(args.artifactType);
  const itemType = resolveCanonicalWorkspaceItemType({
    itemType: "artifact",
    legacyType,
    sourceArtifactId: args.artifactId,
  });
  const category = resolveWorkspaceCategory({
    itemType,
    renderMode: args.artifactType,
    legacyType,
  });

  const fields = {
    workstreamId: args.workstreamId,
    type: legacyType,
    itemType,
    sourceKind: "artifact" as const,
    sourceId: args.artifactId as unknown as string,
    sourceArtifactId: args.artifactId,
    renderMode: args.artifactType,
    title: args.title,
    contentSummary: normalizeSummary(args.contentPlaintext),
    searchText: buildWorkspaceSearchText(args.title, normalizeSummary(args.contentPlaintext), args.artifactType, category),
    category,
    status: "active" as const,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, fields);
    return;
  }

  const frame = computeWorkspaceItemDefaultFrame({
    itemType,
    renderMode: args.artifactType,
  });
  await ctx.db.insert("workspaceItems", {
    orgId: args.orgId,
    ownerUserId: args.ownerUserId,
    workstreamId: args.workstreamId,
    type: legacyType,
    itemType,
    sourceKind: "artifact",
    sourceId: args.artifactId as unknown as string,
    sourceArtifactId: args.artifactId,
    renderMode: args.artifactType,
    title: args.title,
    contentSummary: normalizeSummary(args.contentPlaintext),
    searchText: buildWorkspaceSearchText(args.title, normalizeSummary(args.contentPlaintext), args.artifactType, category),
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    zIndex: 0,
    category,
    status: "active",
    pinned: false,
    collapsed: false,
    hidden: false,
    provenanceSource: "user",
    createdAt: now,
    updatedAt: now,
  });
}

export async function removeWorkspaceItemForArtifact(
  ctx: { db: { patch: Function; query: Function } },
  args: {
    artifactId: Id<"artifacts">;
    ownerUserId: Id<"users">;
    orgId: Id<"orgs">;
  },
): Promise<void> {
  const existing = await findWorkspaceItemForArtifact(ctx, args.artifactId, args.ownerUserId, args.orgId);
  if (!existing) return;
  await ctx.db.patch(existing._id, {
    status: "archived",
    updatedAt: Date.now(),
  });
}
