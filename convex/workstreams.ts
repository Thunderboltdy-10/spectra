import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUserByClerkId } from "./helpers";
import { vStudyMode, vThinkingLevel } from "./shared";

const vWorkstreamType = v.union(v.literal("subject"), v.literal("project"), v.literal("general"));
const vWorkstreamStatus = v.union(v.literal("active"), v.literal("completed"), v.literal("archived"));

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

async function assertWorkstreamOwnership(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireActor>>,
  workstreamId: Id<"workstreams">,
) {
  const workstream = await ctx.db.get(workstreamId);
  if (!workstream || workstream.ownerUserId !== actor._id || workstream.orgId !== actor.orgId) {
    throw new Error("Workstream not found");
  }
  return workstream;
}

async function validateLinkedAgent(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireActor>>,
  linkedAgentId: Id<"agents"> | undefined,
) {
  if (!linkedAgentId) return;
  const agent = await ctx.db.get(linkedAgentId);
  if (!agent || agent.orgId !== actor.orgId) {
    throw new Error("Agent not found");
  }
}

async function validateLinkedPack(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireActor>>,
  linkedPackId: Id<"packs"> | undefined,
) {
  if (!linkedPackId) return;
  const pack = await ctx.db.get(linkedPackId);
  if (!pack || pack.orgId !== actor.orgId) {
    throw new Error("Pack not found");
  }
}

export const list = query({
  args: {
    actorClerkId: v.string(),
    status: v.optional(vWorkstreamStatus),
    type: v.optional(vWorkstreamType),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const limit = Math.max(1, Math.min(args.limit ?? 100, 300));

    let rows = await ctx.db
      .query("workstreams")
      .withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id))
      .order("desc")
      .take(Math.max(limit * 3, 120));

    if (args.status) {
      rows = rows.filter((row) => row.status === args.status);
    }

    if (args.type) {
      rows = rows.filter((row) => row.type === args.type);
    }

    const search = normalizeString(args.search)?.toLowerCase();
    if (search) {
      rows = rows.filter((row) => {
        const title = row.title.toLowerCase();
        const description = row.description?.toLowerCase() ?? "";
        const subjectCode = row.subjectCode?.toLowerCase() ?? "";
        return title.includes(search) || description.includes(search) || subjectCode.includes(search);
      });
    }

    return rows.slice(0, limit);
  },
});

export const get = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const workstream = await assertWorkstreamOwnership(ctx, actor, args.workstreamId);
    return workstream;
  },
});

export const create = mutation({
  args: {
    actorClerkId: v.string(),
    type: vWorkstreamType,
    title: v.string(),
    description: v.optional(v.string()),
    emoji: v.optional(v.string()),
    color: v.optional(v.string()),
    status: v.optional(vWorkstreamStatus),
    canvasX: v.optional(v.number()),
    canvasY: v.optional(v.number()),
    canvasWidth: v.optional(v.number()),
    canvasHeight: v.optional(v.number()),
    subjectCode: v.optional(v.string()),
    managebacClassId: v.optional(v.string()),
    managebacContext: v.optional(v.any()),
    managebacInactiveSince: v.optional(v.number()),
    linkedAgentId: v.optional(v.id("agents")),
    linkedPackId: v.optional(v.id("packs")),
    defaultMode: v.optional(vStudyMode),
    defaultThinking: v.optional(vThinkingLevel),
    artifactCount: v.optional(v.number()),
    lastActivityAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const title = normalizeString(args.title);
    if (!title) throw new Error("title is required");

    await validateLinkedAgent(ctx, actor, args.linkedAgentId);
    await validateLinkedPack(ctx, actor, args.linkedPackId);

    const now = Date.now();
    const status = args.status ?? "active";

    const workstreamId = await ctx.db.insert("workstreams", {
      ownerUserId: actor._id,
      orgId: actor.orgId,
      type: args.type,
      title,
      description: normalizeString(args.description),
      emoji: normalizeString(args.emoji),
      color: normalizeString(args.color),
      status,
      canvasX: args.canvasX,
      canvasY: args.canvasY,
      canvasWidth: args.canvasWidth,
      canvasHeight: args.canvasHeight,
      subjectCode: normalizeString(args.subjectCode),
      managebacClassId: normalizeString(args.managebacClassId),
      managebacContext: args.managebacContext,
      managebacInactiveSince: args.managebacInactiveSince,
      linkedAgentId: args.linkedAgentId,
      linkedPackId: args.linkedPackId,
      defaultMode: args.defaultMode,
      defaultThinking: args.defaultThinking,
      artifactCount: args.artifactCount ?? 0,
      lastActivityAt: args.lastActivityAt,
      completedAt: status === "completed" ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });

    return { workstreamId };
  },
});

export const update = mutation({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    type: v.optional(vWorkstreamType),
    title: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    emoji: v.optional(v.union(v.string(), v.null())),
    color: v.optional(v.union(v.string(), v.null())),
    status: v.optional(vWorkstreamStatus),
    canvasX: v.optional(v.union(v.number(), v.null())),
    canvasY: v.optional(v.union(v.number(), v.null())),
    canvasWidth: v.optional(v.union(v.number(), v.null())),
    canvasHeight: v.optional(v.union(v.number(), v.null())),
    subjectCode: v.optional(v.union(v.string(), v.null())),
    managebacClassId: v.optional(v.union(v.string(), v.null())),
    managebacContext: v.optional(v.union(v.any(), v.null())),
    managebacInactiveSince: v.optional(v.union(v.number(), v.null())),
    linkedAgentId: v.optional(v.union(v.id("agents"), v.null())),
    linkedPackId: v.optional(v.union(v.id("packs"), v.null())),
    defaultMode: v.optional(v.union(vStudyMode, v.null())),
    defaultThinking: v.optional(v.union(vThinkingLevel, v.null())),
    artifactCount: v.optional(v.number()),
    lastActivityAt: v.optional(v.union(v.number(), v.null())),
    completedAt: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const current = await assertWorkstreamOwnership(ctx, actor, args.workstreamId);

    if (args.linkedAgentId !== undefined) {
      await validateLinkedAgent(ctx, actor, args.linkedAgentId ?? undefined);
    }
    if (args.linkedPackId !== undefined) {
      await validateLinkedPack(ctx, actor, args.linkedPackId ?? undefined);
    }

    const now = Date.now();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (args.type !== undefined) updates.type = args.type;
    if (args.title !== undefined) {
      const title = normalizeString(args.title);
      if (!title) throw new Error("title cannot be empty");
      updates.title = title;
    }
    if (args.description !== undefined) updates.description = normalizeString(toOptionalPatchValue(args.description));
    if (args.emoji !== undefined) updates.emoji = normalizeString(toOptionalPatchValue(args.emoji));
    if (args.color !== undefined) updates.color = normalizeString(toOptionalPatchValue(args.color));
    if (args.subjectCode !== undefined) updates.subjectCode = normalizeString(toOptionalPatchValue(args.subjectCode));
    if (args.managebacClassId !== undefined) {
      updates.managebacClassId = normalizeString(toOptionalPatchValue(args.managebacClassId));
    }
    if (args.managebacContext !== undefined) updates.managebacContext = toOptionalPatchValue(args.managebacContext);
    if (args.managebacInactiveSince !== undefined) {
      updates.managebacInactiveSince = toOptionalPatchValue(args.managebacInactiveSince);
    }

    if (args.canvasX !== undefined) updates.canvasX = toOptionalPatchValue(args.canvasX);
    if (args.canvasY !== undefined) updates.canvasY = toOptionalPatchValue(args.canvasY);
    if (args.canvasWidth !== undefined) updates.canvasWidth = toOptionalPatchValue(args.canvasWidth);
    if (args.canvasHeight !== undefined) updates.canvasHeight = toOptionalPatchValue(args.canvasHeight);
    if (args.linkedAgentId !== undefined) updates.linkedAgentId = toOptionalPatchValue(args.linkedAgentId);
    if (args.linkedPackId !== undefined) updates.linkedPackId = toOptionalPatchValue(args.linkedPackId);
    if (args.defaultMode !== undefined) updates.defaultMode = toOptionalPatchValue(args.defaultMode);
    if (args.defaultThinking !== undefined) updates.defaultThinking = toOptionalPatchValue(args.defaultThinking);
    if (args.artifactCount !== undefined) updates.artifactCount = Math.max(0, Math.floor(args.artifactCount));
    if (args.lastActivityAt !== undefined) updates.lastActivityAt = toOptionalPatchValue(args.lastActivityAt);

    if (args.status !== undefined) {
      updates.status = args.status;
      if (args.status === "completed") {
        updates.completedAt = args.completedAt === undefined ? now : toOptionalPatchValue(args.completedAt);
      }
      if (args.status === "active" && current.status === "completed") {
        updates.completedAt = undefined;
      }
    }

    if (args.completedAt !== undefined) {
      updates.completedAt = toOptionalPatchValue(args.completedAt);
    }

    await ctx.db.patch(args.workstreamId, updates);
    return { success: true };
  },
});

export const touchActivity = mutation({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    at: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await assertWorkstreamOwnership(ctx, actor, args.workstreamId);
    const at = args.at ?? Date.now();
    await ctx.db.patch(args.workstreamId, {
      lastActivityAt: at,
      updatedAt: at,
    });
    return { success: true };
  },
});

export const remove = mutation({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await assertWorkstreamOwnership(ctx, actor, args.workstreamId);
    const now = Date.now();

    const [chats, artifacts, plannerItems, notes, memoryRows, userMemoryEntries] = await Promise.all([
      ctx.db
        .query("chats")
        .withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId))
        .collect(),
      ctx.db
        .query("artifacts")
        .withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId))
        .collect(),
      ctx.db
        .query("plannerItems")
        .withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId))
        .collect(),
      ctx.db
        .query("notes")
        .withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId))
        .collect(),
      ctx.db
        .query("workstreamMemory")
        .withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId))
        .collect(),
      ctx.db
        .query("userMemoryEntries")
        .withIndex("by_user_org", (q) => q.eq("userId", actor._id).eq("orgId", actor.orgId))
        .collect(),
    ]);

    for (const chat of chats) {
      await ctx.db.patch(chat._id, { workstreamId: undefined, updatedAt: now });
    }

    for (const artifact of artifacts) {
      await ctx.db.patch(artifact._id, { workstreamId: undefined, updatedAt: now });
    }

    for (const item of plannerItems) {
      await ctx.db.patch(item._id, { workstreamId: undefined, updatedAt: now });
    }

    for (const note of notes) {
      await ctx.db.patch(note._id, { workstreamId: undefined, updatedAt: now });
    }

    for (const entry of userMemoryEntries) {
      if (entry.sourceWorkstreamId === args.workstreamId) {
        await ctx.db.patch(entry._id, {
          sourceWorkstreamId: undefined,
          updatedAt: now,
        });
      }
    }

    for (const row of memoryRows) {
      await ctx.db.delete(row._id);
    }

    await ctx.db.delete(args.workstreamId);
    return { success: true };
  },
});
