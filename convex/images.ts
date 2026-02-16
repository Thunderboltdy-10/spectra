import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";

export const saveGeneratedImage = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
    prompt: v.string(),
    imageUrl: v.string(),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const imageId = await ctx.db.insert("generatedImages", {
      orgId: actor.orgId,
      userId: actor._id,
      chatId: args.chatId,
      prompt: args.prompt,
      imageUrl: args.imageUrl,
      model: args.model,
      createdAt: Date.now(),
    });

    return { imageId };
  },
});

export const listGeneratedImages = query({
  args: {
    actorClerkId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const images = await ctx.db
      .query("generatedImages")
      .withIndex("by_user", (q) => q.eq("userId", actor._id))
      .order("desc")
      .take(Math.min(100, args.limit ?? 50));

    return images;
  },
});

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

    await ctx.db.delete(args.imageId);
    return { ok: true };
  },
});
