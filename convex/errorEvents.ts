import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const log = mutation({
  args: {
    level: v.string(),
    message: v.string(),
    source: v.optional(v.string()),
    stack: v.optional(v.string()),
    metadata: v.optional(v.string()),
    actorClerkId: v.optional(v.string()),
    chatId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("errorEvents", {
      level: args.level,
      message: args.message.slice(0, 2000),
      source: args.source?.slice(0, 200),
      stack: args.stack?.slice(0, 4000),
      metadata: args.metadata?.slice(0, 2000),
      actorClerkId: args.actorClerkId,
      chatId: args.chatId,
      createdAt: Date.now(),
    });
  },
});

export const list = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(100, Math.max(1, args.limit ?? 50));
    return await ctx.db
      .query("errorEvents")
      .withIndex("by_created")
      .order("desc")
      .take(limit);
  },
});
