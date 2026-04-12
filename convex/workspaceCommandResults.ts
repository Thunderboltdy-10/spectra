import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";
import type { Id } from "./_generated/dataModel";
import { recordWorkspaceMutation } from "./workspaceHelpers";

const vIntent = v.union(
  v.literal("note"),
  v.literal("planner"),
  v.literal("thread"),
  v.literal("result"),
  v.literal("widget"),
);

const vStatus = v.union(v.literal("processing"), v.literal("completed"), v.literal("dismissed"));

async function requireActor(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

async function validateWorkstream(ctx: Parameters<typeof getUserByClerkId>[0], actor: Awaited<ReturnType<typeof requireActor>>, workstreamId: Id<"workstreams">) {
  const workstream = await ctx.db.get(workstreamId);
  if (!workstream || workstream.ownerUserId !== actor._id || workstream.orgId !== actor.orgId) {
    throw new Error("Workstream not found");
  }
}

export const create = mutation({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    sourceChatId: v.optional(v.id("chats")),
    sourceMessageId: v.optional(v.id("messages")),
    intent: vIntent,
    status: vStatus,
    title: v.string(),
    summary: v.string(),
    detail: v.optional(v.string()),
    variant: v.optional(v.union(v.literal("summary"), v.literal("answer"), v.literal("artifact"), v.literal("planner"), v.literal("thread"))),
    targetKind: v.optional(v.union(v.literal("artifact"), v.literal("plannerItem"), v.literal("chat"), v.literal("workspaceItem"), v.literal("result"))),
    targetId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await validateWorkstream(ctx, actor, args.workstreamId);
    const now = Date.now();
    const resultId = await ctx.db.insert("workspaceCommandResults", {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: args.workstreamId,
      sourceChatId: args.sourceChatId,
      sourceMessageId: args.sourceMessageId,
      intent: args.intent,
      status: args.status,
      title: args.title.trim(),
      summary: args.summary.trim(),
      detail: args.detail?.trim(),
      variant: args.variant,
      targetKind: args.targetKind,
      targetId: args.targetId,
      metadata: args.metadata,
      createdAt: now,
      updatedAt: now,
    });

    await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: args.workstreamId,
      mutationType: "workspace_command_result",
      source: "ai",
      entity: "workspace-result",
      action: "created",
      includeHub: true,
      refreshHub: true,
      summary: `Created workspace ${args.intent} result ${args.title.trim()}`,
      after: { resultId, intent: args.intent, status: args.status, targetKind: args.targetKind, targetId: args.targetId },
    });

    return { resultId };
  },
});

export const listForWorkstream = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    status: v.optional(vStatus),
    includeDismissed: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await validateWorkstream(ctx, actor, args.workstreamId);
    const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
    let rows = await ctx.db
      .query("workspaceCommandResults")
      .withIndex("by_workstream_updated", (q) => q.eq("workstreamId", args.workstreamId))
      .order("desc")
      .take(args.status || args.includeDismissed ? limit : Math.min(limit * 3, 300));
    rows = rows.filter((row) => row.ownerUserId === actor._id && row.orgId === actor.orgId);
    if (args.status) {
      rows = rows.filter((row) => row.status === args.status);
    } else if (!args.includeDismissed) {
      rows = rows.filter((row) => row.status !== "dismissed");
    }
    return rows.slice(0, limit);
  },
});

export const getForTarget = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    targetKind: v.union(v.literal("artifact"), v.literal("plannerItem"), v.literal("chat"), v.literal("workspaceItem"), v.literal("result")),
    targetId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await validateWorkstream(ctx, actor, args.workstreamId);
    const rows = await ctx.db
      .query("workspaceCommandResults")
      .withIndex("by_workstream_updated", (q) => q.eq("workstreamId", args.workstreamId))
      .order("desc")
      .take(200);

    return rows.find((row) =>
      row.ownerUserId === actor._id
      && row.orgId === actor.orgId
      && row.targetKind === args.targetKind
      && row.targetId === args.targetId,
    ) ?? null;
  },
});

export const dismiss = mutation({
  args: {
    actorClerkId: v.string(),
    resultId: v.id("workspaceCommandResults"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const row = await ctx.db.get(args.resultId);
    if (!row || row.ownerUserId !== actor._id || row.orgId !== actor.orgId) {
      throw new Error("Workspace result not found");
    }
    const now = Date.now();
    await ctx.db.patch(args.resultId, {
      status: "dismissed",
      dismissedAt: now,
      updatedAt: now,
    });
    await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: row.workstreamId,
      mutationType: "dismiss_workspace_command_result",
      source: "user",
      entity: "workspace-result",
      action: "updated",
      includeHub: true,
      refreshHub: true,
      summary: `Dismissed workspace result ${row.title}`,
      before: { resultId: row._id, status: row.status },
      after: { resultId: row._id, status: "dismissed" },
    });
    return { success: true };
  },
});

export const reopen = mutation({
  args: {
    actorClerkId: v.string(),
    resultId: v.id("workspaceCommandResults"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const row = await ctx.db.get(args.resultId);
    if (!row || row.ownerUserId !== actor._id || row.orgId !== actor.orgId) {
      throw new Error("Workspace result not found");
    }
    const now = Date.now();
    await ctx.db.patch(args.resultId, {
      status: "completed",
      dismissedAt: undefined,
      updatedAt: now,
    });
    await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: row.workstreamId,
      mutationType: "reopen_workspace_command_result",
      source: "user",
      entity: "workspace-result",
      action: "updated",
      includeHub: true,
      refreshHub: true,
      summary: `Reopened workspace result ${row.title}`,
      before: { resultId: row._id, status: row.status },
      after: { resultId: row._id, status: "completed" },
    });
    return { success: true };
  },
});
