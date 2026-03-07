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

    // Verify score server-side to prevent spoofing
    const verifiedScore = args.questions.reduce((acc, q) => {
      if (q.correct && q.selected && q.selected.toUpperCase() === q.correct.toUpperCase()) {
        return acc + 1;
      }
      return acc;
    }, 0);

    const submittedAt = Date.now();
    const payload = {
      userId: actor._id,
      orgId: actor.orgId,
      chatId: chat._id,
      messageId: message._id,
      questions: args.questions,
      score: verifiedScore,
      total: Math.max(0, Math.round(args.total)),
      submittedAt,
    };

    const existing = await ctx.db
      .query("quizResults")
      .withIndex("by_message", (q) => q.eq("messageId", message._id))
      .unique();

    const resultId = existing
      ? (await ctx.db.patch(existing._id, payload), existing._id)
      : await ctx.db.insert("quizResults", payload);

    const existingSession = await ctx.db
      .query("quizSessions")
      .withIndex("by_message", (q) => q.eq("messageId", message._id))
      .unique();
    if (existingSession) {
      await ctx.db.delete(existingSession._id);
    }

    return { resultId };
  },
});

export const saveQuizSession = mutation({
  args: {
    actorClerkId: v.string(),
    messageId: v.id("messages"),
    answers: v.array(v.object({ questionId: v.string(), selected: v.string() })),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const message = await ctx.db.get(args.messageId);
    if (!message || message.userId !== actor._id || message.orgId !== actor.orgId) {
      throw new Error("Message not found");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("quizSessions")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        answers: args.answers,
        updatedAt: now,
      });
      return { ok: true, updatedAt: now };
    }

    await ctx.db.insert("quizSessions", {
      userId: actor._id,
      orgId: actor.orgId,
      messageId: args.messageId,
      answers: args.answers,
      startedAt: now,
      updatedAt: now,
    });
    return { ok: true, updatedAt: now };
  },
});

export const getQuizStateByMessage = query({
  args: {
    actorClerkId: v.string(),
    messageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const message = await ctx.db.get(args.messageId);
    if (!message || message.userId !== actor._id || message.orgId !== actor.orgId) {
      throw new Error("Message not found");
    }

    const [result, session] = await Promise.all([
      ctx.db
        .query("quizResults")
        .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
        .unique(),
      ctx.db
        .query("quizSessions")
        .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
        .unique(),
    ]);

    return {
      result: result
        ? {
            score: result.score,
            total: result.total,
            questions: result.questions,
            submittedAt: result.submittedAt,
          }
        : null,
      session: session
        ? {
            answers: session.answers,
            startedAt: session.startedAt,
            updatedAt: session.updatedAt,
          }
        : null,
    };
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
