import { mutation, query, action, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { GenericActionCtx } from "convex/server";
import { getUserByClerkId } from "./helpers";
import type { DataModel, Id } from "./_generated/dataModel";
import { api } from "./_generated/api";

async function ensureActorExists(
  ctx: Pick<GenericActionCtx<DataModel>, "runQuery">,
  actorClerkId: string,
) {
  const actor = await ctx.runQuery(api.users.me, {
    clerkId: actorClerkId,
  });
  if (!actor) {
    throw new Error("Unauthorized");
  }
  return actor;
}

/**
 * Action to decode base64 image data, store it as a blob in Convex _storage,
 * and return the storageId and serving URL. Never stores base64 in documents.
 */
export const storeImageFromBase64 = action({
  args: {
    actorClerkId: v.string(),
    base64Data: v.string(),
    mimeType: v.string(),
  },
  handler: async (ctx, args): Promise<{ storageId: Id<"_storage">; servingUrl: string }> => {
    await ensureActorExists(ctx, args.actorClerkId);

    // Strip data URL prefix if present (e.g. "data:image/png;base64,")
    const base64Clean = args.base64Data.replace(/^data:[^;]+;base64,/, "");

    // Decode base64 to bytes
    const binaryString = atob(base64Clean);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Store blob in Convex _storage
    const blob = new Blob([bytes], { type: args.mimeType });
    const storageId: Id<"_storage"> = await ctx.storage.store(blob);

    const servingUrl = await ctx.storage.getUrl(storageId);
    if (!servingUrl) {
      throw new Error("Failed to generate serving URL for stored image");
    }

    return { storageId, servingUrl };
  },
});

/**
 * Mutation to save image metadata after storage
 */
export const saveImageMetadata = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
    storageId: v.id("_storage"),
    servingUrl: v.string(),
    thumbnailStorageId: v.optional(v.id("_storage")),
    thumbnailUrl: v.optional(v.string()),
    prompt: v.string(),
    model: v.optional(v.string()),
    size: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"generatedImages">> => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

    const imageId = await ctx.db.insert("generatedImages", {
      orgId: actor.orgId,
      userId: actor._id,
      chatId: args.chatId,
      storageId: args.storageId,
      servingUrl: args.servingUrl,
      thumbnailStorageId: args.thumbnailStorageId,
      thumbnailUrl: args.thumbnailUrl,
      prompt: args.prompt,
      model: args.model,
      size: args.size,
      pinned: false,
      createdAt: Date.now(),
      expiresAt,
    });

    return imageId;
  },
});

/**
 * Action to store an image blob from base64 data
 * Actions can use ctx.storage.store(), then call mutation to save metadata
 */
export const storeImageBlob = action({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
    base64Data: v.string(),
    mimeType: v.string(),
    prompt: v.string(),
    model: v.optional(v.string()),
    size: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ imageId: Id<"generatedImages">; servingUrl: string; thumbnailUrl: string }> => {
    await ensureActorExists(ctx, args.actorClerkId);

    // Decode base64 to Uint8Array
    const base64Clean = args.base64Data.replace(/^data:image\/\w+;base64,/, "");
    const binaryString = atob(base64Clean);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Store full-size image in Convex storage
    const blob = new Blob([bytes], { type: args.mimeType });
    const storageId: Id<"_storage"> = await ctx.storage.store(blob);
    const servingUrl = await ctx.storage.getUrl(storageId);

    if (!servingUrl) {
      throw new Error("Failed to generate serving URL");
    }

    // For thumbnail, we use the same image for now
    const thumbnailStorageId = storageId;
    const thumbnailUrl = servingUrl;

    // Save metadata via mutation
    const imageId = await ctx.runMutation(api.images.saveImageMetadata, {
      actorClerkId: args.actorClerkId,
      chatId: args.chatId,
      storageId,
      servingUrl,
      thumbnailStorageId,
      thumbnailUrl,
      prompt: args.prompt,
      model: args.model,
      size: args.size,
    });

    return { imageId, servingUrl, thumbnailUrl };
  },
});

/**
 * Legacy mutation - redirects to new storage system
 * Handles both data URLs (stores them) and external URLs
 */
export const saveGeneratedImage = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
    prompt: v.string(),
    imageUrl: v.string(),
    model: v.optional(v.string()),
  },
  handler: async () => {
    // This is a legacy endpoint - new code should use the API route
    // that calls storeImageBlob action directly
    // For now, return a placeholder
    throw new Error("Use storeImageBlob action instead");
  },
});

/**
 * Paginated list of user images
 */
export const listGeneratedImages = query({
  args: {
    actorClerkId: v.string(),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const limit = Math.min(100, Math.max(1, args.limit ?? 16));

    // Get paginated results
    const results = await ctx.db
      .query("generatedImages")
      .withIndex("by_user", (q) => q.eq("userId", actor._id))
      .order("desc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: limit,
      });

    // Return only necessary data with pre-computed URLs
    // Handle both new (servingUrl) and legacy (imageUrl) formats
    return {
      images: results.page.map((img) => ({
        _id: img._id,
        thumbnailUrl: img.thumbnailUrl ?? img.servingUrl ?? img.imageUrl,
        fullUrl: img.servingUrl ?? img.imageUrl,
        prompt: img.prompt,
        model: img.model,
        size: img.size,
        pinned: img.pinned || false,
        createdAt: img.createdAt,
      })),
      nextCursor: results.continueCursor,
      isDone: results.isDone,
    };
  },
});

/**
 * Pin or unpin an image to prevent cleanup
 */
export const pinImage = mutation({
  args: {
    actorClerkId: v.string(),
    imageId: v.id("generatedImages"),
    pinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const image = await ctx.db.get(args.imageId);
    if (!image || image.userId !== actor._id) throw new Error("Not found");

    await ctx.db.patch(args.imageId, {
      pinned: args.pinned,
      pinnedAt: args.pinned ? Date.now() : undefined,
      expiresAt: args.pinned ? undefined : Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    return { ok: true, pinned: args.pinned };
  },
});

/**
 * Delete an image and its storage
 */
export const deleteGeneratedImage = mutation({
  args: {
    actorClerkId: v.string(),
    imageId: v.id("generatedImages"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const image = await ctx.db.get(args.imageId);
    if (!image || image.userId !== actor._id) throw new Error("Not found");

    // Delete from storage (storageId may be absent on legacy documents)
    try {
      if (image.storageId) {
        await ctx.storage.delete(image.storageId);
        if (image.thumbnailStorageId && image.thumbnailStorageId !== image.storageId) {
          await ctx.storage.delete(image.thumbnailStorageId);
        }
      }
    } catch {
      // Ignore storage delete errors
    }

    // Delete record
    await ctx.db.delete(args.imageId);
    return { ok: true };
  },
});

/**
 * Cleanup expired images (unpinned images older than retention period)
 * Run this via scheduler daily
 */
export const cleanupExpiredImages = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let deletedCount = 0;
    let batchCount = 0;
    const batchSize = 50;
    const maxBatches = 20;

    while (batchCount < maxBatches) {
      const expired = await ctx.db
        .query("generatedImages")
        .withIndex("by_expires", (q) => q.lt("expiresAt", now))
        .filter((q) =>
          q.or(q.eq(q.field("pinned"), false), q.eq(q.field("pinned"), undefined))
        )
        .take(batchSize);

      if (expired.length === 0) {
        break;
      }

      batchCount += 1;
      for (const image of expired) {
        try {
          if (image.storageId) {
            await ctx.storage.delete(image.storageId);
            if (image.thumbnailStorageId && image.thumbnailStorageId !== image.storageId) {
              await ctx.storage.delete(image.thumbnailStorageId);
            }
          }
          await ctx.db.delete(image._id);
          deletedCount++;
        } catch {
          // Continue with next on error
        }
      }

      if (expired.length < batchSize) {
        break;
      }
    }

    return {
      deletedCount,
      batchCount,
      hasMore: batchCount >= maxBatches,
    };
  },
});

/**
 * Get single image by ID
 */
export const getImage = query({
  args: {
    actorClerkId: v.string(),
    imageId: v.id("generatedImages"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const image = await ctx.db.get(args.imageId);
    if (!image || image.userId !== actor._id) return null;

    return {
      _id: image._id,
      thumbnailUrl: image.thumbnailUrl ?? image.servingUrl ?? image.imageUrl,
      fullUrl: image.servingUrl ?? image.imageUrl,
      prompt: image.prompt,
      model: image.model,
      size: image.size,
      pinned: image.pinned || false,
      createdAt: image.createdAt,
    };
  },
});
