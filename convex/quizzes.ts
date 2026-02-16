import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";

export const saveQuizResult = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    questions: v.array(
      v.object({
        id: v.string(),
        prompt: v.string(),
        selected: v.optional(v.string()),
        correct: v.optional(v.string()),
        isCorrect: v.boolean(),
        explanation: v.optional(v.string()),
      }),
    ),
    score: v.number(),
    total: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.ownerUserId !== actor._id || chat.orgId !== actor.orgId || chat.deletedAt) {
      throw new Error("Chat not found");
    }

    const message = await ctx.db.get(args.messageId);
    if (!message || message.chatId !== chat._id || message.userId !== actor._id) {
      throw new Error("Message not found");
    }

    const submittedAt = Date.now();
    const resultId = await ctx.db.insert("quizResults", {
      userId: actor._id,
      orgId: actor.orgId,
      chatId: chat._id,
      messageId: message._id,
      questions: args.questions,
      score: Math.max(0, Math.round(args.score)),
      total: Math.max(0, Math.round(args.total)),
      submittedAt,
    });

    return { resultId };
  },
});

export const getQuizHistory = query({
  args: {
    actorClerkId: v.string(),
    chatId: v.optional(v.id("chats")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const limit = Math.min(100, Math.max(1, args.limit ?? 25));
    const rows = await ctx.db
      .query("quizResults")
      .withIndex("by_user_submitted", (q) => q.eq("userId", actor._id))
      .collect();

    return rows
      .filter((row) => (args.chatId ? row.chatId === args.chatId : true))
      .sort((a, b) => b.submittedAt - a.submittedAt)
      .slice(0, limit);
  },
});
