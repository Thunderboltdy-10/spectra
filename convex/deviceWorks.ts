import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./functions";
import { internalMutation, mutation } from "./orgNodeMutation";
import {
  defaultArtifactContent,
  defaultArtifactSchemaVersion,
  requireArtifactCapability,
  requireSpectraActor,
  type BlueprintKey,
} from "./spectraShared";
import { findPrimaryNode, syncSourceNodes } from "./orgTreeShared";

/*
 * Work kept on someone's computer. Its words live in Spectra Bridge; the row
 * here holds what finding it needs (name, place in the tree, who owns it) and
 * which computer has it, so opening or listing it costs almost nothing here.
 */

export const vWorkStorage = v.union(v.literal("device_backup"), v.literal("device_only"), v.literal("cloud"));

/** What can live on a computer. Files from Office keep their own sync, and calendars and agents run from the cloud. */
export const DEVICE_WORK_TYPES = new Set(["document", "flashcard_deck", "quiz", "presentation", "sheets", "code", "whiteboard"]);

const BACKUPS_KEPT = 7;

async function ownedWorks(ctx: QueryCtx, accountId: Id<"accounts">, perKind: number) {
  const pages = await Promise.all([...DEVICE_WORK_TYPES].map((blueprintKey) =>
    ctx.db
      .query("spectraArtifacts")
      .withIndex("by_account_blueprint", (q) =>
        q.eq("ownerAccountId", accountId).eq("blueprintKey", blueprintKey as BlueprintKey))
      .order("desc")
      .take(perKind)));
  return pages.flat();
}

export const settings = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireSpectraActor(ctx);
    const account = await ctx.db.get(actor._id);
    const recent = await ctx.db
      .query("deviceBackups")
      .withIndex("by_account", (q) => q.eq("accountId", actor._id))
      .order("desc")
      .take(BACKUPS_KEPT + 1);
    return {
      accountId: actor._id,
      storage: account?.workStorage ?? null,
      backupEveryHours: account?.workBackupEveryHours ?? 24,
      lastBackupAt: recent[0]?.createdAt ?? null,
      lastFullBackupAt: recent.find((row) => row.full)?.createdAt ?? null,
    };
  },
});

export const choose = mutation({
  args: { storage: vWorkStorage, backupEveryHours: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const hours = args.backupEveryHours === undefined ? undefined : Math.min(24 * 7, Math.max(1, args.backupEveryHours));
    await ctx.db.patch(actor._id, {
      workStorage: args.storage,
      ...(hours === undefined ? {} : { workBackupEveryHours: hours }),
    });
    return { storage: args.storage };
  },
});

/** How much is on which side, for the choice's picture of what would move. */
export const counts = query({
  args: { storeId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const rows = await ownedWorks(ctx, actor._id, 150);
    let here = 0;
    let elsewhere = 0;
    let cloud = 0;
    for (const row of rows) {
      if (row.status === "deleted" || row.resourceClass === "resource") continue;
      if (row.storageHome !== "device") {
        // An Office file stays with its source for now, so it isn't "still to move".
        if (!row.nativeFormat) cloud += 1;
      }
      else if (row.storageStoreId === args.storeId) here += 1;
      else elsewhere += 1;
    }
    return { here, elsewhere, cloud };
  },
});

/** The cloud works that could move to this computer, a few at a time. */
export const movable = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const rows = await ownedWorks(ctx, actor._id, 60);
    return rows
      .filter((row) =>
        row.status !== "deleted" && row.storageHome !== "device" &&
        row.resourceClass !== "resource" && !row.nativeFormat)
      .slice(0, Math.min(50, args.limit ?? 20))
      .map((row) => row._id);
  },
});

/** What's held by this computer, for moving it back online. */
/** Which of these works live on a computer rather than here. */
export const homesOf = query({
  args: { artifactIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const rows = await Promise.all(
      args.artifactIds.slice(0, 24).map(async (value) => {
        const id = ctx.db.normalizeId("spectraArtifacts", value);
        return id ? await ctx.db.get(id) : null;
      }),
    );
    return {
      accountId: String(actor._id),
      onDevice: rows.flatMap((row) => (row && row.ownerAccountId === actor._id && row.storageHome === "device" ? [String(row._id)] : [])),
    };
  },
});

export const onThisComputer = query({
  args: { storeId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const rows = await ownedWorks(ctx, actor._id, 60);
    return rows
      .filter((row) => row.status !== "deleted" && row.storageHome === "device" && row.storageStoreId === args.storeId)
      .slice(0, Math.min(50, args.limit ?? 20))
      .map((row) => row._id);
  },
});

/** After a backup is brought to a new computer, its works belong to that computer. */
export const adoptRestored = mutation({
  args: { storeId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const rows = await ownedWorks(ctx, actor._id, 150);
    let adopted = 0;
    for (const row of rows) {
      if (row.status === "deleted" || row.storageHome !== "device" || row.storageStoreId === args.storeId) continue;
      await ctx.db.patch(row._id, { storageStoreId: args.storeId });
      adopted += 1;
    }
    return { adopted };
  },
});

/** The name and summary follow the work, so lists stay right without opening it. */
export const touch = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    edited: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { artifact } = await requireArtifactCapability(ctx, args.artifactId, "modify");
    if (artifact.storageHome !== "device") return { touched: false };
    const title = args.title?.trim().slice(0, 300);
    const summary = args.summary?.trim().slice(0, 800);
    const retitled = Boolean(title && title !== artifact.title);
    const changed =
      retitled ||
      (summary !== undefined && summary !== artifact.summary) ||
      (args.tags !== undefined && JSON.stringify(args.tags) !== JSON.stringify(artifact.tags));
    if (!changed && !args.edited) return { touched: false };
    await ctx.db.patch(args.artifactId, {
      ...(title ? { title, textIndex: title } : {}),
      ...(summary !== undefined ? { summary } : {}),
      ...(args.tags ? { tags: args.tags.slice(0, 80) } : {}),
      updatedAt: Date.now(),
    });
    if (retitled && title) await syncSourceNodes(ctx, "work", args.artifactId, title);
    return { touched: true };
  },
});

/** Finishes a work the AI just wrote on this computer. */
export const finishCreate = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { artifact } = await requireArtifactCapability(ctx, args.artifactId, "modify");
    if (artifact.storageHome !== "device") throw new Error("This work isn't kept on a computer.");
    const title = args.title?.trim().slice(0, 300) || artifact.title;
    const now = Date.now();
    await ctx.db.patch(args.artifactId, {
      title,
      textIndex: title,
      ...(args.summary ? { summary: args.summary.slice(0, 800) } : {}),
      ...(args.tags ? { tags: args.tags.slice(0, 80) } : {}),
      aiState: "edited",
      aiRunId: undefined,
      aiExecutionId: undefined,
      aiStateExpiresAt: now + 4_000,
      aiProgress: undefined,
      updatedAt: now,
    });
    if (title !== artifact.title) await syncSourceNodes(ctx, "work", args.artifactId, title);
    const node = await findPrimaryNode(ctx, artifact.ownerAccountId, "work", args.artifactId);
    return { artifactId: args.artifactId, ...(node ? { nodeId: node._id } : {}) };
  },
});

/** Its words are on this computer now, so the copy here can go. */
export const movedToDevice = mutation({
  args: { artifactId: v.id("spectraArtifacts"), storeId: v.string() },
  handler: async (ctx, args) => {
    const { actor, artifact } = await requireArtifactCapability(ctx, args.artifactId, "modify");
    if (artifact.ownerAccountId !== actor.accountId) throw new Error("Only the owner can keep this on their computer.");
    if (!DEVICE_WORK_TYPES.has(artifact.blueprintKey) || artifact.nativeFormat)
      throw new Error("This kind of work stays in the cloud.");
    const shared = await ctx.db
      .query("accessGrants")
      .withIndex("by_resource", (q) => q.eq("resourceType", "artifact").eq("resourceId", args.artifactId))
      .first();
    if (shared) throw new Error("A shared work stays online so everyone can open it.");
    const blueprintKey = artifact.blueprintKey as BlueprintKey;
    await ctx.db.patch(args.artifactId, {
      storageHome: "device",
      storageStoreId: args.storeId,
      content: defaultArtifactContent(blueprintKey),
      schemaVersion: defaultArtifactSchemaVersion(blueprintKey),
      textIndex: artifact.title,
      projectionPayloadRef: undefined,
      updatedAt: Date.now(),
    });
    return { moved: true };
  },
});

/** Its words came back up, for sharing or for another computer. */
export const movedToCloud = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    title: v.string(),
    summary: v.optional(v.string()),
    tags: v.array(v.string()),
    content: v.any(),
    textIndex: v.string(),
  },
  handler: async (ctx, args) => {
    const { artifact } = await requireArtifactCapability(ctx, args.artifactId, "modify");
    if (artifact.storageHome !== "device") return { moved: false };
    await ctx.db.patch(args.artifactId, {
      storageHome: undefined,
      storageStoreId: undefined,
      title: args.title,
      ...(args.summary !== undefined ? { summary: args.summary } : {}),
      tags: args.tags,
      content: args.content,
      textIndex: args.textIndex.slice(0, 200_000),
      updatedAt: Date.now(),
    });
    return { moved: true };
  },
});

export const backupUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireSpectraActor(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const recordBackup = mutation({
  args: { storeId: v.string(), storageId: v.id("_storage"), bytes: v.number(), works: v.number(), full: v.boolean() },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const now = Date.now();
    await ctx.db.insert("deviceBackups", {
      accountId: actor._id,
      storeId: args.storeId,
      storageId: args.storageId,
      bytes: args.bytes,
      works: args.works,
      full: args.full,
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.deviceWorks.pruneBackups, { accountId: actor._id });
    return { at: now };
  },
});

export const pruneBackups = internalMutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("deviceBackups")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .order("desc")
      .collect();
    // Later backups hold only changes, so the newest full one and everything after stay.
    const lastFull = rows.findIndex((row) => row.full);
    const keep = Math.max(BACKUPS_KEPT, lastFull + 1);
    for (const row of rows.slice(keep)) {
      await ctx.storage.delete(row.storageId as Id<"_storage">);
      await ctx.db.delete(row._id);
    }
  },
});

/** Everything needed to bring this account's work back, oldest first. */
export const backupsToRestore = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireSpectraActor(ctx);
    const rows = await ctx.db
      .query("deviceBackups")
      .withIndex("by_account", (q) => q.eq("accountId", actor._id))
      .order("desc")
      .take(BACKUPS_KEPT * 4);
    const lastFull = rows.findIndex((row) => row.full);
    const needed = (lastFull >= 0 ? rows.slice(0, lastFull + 1) : rows).reverse();
    return Promise.all(
      needed.map(async (row) => ({ at: row.createdAt, works: row.works, url: await ctx.storage.getUrl(row.storageId) })),
    );
  },
});

/** Turning backups off: what was uploaded goes too. */
export const deleteBackups = mutation({
  args: {},
  handler: async (ctx) => {
    const actor = await requireSpectraActor(ctx);
    const rows = await ctx.db
      .query("deviceBackups")
      .withIndex("by_account", (q) => q.eq("accountId", actor._id))
      .collect();
    for (const row of rows) {
      await ctx.storage.delete(row.storageId as Id<"_storage">);
      await ctx.db.delete(row._id);
    }
    return { deleted: rows.length };
  },
});
