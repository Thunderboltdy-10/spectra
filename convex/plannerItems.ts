import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUserByClerkId } from "./helpers";
import { buildWorkspaceSearchText, computeWorkspaceItemDefaultFrame, recordWorkspaceMutation } from "./workspaceHelpers";

const vPlannerType = v.union(v.literal("deadline"), v.literal("milestone"), v.literal("goal"), v.literal("reminder"));
const vPlannerPriority = v.union(v.literal("low"), v.literal("medium"), v.literal("high"));
const vPlannerStatus = v.union(
  v.literal("pending"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("cancelled"),
);
const vPlannerSourceType = v.union(v.literal("user_manual"), v.literal("ai_suggested"), v.literal("managebac_sync"));

type PlannerCtx = Pick<MutationCtx, "db"> | Pick<QueryCtx, "db">;

async function requireActor(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

function normalizeString(value: string | null | undefined) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toOptionalPatchValue<T>(value: T | null | undefined): T | undefined {
  if (value === null) return undefined;
  return value;
}

async function validateWorkstream(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireActor>>,
  workstreamId: Id<"workstreams"> | undefined,
) {
  if (!workstreamId) return;
  const row = await ctx.db.get(workstreamId);
  if (!row || row.ownerUserId !== actor._id || row.orgId !== actor.orgId) {
    throw new Error("Workstream not found");
  }
}

async function validateSourceArtifact(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireActor>>,
  sourceArtifactId: Id<"artifacts"> | undefined,
) {
  if (!sourceArtifactId) return;
  const artifact = await ctx.db.get(sourceArtifactId);
  if (!artifact || artifact.ownerUserId !== actor._id || artifact.orgId !== actor.orgId) {
    throw new Error("Artifact not found");
  }
}

async function validateSourceChat(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireActor>>,
  sourceChatId: Id<"chats"> | undefined,
) {
  if (!sourceChatId) return;
  const chat = await ctx.db.get(sourceChatId);
  if (!chat || chat.ownerUserId !== actor._id || chat.orgId !== actor.orgId || chat.deletedAt) {
    throw new Error("Chat not found");
  }
}



async function findWorkspaceItemForPlannerItem(
  ctx: PlannerCtx,
  plannerItemId: Id<"plannerItems">,
  ownerUserId: Id<"users">,
  orgId: Id<"orgs">,
) {
  const rows = await ctx.db
    .query("workspaceItems")
    .withIndex("by_source_planner", (q) => q.eq("sourcePlannerItemId", plannerItemId))
    .collect();

  return rows.find((row) => row.ownerUserId === ownerUserId && row.orgId === orgId) ?? null;
}

async function syncWorkspaceItemForPlannerItem(
  ctx: Pick<MutationCtx, "db">,
  params: {
    plannerItemId: Id<"plannerItems">;
    ownerUserId: Id<"users">;
    orgId: Id<"orgs">;
    workstreamId?: Id<"workstreams">;
    title: string;
    description?: string;
    status: "pending" | "in_progress" | "completed" | "cancelled";
    type: "deadline" | "milestone" | "goal" | "reminder";
  },
) {
  const existing = await findWorkspaceItemForPlannerItem(
    ctx,
    params.plannerItemId,
    params.ownerUserId,
    params.orgId,
  );
  const now = Date.now();
  const shouldArchive = !params.workstreamId || params.status === "cancelled";

  if (shouldArchive) {
    if (existing && existing.status !== "archived") {
      await ctx.db.patch(existing._id, {
        status: "archived",
        updatedAt: now,
      });
    }
    return existing?._id;
  }

  const fields = {
    workstreamId: params.workstreamId,
    type: "planner" as const,
    itemType: "planner" as const,
    sourceKind: "plannerItem" as const,
    sourceId: params.plannerItemId,
    sourcePlannerItemId: params.plannerItemId,
    renderMode: params.type,
    title: params.title,
    contentSummary: normalizeString(params.description),
    searchText: buildWorkspaceSearchText(params.title, normalizeString(params.description), params.type, "planner"),
    category: "planner" as const,
    status: "active" as const,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, fields);
    return existing._id;
  }

  const frame = computeWorkspaceItemDefaultFrame({
    itemType: "planner",
    renderMode: params.type,
    pinned: true,
  });

  return await ctx.db.insert("workspaceItems", {
    orgId: params.orgId,
    ownerUserId: params.ownerUserId,
    workstreamId: params.workstreamId,
    type: "planner",
    itemType: "planner",
    sourceKind: "plannerItem",
    sourceId: params.plannerItemId,
    sourcePlannerItemId: params.plannerItemId,
    renderMode: params.type,
    title: params.title,
    contentSummary: normalizeString(params.description),
    searchText: buildWorkspaceSearchText(params.title, normalizeString(params.description), params.type, "planner"),
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    category: "planner",
    status: "active",
    pinned: true,
    createdAt: now,
    updatedAt: now,
  });
}

async function assertPlannerItemOwnership(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireActor>>,
  plannerItemId: Id<"plannerItems">,
) {
  const item = await ctx.db.get(plannerItemId);
  if (!item || item.ownerUserId !== actor._id || item.orgId !== actor.orgId) {
    throw new Error("Planner item not found");
  }
  return item;
}

export const list = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.optional(v.id("workstreams")),
    status: v.optional(vPlannerStatus),
    type: v.optional(vPlannerType),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const limit = Math.max(1, Math.min(args.limit ?? 200, 500));

    let rows = await ctx.db
      .query("plannerItems")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", actor._id))
      .collect();

    if (args.workstreamId) {
      rows = rows.filter((row) => row.workstreamId === args.workstreamId);
    }

    if (args.status) {
      rows = rows.filter((row) => row.status === args.status);
    }

    if (args.type) {
      rows = rows.filter((row) => row.type === args.type);
    }

    rows.sort((a, b) => {
      const dueA = a.dueAt ?? Number.MAX_SAFE_INTEGER;
      const dueB = b.dueAt ?? Number.MAX_SAFE_INTEGER;
      if (dueA !== dueB) return dueA - dueB;
      return b.updatedAt - a.updatedAt;
    });

    return rows.slice(0, limit);
  },
});

export const get = query({
  args: {
    actorClerkId: v.string(),
    plannerItemId: v.id("plannerItems"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const item = await assertPlannerItemOwnership(ctx, actor, args.plannerItemId);
    return item;
  },
});

export const listHubItems = query({
  args: {
    actorClerkId: v.string(),
    limit: v.optional(v.number()),
    daysAhead: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const limit = Math.max(1, Math.min(args.limit ?? 100, 300));
    const daysAhead = Math.max(1, Math.min(args.daysAhead ?? 14, 30));
    const now = Date.now();
    const windowEnd = now + daysAhead * 24 * 60 * 60 * 1000;

    const rows = await ctx.db
      .query("plannerItems")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", actor._id))
      .collect();

    const hubItems = rows
      .filter((row) => row.workstreamId === undefined)
      .sort((a, b) => {
        const dueA = a.dueAt ?? Number.MAX_SAFE_INTEGER;
        const dueB = b.dueAt ?? Number.MAX_SAFE_INTEGER;
        if (dueA !== dueB) return dueA - dueB;
        return b.updatedAt - a.updatedAt;
      })
      .slice(0, limit);

    const aggregatedDeadlines = rows
      .filter((row) => row.status !== "completed" && row.status !== "cancelled")
      .filter((row) => typeof row.dueAt === "number" && row.dueAt >= now && row.dueAt <= windowEnd)
      .sort((a, b) => (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER))
      .slice(0, limit);

    return {
      hubItems,
      aggregatedDeadlines,
    };
  },
});

export const create = mutation({
  args: {
    actorClerkId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    workstreamId: v.optional(v.id("workstreams")),
    type: v.optional(vPlannerType),
    priority: v.optional(vPlannerPriority),
    status: v.optional(vPlannerStatus),
    dueAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    sourceType: v.optional(vPlannerSourceType),
    sourceArtifactId: v.optional(v.id("artifacts")),
    sourceChatId: v.optional(v.id("chats")),
    managebacItemId: v.optional(v.string()),
    sourceDeleted: v.optional(v.boolean()),
    sourceUpdatedAt: v.optional(v.number()),
    syncConflictSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);

    const title = normalizeString(args.title);
    if (!title) throw new Error("title is required");

    await validateWorkstream(ctx, actor, args.workstreamId);
    await validateSourceArtifact(ctx, actor, args.sourceArtifactId);
    await validateSourceChat(ctx, actor, args.sourceChatId);

    const now = Date.now();
    const status = args.status ?? "pending";

    const plannerItemId = await ctx.db.insert("plannerItems", {
      ownerUserId: actor._id,
      orgId: actor.orgId,
      workstreamId: args.workstreamId,
      title,
      description: normalizeString(args.description),
      type: args.type ?? "deadline",
      priority: args.priority ?? "medium",
      status,
      dueAt: args.dueAt,
      completedAt: status === "completed" ? (args.completedAt ?? now) : args.completedAt,
      sourceType: args.sourceType ?? "user_manual",
      sourceArtifactId: args.sourceArtifactId,
      sourceChatId: args.sourceChatId,
      managebacItemId: normalizeString(args.managebacItemId),
      sourceDeleted: args.sourceDeleted,
      sourceUpdatedAt: args.sourceUpdatedAt,
      syncConflictSummary: normalizeString(args.syncConflictSummary),
      createdAt: now,
      updatedAt: now,
    });

    await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: args.workstreamId,
      mutationType: "create_planner_item",
      source: "user",
      entity: "workspace-item",
      action: "created",
      includeHub: true,
      refreshHub: true,
      summary: `Created planner item ${title}`,
      after: { plannerItemId },
    });
    await syncWorkspaceItemForPlannerItem(ctx, {
      plannerItemId,
      ownerUserId: actor._id,
      orgId: actor.orgId,
      workstreamId: args.workstreamId,
      title,
      description: normalizeString(args.description),
      status,
      type: args.type ?? "deadline",
    });
    return { plannerItemId };
  },
});

export const update = mutation({
  args: {
    actorClerkId: v.string(),
    plannerItemId: v.id("plannerItems"),
    title: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    workstreamId: v.optional(v.union(v.id("workstreams"), v.null())),
    type: v.optional(vPlannerType),
    priority: v.optional(vPlannerPriority),
    status: v.optional(vPlannerStatus),
    dueAt: v.optional(v.union(v.number(), v.null())),
    completedAt: v.optional(v.union(v.number(), v.null())),
    sourceType: v.optional(vPlannerSourceType),
    sourceArtifactId: v.optional(v.union(v.id("artifacts"), v.null())),
    sourceChatId: v.optional(v.union(v.id("chats"), v.null())),
    managebacItemId: v.optional(v.union(v.string(), v.null())),
    sourceDeleted: v.optional(v.union(v.boolean(), v.null())),
    sourceUpdatedAt: v.optional(v.union(v.number(), v.null())),
    syncConflictSummary: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const current = await assertPlannerItemOwnership(ctx, actor, args.plannerItemId);

    if (args.workstreamId !== undefined) {
      await validateWorkstream(ctx, actor, args.workstreamId ?? undefined);
    }
    if (args.sourceArtifactId !== undefined) {
      await validateSourceArtifact(ctx, actor, args.sourceArtifactId ?? undefined);
    }
    if (args.sourceChatId !== undefined) {
      await validateSourceChat(ctx, actor, args.sourceChatId ?? undefined);
    }

    const now = Date.now();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (args.title !== undefined) {
      const title = normalizeString(args.title);
      if (!title) throw new Error("title cannot be empty");
      updates.title = title;
    }
    if (args.description !== undefined) updates.description = normalizeString(toOptionalPatchValue(args.description));
    if (args.workstreamId !== undefined) updates.workstreamId = toOptionalPatchValue(args.workstreamId);
    if (args.type !== undefined) updates.type = args.type;
    if (args.priority !== undefined) updates.priority = args.priority;
    if (args.dueAt !== undefined) updates.dueAt = toOptionalPatchValue(args.dueAt);
    if (args.sourceType !== undefined) updates.sourceType = args.sourceType;
    if (args.sourceArtifactId !== undefined) updates.sourceArtifactId = toOptionalPatchValue(args.sourceArtifactId);
    if (args.sourceChatId !== undefined) updates.sourceChatId = toOptionalPatchValue(args.sourceChatId);
    if (args.managebacItemId !== undefined) updates.managebacItemId = normalizeString(toOptionalPatchValue(args.managebacItemId));
    if (args.sourceDeleted !== undefined) updates.sourceDeleted = toOptionalPatchValue(args.sourceDeleted);
    if (args.sourceUpdatedAt !== undefined) updates.sourceUpdatedAt = toOptionalPatchValue(args.sourceUpdatedAt);
    if (args.syncConflictSummary !== undefined) {
      updates.syncConflictSummary = normalizeString(toOptionalPatchValue(args.syncConflictSummary));
    }

    if (args.status !== undefined) {
      updates.status = args.status;
      if (args.status === "completed") {
        updates.completedAt = args.completedAt === undefined ? (current.completedAt ?? now) : toOptionalPatchValue(args.completedAt);
      }
      if (args.status !== "completed" && current.status === "completed" && args.completedAt === undefined) {
        updates.completedAt = undefined;
      }
    }

    if (args.completedAt !== undefined) {
      updates.completedAt = toOptionalPatchValue(args.completedAt);
    }

    await ctx.db.patch(args.plannerItemId, updates);
    const nextWorkstreamId = args.workstreamId === undefined ? current.workstreamId : toOptionalPatchValue(args.workstreamId);
    const nextStatus = args.status ?? current.status;
    await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: current.workstreamId,
      targetWorkstreamId: current.workstreamId !== nextWorkstreamId ? nextWorkstreamId : undefined,
      mutationType: current.workstreamId !== nextWorkstreamId ? "move_planner_item" : "update_planner_item",
      source: "user",
      entity: "workspace-item",
      action: nextStatus === "cancelled" ? "deleted" : "updated",
      includeHub: true,
      refreshHub: true,
      summary: `Updated planner item ${current.title}`,
      before: current,
      after: updates,
    });
    await syncWorkspaceItemForPlannerItem(ctx, {
      plannerItemId: args.plannerItemId,
      ownerUserId: actor._id,
      orgId: actor.orgId,
      workstreamId: nextWorkstreamId ?? undefined,
      title: (updates.title as string | undefined) ?? current.title,
      description: (updates.description as string | undefined) ?? current.description,
      status: nextStatus,
      type: (updates.type as typeof current.type | undefined) ?? current.type,
    });
    return { success: true };
  },
});

export const remove = mutation({
  args: {
    actorClerkId: v.string(),
    plannerItemId: v.id("plannerItems"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const current = await assertPlannerItemOwnership(ctx, actor, args.plannerItemId);
    await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: current.workstreamId,
      mutationType: "delete_planner_item",
      source: "user",
      entity: "workspace-item",
      action: "deleted",
      includeHub: true,
      refreshHub: true,
      summary: `Deleted planner item ${current.title}`,
      before: current,
    });
    await syncWorkspaceItemForPlannerItem(ctx, {
      plannerItemId: args.plannerItemId,
      ownerUserId: actor._id,
      orgId: actor.orgId,
      workstreamId: undefined,
      title: current.title,
      description: current.description,
      status: "cancelled",
      type: current.type,
    });
    await ctx.db.delete(args.plannerItemId);
    return { success: true };
  },
});
