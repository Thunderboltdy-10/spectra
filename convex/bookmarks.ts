import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";

async function requireActor(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

export const toggleBookmark = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);

    const [chat, message] = await Promise.all([
      ctx.db.get(args.chatId),
      ctx.db.get(args.messageId),
    ]);

    if (!chat || chat.ownerUserId !== actor._id || chat.orgId !== actor.orgId || chat.deletedAt) {
      throw new Error("Chat not found");
    }
    if (!message || message.chatId !== chat._id || message.userId !== actor._id) {
      throw new Error("Message not found");
    }

    const existing = await ctx.db
      .query("messageBookmarks")
      .withIndex("by_user", (q) => q.eq("userId", actor._id))
      .collect()
      .then((rows) => rows.find((row) => row.messageId === args.messageId));

    if (existing) {
      await ctx.db.delete(existing._id);
      return { bookmarked: false };
    }

    const bookmarkId = await ctx.db.insert("messageBookmarks", {
      userId: actor._id,
      chatId: chat._id,
      messageId: message._id,
      note: args.note?.trim(),
      createdAt: Date.now(),
    });

    return { bookmarked: true, bookmarkId };
  },
});

export const listBookmarks = query({
  args: {
    actorClerkId: v.string(),
    chatId: v.optional(v.id("chats")),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    let rows = await ctx.db
      .query("messageBookmarks")
      .withIndex("by_user", (q) => q.eq("userId", actor._id))
      .collect();

    if (args.chatId) {
      rows = rows.filter((row) => row.chatId === args.chatId);
    }

    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getBookmarkedMessages = query({
  args: {
    actorClerkId: v.string(),
    chatId: v.optional(v.id("chats")),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    let bookmarks = await ctx.db
      .query("messageBookmarks")
      .withIndex("by_user", (q) => q.eq("userId", actor._id))
      .collect();

    if (args.chatId) {
      bookmarks = bookmarks.filter((bookmark) => bookmark.chatId === args.chatId);
    }

    bookmarks.sort((a, b) => b.createdAt - a.createdAt);

    const detailed = await Promise.all(
      bookmarks.map(async (bookmark) => {
        const [message, chat] = await Promise.all([
          ctx.db.get(bookmark.messageId),
          ctx.db.get(bookmark.chatId),
        ]);
        return {
          ...bookmark,
          message,
          chatTitle: chat?.title ?? "Unknown chat",
        };
      }),
    );

    return detailed.filter((item) => !!item.message);
  },
});
