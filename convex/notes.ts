import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUserByClerkId } from "./helpers";

const vEditorMode = v.union(v.literal("agentic"), v.literal("notion"), v.literal("simple"));

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
  const workstream = await ctx.db.get(workstreamId);
  if (!workstream || workstream.ownerUserId !== actor._id || workstream.orgId !== actor.orgId) {
    throw new Error("Workstream not found");
  }
}

async function validateArtifact(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireActor>>,
  artifactId: Id<"artifacts"> | undefined,
) {
  if (!artifactId) return;
  const artifact = await ctx.db.get(artifactId);
  if (!artifact || artifact.ownerUserId !== actor._id || artifact.orgId !== actor.orgId) {
    throw new Error("Artifact not found");
  }
}

async function assertNoteOwnership(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireActor>>,
  noteId: Id<"notes">,
) {
  const note = await ctx.db.get(noteId);
  if (!note || note.ownerUserId !== actor._id || note.orgId !== actor.orgId) {
    throw new Error("Note not found");
  }
  return note;
}

export const list = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.optional(v.id("workstreams")),
    artifactId: v.optional(v.id("artifacts")),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const limit = Math.max(1, Math.min(args.limit ?? 100, 300));

    let rows = await ctx.db
      .query("notes")
      .withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id))
      .order("desc")
      .take(Math.max(limit * 4, 200));

    if (args.workstreamId) {
      rows = rows.filter((row) => row.workstreamId === args.workstreamId);
    }

    if (args.artifactId) {
      rows = rows.filter((row) => row.artifactId === args.artifactId);
    }

    const search = normalizeString(args.search)?.toLowerCase();
    if (search) {
      rows = rows.filter((row) => {
        const title = row.title.toLowerCase();
        const content = row.contentPlaintext?.toLowerCase() ?? "";
        return title.includes(search) || content.includes(search);
      });
    }

    return rows.slice(0, limit);
  },
});

export const get = query({
  args: {
    actorClerkId: v.string(),
    noteId: v.id("notes"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const note = await assertNoteOwnership(ctx, actor, args.noteId);
    return note;
  },
});

export const create = mutation({
  args: {
    actorClerkId: v.string(),
    title: v.string(),
    content: v.any(),
    contentPlaintext: v.optional(v.string()),
    editorMode: v.optional(vEditorMode),
    workstreamId: v.optional(v.id("workstreams")),
    artifactId: v.optional(v.id("artifacts")),
    lastAiEditId: v.optional(v.string()),
    pendingDiffs: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const title = normalizeString(args.title);
    if (!title) throw new Error("title is required");

    await validateWorkstream(ctx, actor, args.workstreamId);
    await validateArtifact(ctx, actor, args.artifactId);

    const now = Date.now();
    const noteId = await ctx.db.insert("notes", {
      ownerUserId: actor._id,
      orgId: actor.orgId,
      workstreamId: args.workstreamId,
      artifactId: args.artifactId,
      title,
      content: args.content,
      contentPlaintext: normalizeString(args.contentPlaintext),
      editorMode: args.editorMode ?? "notion",
      lastAiEditId: normalizeString(args.lastAiEditId),
      pendingDiffs: args.pendingDiffs,
      createdAt: now,
      updatedAt: now,
    });

    return { noteId };
  },
});

export const update = mutation({
  args: {
    actorClerkId: v.string(),
    noteId: v.id("notes"),
    title: v.optional(v.string()),
    content: v.optional(v.any()),
    contentPlaintext: v.optional(v.union(v.string(), v.null())),
    editorMode: v.optional(vEditorMode),
    workstreamId: v.optional(v.union(v.id("workstreams"), v.null())),
    artifactId: v.optional(v.union(v.id("artifacts"), v.null())),
    lastAiEditId: v.optional(v.union(v.string(), v.null())),
    pendingDiffs: v.optional(v.union(v.any(), v.null())),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await assertNoteOwnership(ctx, actor, args.noteId);

    if (args.workstreamId !== undefined) {
      await validateWorkstream(ctx, actor, args.workstreamId ?? undefined);
    }
    if (args.artifactId !== undefined) {
      await validateArtifact(ctx, actor, args.artifactId ?? undefined);
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.title !== undefined) {
      const title = normalizeString(args.title);
      if (!title) throw new Error("title cannot be empty");
      updates.title = title;
    }
    if (args.content !== undefined) updates.content = args.content;
    if (args.contentPlaintext !== undefined) {
      updates.contentPlaintext = normalizeString(toOptionalPatchValue(args.contentPlaintext));
    }
    if (args.editorMode !== undefined) updates.editorMode = args.editorMode;
    if (args.workstreamId !== undefined) updates.workstreamId = toOptionalPatchValue(args.workstreamId);
    if (args.artifactId !== undefined) updates.artifactId = toOptionalPatchValue(args.artifactId);
    if (args.lastAiEditId !== undefined) {
      updates.lastAiEditId = normalizeString(toOptionalPatchValue(args.lastAiEditId));
    }
    if (args.pendingDiffs !== undefined) updates.pendingDiffs = toOptionalPatchValue(args.pendingDiffs);

    await ctx.db.patch(args.noteId, updates);
    return { success: true };
  },
});

export const remove = mutation({
  args: {
    actorClerkId: v.string(),
    noteId: v.id("notes"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await assertNoteOwnership(ctx, actor, args.noteId);
    await ctx.db.delete(args.noteId);
    return { success: true };
  },
});
