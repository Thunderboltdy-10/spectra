import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { getUserByClerkId } from "./helpers";

const vEditorMode = v.union(
  v.literal("standard"),
  v.literal("ai_enhanced"),
  v.literal("agentic"),
  v.literal("notion"),
  v.literal("simple"),
);
const vNoteSourceType = v.union(
  v.literal("user_manual"),
  v.literal("ai_generated"),
  v.literal("managebac_sync"),
);

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

function normalizeEditorMode(mode: string | null | undefined) {
  if (mode === "agentic") return "ai_enhanced" as const;
  if (mode === "standard" || mode === "ai_enhanced" || mode === "simple" || mode === "notion") {
    return mode;
  }
  return "standard" as const;
}

async function resolveDocumentArtifact(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireActor>>,
  id: string,
) {
  const artifactId = ctx.db.normalizeId("artifacts", id);
  if (!artifactId) return null;
  const artifact = await ctx.db.get(artifactId);
  if (!artifact || artifact.ownerUserId !== actor._id || artifact.orgId !== actor.orgId || artifact.type !== "document") {
    return null;
  }
  return artifact;
}

async function resolveLegacyNote(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireActor>>,
  id: string,
) {
  const noteId = ctx.db.normalizeId("notes", id);
  if (!noteId) return null;
  const note = await ctx.db.get(noteId);
  if (!note || note.ownerUserId !== actor._id || note.orgId !== actor.orgId) {
    return null;
  }
  return note;
}

function toCompatDocument(artifact: Doc<"artifacts">) {
  return {
    _id: artifact._id,
    artifactId: undefined,
    title: artifact.title,
    content: artifact.content,
    contentPlaintext: artifact.contentPlaintext,
    editorMode: normalizeEditorMode(artifact.editorMode),
    sourceType: artifact.sourceType,
    managebacItemId: artifact.managebacItemId,
    sourceDeleted: artifact.sourceDeleted,
    sourceUpdatedAt: artifact.sourceUpdatedAt,
    syncConflictSummary: artifact.syncConflictSummary,
    lastAiEditId: artifact.lastAiEditId,
    pendingDiffs: artifact.pendingDiffs,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  };
}

function matchesDocumentSearch(
  row: Pick<Doc<"artifacts">, "title" | "contentPlaintext"> | Pick<Doc<"notes">, "title" | "contentPlaintext">,
  search: string,
) {
  const q = search.toLowerCase();
  return row.title.toLowerCase().includes(q) || (row.contentPlaintext?.toLowerCase().includes(q) ?? false);
}

function isLegacyDuplicate(note: Doc<"notes">, artifacts: Doc<"artifacts">[]) {
  return artifacts.some((artifact) =>
    artifact.type === "document"
    && artifact.title === note.title
    && artifact.managebacItemId === note.managebacItemId
    && artifact.createdAt === note.createdAt,
  );
}

async function migrateLegacyNoteToDocumentArtifact(
  ctx: Pick<MutationCtx, "db">,
  note: Doc<"notes">,
) {
  const existingArtifacts = await ctx.db
    .query("artifacts")
    .withIndex("by_owner_type", (q) => q.eq("ownerUserId", note.ownerUserId).eq("type", "document"))
    .collect();

  const duplicate = existingArtifacts.find((artifact) =>
    artifact.title === note.title
    && artifact.managebacItemId === note.managebacItemId
    && artifact.createdAt === note.createdAt,
  );

  if (duplicate) {
    if (!duplicate.legacyNoteId) {
      await ctx.db.patch(duplicate._id, {
        legacyNoteId: note._id,
        updatedAt: Date.now(),
      });
    }
    await ctx.db.delete(note._id);
    return duplicate;
  }

  const artifactId = await ctx.db.insert("artifacts", {
    ownerUserId: note.ownerUserId,
    orgId: note.orgId,
    type: "document",
    title: note.title,
    content: note.content,
    contentPlaintext: note.contentPlaintext,
    editorMode: normalizeEditorMode(note.editorMode),
    sourceType: note.sourceType ?? "user_manual",
    managebacItemId: note.managebacItemId,
    sourceDeleted: note.sourceDeleted,
    sourceUpdatedAt: note.sourceUpdatedAt,
    syncConflictSummary: note.syncConflictSummary,
    lastAiEditId: note.lastAiEditId,
    pendingDiffs: note.pendingDiffs,
    legacyNoteId: note._id,
    layout: undefined,
    tags: undefined,
    linkedAgentId: undefined,
    linkedChatId: undefined,
    status: "active",
    pinnedAt: undefined,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  });

  await ctx.db.insert("artifactVersions", {
    artifactId,
    diff: { op: "create" },
    snapshot: note.content,
    authorType: "user",
    description: "Migrated from legacy note",
    status: "confirmed",
    createdAt: note.createdAt,
  });
  await ctx.db.delete(note._id);

  const artifact = await ctx.db.get(artifactId);
  if (!artifact) {
    throw new Error("Failed to migrate legacy note");
  }
  return artifact;
}

export const list = query({
  args: {
    actorClerkId: v.string(),
    artifactId: v.optional(v.id("artifacts")),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const limit = Math.max(1, Math.min(args.limit ?? 100, 300));

    let artifacts = await ctx.db
      .query("artifacts")
      .withIndex("by_owner_type", (q) => q.eq("ownerUserId", actor._id).eq("type", "document"))
      .collect();
    artifacts = artifacts.filter((artifact) => artifact.status === "active");

    let legacyNotes = await ctx.db
      .query("notes")
      .withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id))
      .collect();
    legacyNotes = legacyNotes.filter((note) => !isLegacyDuplicate(note, artifacts));

    if (args.artifactId) {
      legacyNotes = legacyNotes.filter((note) => note.artifactId === args.artifactId);
    }

    const search = normalizeString(args.search);
    if (search) {
      artifacts = artifacts.filter((artifact) => matchesDocumentSearch(artifact, search));
      legacyNotes = legacyNotes.filter((note) => matchesDocumentSearch(note, search));
    }

    return [
      ...artifacts.map(toCompatDocument),
      ...legacyNotes.map((note) => ({
        _id: note._id,
        artifactId: note.artifactId,
        title: note.title,
        content: note.content,
        contentPlaintext: note.contentPlaintext,
        editorMode: normalizeEditorMode(note.editorMode),
        sourceType: note.sourceType,
        managebacItemId: note.managebacItemId,
        sourceDeleted: note.sourceDeleted,
        sourceUpdatedAt: note.sourceUpdatedAt,
        syncConflictSummary: note.syncConflictSummary,
        lastAiEditId: note.lastAiEditId,
        pendingDiffs: note.pendingDiffs,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      })),
    ]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  },
});

export const get = query({
  args: {
    actorClerkId: v.string(),
    noteId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const artifact = await resolveDocumentArtifact(ctx, actor, args.noteId);
    if (artifact) return toCompatDocument(artifact);

    const note = await resolveLegacyNote(ctx, actor, args.noteId);
    if (!note) {
      throw new Error("Note not found");
    }
    return {
      _id: note._id,
      artifactId: note.artifactId,
      title: note.title,
      content: note.content,
      contentPlaintext: note.contentPlaintext,
      editorMode: normalizeEditorMode(note.editorMode),
      sourceType: note.sourceType,
      managebacItemId: note.managebacItemId,
      sourceDeleted: note.sourceDeleted,
      sourceUpdatedAt: note.sourceUpdatedAt,
      syncConflictSummary: note.syncConflictSummary,
      lastAiEditId: note.lastAiEditId,
      pendingDiffs: note.pendingDiffs,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    };
  },
});

export const create = mutation({
  args: {
    actorClerkId: v.string(),
    title: v.string(),
    content: v.any(),
    contentPlaintext: v.optional(v.string()),
    editorMode: v.optional(vEditorMode),
    sourceType: v.optional(vNoteSourceType),
    managebacItemId: v.optional(v.string()),
    sourceDeleted: v.optional(v.boolean()),
    sourceUpdatedAt: v.optional(v.number()),
    syncConflictSummary: v.optional(v.string()),
    artifactId: v.optional(v.id("artifacts")),
    lastAiEditId: v.optional(v.string()),
    pendingDiffs: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const title = normalizeString(args.title);
    if (!title) throw new Error("title is required");

    const now = Date.now();
    const documentArtifactId = await ctx.db.insert("artifacts", {
      ownerUserId: actor._id,
      orgId: actor.orgId,
      type: "document",
      title,
      content: args.content,
      contentPlaintext: normalizeString(args.contentPlaintext),
      editorMode: normalizeEditorMode(args.editorMode),
      sourceType: args.sourceType ?? "user_manual",
      managebacItemId: normalizeString(args.managebacItemId),
      sourceDeleted: args.sourceDeleted,
      sourceUpdatedAt: args.sourceUpdatedAt,
      syncConflictSummary: normalizeString(args.syncConflictSummary),
      lastAiEditId: normalizeString(args.lastAiEditId),
      pendingDiffs: args.pendingDiffs,
      layout: undefined,
      tags: undefined,
      linkedAgentId: undefined,
      linkedChatId: undefined,
      status: "active",
      pinnedAt: undefined,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("artifactVersions", {
      artifactId: documentArtifactId,
      diff: { op: "create" },
      snapshot: args.content,
      authorType: "user",
      description: "Created artifact",
      status: "confirmed",
      createdAt: now,
    });
    return { noteId: documentArtifactId };
  },
});

export const update = mutation({
  args: {
    actorClerkId: v.string(),
    noteId: v.string(),
    title: v.optional(v.string()),
    content: v.optional(v.any()),
    contentPlaintext: v.optional(v.union(v.string(), v.null())),
    editorMode: v.optional(vEditorMode),
    sourceType: v.optional(v.union(vNoteSourceType, v.null())),
    managebacItemId: v.optional(v.union(v.string(), v.null())),
    sourceDeleted: v.optional(v.union(v.boolean(), v.null())),
    sourceUpdatedAt: v.optional(v.union(v.number(), v.null())),
    syncConflictSummary: v.optional(v.union(v.string(), v.null())),
    artifactId: v.optional(v.union(v.id("artifacts"), v.null())),
    lastAiEditId: v.optional(v.union(v.string(), v.null())),
    pendingDiffs: v.optional(v.union(v.any(), v.null())),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    let artifact = await resolveDocumentArtifact(ctx, actor, args.noteId);
    let migratedFromLegacy = false;
    if (!artifact) {
      const legacyNote = await resolveLegacyNote(ctx, actor, args.noteId);
      if (!legacyNote) {
        throw new Error("Note not found");
      }
      artifact = await migrateLegacyNoteToDocumentArtifact(ctx, legacyNote);
      migratedFromLegacy = true;
    }

    const now = Date.now();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (args.title !== undefined) {
      const title = normalizeString(args.title);
      if (!title) throw new Error("title cannot be empty");
      updates.title = title;
    }
    if (args.content !== undefined) updates.content = args.content;
    if (args.contentPlaintext !== undefined) {
      updates.contentPlaintext = normalizeString(toOptionalPatchValue(args.contentPlaintext));
    }
    if (args.editorMode !== undefined) updates.editorMode = normalizeEditorMode(args.editorMode);
    if (args.sourceType !== undefined) updates.sourceType = toOptionalPatchValue(args.sourceType);
    if (args.managebacItemId !== undefined) {
      updates.managebacItemId = normalizeString(toOptionalPatchValue(args.managebacItemId));
    }
    if (args.sourceDeleted !== undefined) updates.sourceDeleted = toOptionalPatchValue(args.sourceDeleted);
    if (args.sourceUpdatedAt !== undefined) updates.sourceUpdatedAt = toOptionalPatchValue(args.sourceUpdatedAt);
    if (args.syncConflictSummary !== undefined) {
      updates.syncConflictSummary = normalizeString(toOptionalPatchValue(args.syncConflictSummary));
    }
    if (args.lastAiEditId !== undefined) {
      updates.lastAiEditId = normalizeString(toOptionalPatchValue(args.lastAiEditId));
    }
    if (args.pendingDiffs !== undefined) updates.pendingDiffs = toOptionalPatchValue(args.pendingDiffs);

    await ctx.db.patch(artifact._id, updates);
    if (args.content !== undefined) {
      const versions = await ctx.db
        .query("artifactVersions")
        .withIndex("by_artifact", (q) => q.eq("artifactId", artifact._id))
        .collect();
      await ctx.db.insert("artifactVersions", {
        artifactId: artifact._id,
        diff: { op: "update", previous: artifact.content },
        snapshot: versions.length % 10 === 0 ? args.content : undefined,
        authorType: "user",
        description: "Updated artifact",
        status: "confirmed",
        createdAt: now,
      });
    }

    return { success: true, noteId: artifact._id, migratedFromLegacy };
  },
});

export const remove = mutation({
  args: {
    actorClerkId: v.string(),
    noteId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const artifact = await resolveDocumentArtifact(ctx, actor, args.noteId);
    if (!artifact) {
      const legacyNote = await resolveLegacyNote(ctx, actor, args.noteId);
      if (!legacyNote) {
        throw new Error("Note not found");
      }
      await ctx.db.delete(legacyNote._id);
      return { success: true };
    }

    const versions = await ctx.db
      .query("artifactVersions")
      .withIndex("by_artifact", (q) => q.eq("artifactId", artifact._id))
      .collect();
    for (const version of versions) {
      await ctx.db.delete(version._id);
    }
    const linkedChats = await ctx.db
      .query("chats")
      .withIndex("by_artifact", (q) => q.eq("artifactId", artifact._id))
      .collect();
    for (const chat of linkedChats) {
      await ctx.db.patch(chat._id, {
        artifactId: undefined,
        threadType: chat.threadType === "artifact_edit" ? "conversation" : chat.threadType,
        updatedAt: Date.now(),
      });
    }
    const plannerItems = await ctx.db
      .query("plannerItems")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", actor._id))
      .collect();
    for (const item of plannerItems) {
      if (item.sourceArtifactId === artifact._id) {
        await ctx.db.patch(item._id, {
          sourceArtifactId: undefined,
          updatedAt: Date.now(),
        });
      }
    }
    await ctx.db.delete(artifact._id);
    return { success: true };
  },
});
