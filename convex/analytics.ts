import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId, dayKey } from "./helpers";

export const recordSession = mutation({
  args: {
    actorClerkId: v.string(),
    mode: v.string(),
    model: v.string(),
    tokensUsed: v.number(),
    topic: v.optional(v.string()),
    quizScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Actor not found");

    const day = dayKey();
    const existing = await ctx.db
      .query("studentAnalytics")
      .withIndex("by_user_day", (q) => q.eq("userId", actor._id).eq("day", day))
      .unique();

    if (existing) {
      const modesUsed = existing.modesUsed.includes(args.mode)
        ? existing.modesUsed
        : [...existing.modesUsed, args.mode];
      const modelsUsed = existing.modelsUsed.includes(args.model)
        ? existing.modelsUsed
        : [...existing.modelsUsed, args.model];
      const topicsExplored =
        args.topic && !existing.topicsExplored.includes(args.topic)
          ? [...existing.topicsExplored, args.topic]
          : existing.topicsExplored;
      const quizScores =
        args.quizScore !== undefined
          ? [...existing.quizScores, args.quizScore]
          : existing.quizScores;

      await ctx.db.patch(existing._id, {
        messagesCount: existing.messagesCount + 1,
        modesUsed,
        modelsUsed,
        topicsExplored,
        quizScores,
        totalTokensUsed: existing.totalTokensUsed + args.tokensUsed,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("studentAnalytics", {
        orgId: actor.orgId,
        userId: actor._id,
        day,
        sessionsCount: 1,
        messagesCount: 1,
        topicsExplored: args.topic ? [args.topic] : [],
        modesUsed: [args.mode],
        modelsUsed: [args.model],
        quizScores: args.quizScore !== undefined ? [args.quizScore] : [],
        totalTokensUsed: args.tokensUsed,
        updatedAt: Date.now(),
      });
    }
  },
});

export const getStudentAnalytics = query({
  args: {
    actorClerkId: v.string(),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Actor not found");

    const daysBack = args.days ?? 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    const cutoffDay = cutoff.toISOString().slice(0, 10);

    const rows = await ctx.db
      .query("studentAnalytics")
      .withIndex("by_user_day", (q) => q.eq("userId", actor._id))
      .collect();

    return rows.filter((r) => r.day >= cutoffDay);
  },
});

export const getRecentQuizPerformance = query({
  args: {
    actorClerkId: v.string(),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Actor not found");

    const daysBack = Math.min(Math.max(args.days ?? 30, 1), 120);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    const cutoffDay = cutoff.toISOString().slice(0, 10);

    const rows = await ctx.db
      .query("studentAnalytics")
      .withIndex("by_user_day", (q) => q.eq("userId", actor._id))
      .collect();

    const scores = rows
      .filter((row) => row.day >= cutoffDay)
      .flatMap((row) => row.quizScores ?? [])
      .filter((score) => Number.isFinite(score));

    const averageScore =
      scores.length > 0
        ? scores.reduce((sum, score) => sum + score, 0) / scores.length
        : undefined;

    const recommendedDifficulty =
      averageScore === undefined
        ? 3
        : averageScore >= 85
          ? 5
          : averageScore >= 75
            ? 4
            : averageScore >= 60
              ? 3
              : averageScore >= 45
                ? 2
                : 1;

    return {
      averageScore,
      attempts: scores.length,
      recommendedDifficulty,
    };
  },
});

export const getQuizDifficultySignal = query({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Actor not found");

    const rows = await ctx.db
      .query("studentAnalytics")
      .withIndex("by_user_day", (q) => q.eq("userId", actor._id))
      .collect();

    const withDifficulty = rows
      .filter((row) => typeof row.quizDifficultyLevel === "number")
      .sort((a, b) => b.day.localeCompare(a.day));

    return {
      difficultyLevel: withDifficulty[0]?.quizDifficultyLevel ?? 2,
    };
  },
});

export const setQuizDifficultySignal = mutation({
  args: {
    actorClerkId: v.string(),
    difficulty: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Actor not found");

    const day = dayKey();
    const difficulty = Math.min(5, Math.max(1, Math.round(args.difficulty)));
    const existing = await ctx.db
      .query("studentAnalytics")
      .withIndex("by_user_day", (q) => q.eq("userId", actor._id).eq("day", day))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        quizDifficultyLevel: difficulty,
        updatedAt: Date.now(),
      });
      return { ok: true };
    }

    await ctx.db.insert("studentAnalytics", {
      orgId: actor.orgId,
      userId: actor._id,
      day,
      sessionsCount: 1,
      messagesCount: 0,
      topicsExplored: [],
      modesUsed: ["quiz"],
      modelsUsed: [],
      quizScores: [],
      quizDifficultyLevel: difficulty,
      totalTokensUsed: 0,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const getClassAnalytics = query({
  args: {
    actorClerkId: v.string(),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Actor not found");
    if (actor.role !== "admin" && actor.role !== "teacher") {
      throw new Error("Only teachers and admins can view class analytics");
    }

    const daysBack = args.days ?? 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    const cutoffDay = cutoff.toISOString().slice(0, 10);

    const rows = await ctx.db
      .query("studentAnalytics")
      .withIndex("by_org_day", (q) => q.eq("orgId", actor.orgId))
      .collect();

    return rows.filter((r) => r.day >= cutoffDay);
  },
});

export const getStudentPromptSignals = query({
  args: {
    actorClerkId: v.string(),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Actor not found");

    const daysBack = args.days ?? 30;
    const cutoffTs = Date.now() - daysBack * 24 * 60 * 60 * 1000;

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_user_created", (q) => q.eq("userId", actor._id))
      .collect();

    const hourlyPromptCounts = Array.from({ length: 24 }, () => 0);
    const dayToPromptCount = new Map<string, number>();
    const dayToHourCounts = new Map<string, number[]>();
    const modelCounts = new Map<string, number>();

    for (const message of messages) {
      if (message.createdAt < cutoffTs) continue;

      const date = new Date(message.createdAt);
      const day = date.toISOString().slice(0, 10);

      if (message.role === "user") {
        const hour = date.getUTCHours();
        hourlyPromptCounts[hour] = (hourlyPromptCounts[hour] ?? 0) + 1;
        dayToPromptCount.set(day, (dayToPromptCount.get(day) ?? 0) + 1);
        const hourCounts = dayToHourCounts.get(day) ?? Array.from({ length: 24 }, () => 0);
        hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
        dayToHourCounts.set(day, hourCounts);
      }

      if (message.role === "assistant" && message.modelUsed) {
        modelCounts.set(message.modelUsed, (modelCounts.get(message.modelUsed) ?? 0) + 1);
      }
    }

    const dailyPromptCounts = [...dayToPromptCount.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, count]) => ({ day, count }));

    const dailyPeakHours = [...dayToHourCounts.entries()]
      .map(([day, counts]) => {
        let bestHour = 0;
        let bestCount = 0;
        for (let i = 0; i < counts.length; i += 1) {
          const count = counts[i] ?? 0;
          if (count > bestCount) {
            bestHour = i;
            bestCount = count;
          }
        }
        return { day, hour: bestHour, count: bestCount };
      })
      .sort((a, b) => a.day.localeCompare(b.day));

    let preferredModel: string | undefined;
    let preferredModelCount = 0;
    for (const [model, count] of modelCounts.entries()) {
      if (count > preferredModelCount) {
        preferredModel = model;
        preferredModelCount = count;
      }
    }

    return {
      hourlyPromptCounts,
      dailyPromptCounts,
      dailyPeakHours,
      preferredModel,
      preferredModelCount,
    };
  },
});

export const getStudentEnhancedAnalytics = query({
  args: {
    actorClerkId: v.string(),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Actor not found");

    const daysBack = Math.min(Math.max(args.days ?? 30, 7), 120);
    const cutoffTs = Date.now() - daysBack * 24 * 60 * 60 * 1000;
    const cutoffDay = new Date(cutoffTs).toISOString().slice(0, 10);

    const [messages, timers, quizzes, studentRows] = await Promise.all([
      ctx.db
        .query("messages")
        .withIndex("by_user_created", (q) => q.eq("userId", actor._id))
        .collect(),
      ctx.db
        .query("studyTimers")
        .withIndex("by_user", (q) => q.eq("userId", actor._id))
        .collect(),
      ctx.db
        .query("quizResults")
        .withIndex("by_user_submitted", (q) => q.eq("userId", actor._id))
        .collect(),
      ctx.db
        .query("studentAnalytics")
        .withIndex("by_user_day", (q) => q.eq("userId", actor._id))
        .collect(),
    ]);

    const modeMessageCounts: Record<string, number> = {};
    const messageCountsByDay = new Map<string, number>();

    for (const message of messages) {
      if (message.createdAt < cutoffTs) continue;
      modeMessageCounts[message.mode] = (modeMessageCounts[message.mode] ?? 0) + 1;
      const day = new Date(message.createdAt).toISOString().slice(0, 10);
      messageCountsByDay.set(day, (messageCountsByDay.get(day) ?? 0) + 1);
    }

    const timerSecondsByDay = new Map<string, number>();
    for (const timer of timers) {
      const anchorTs = timer.endedAt ?? timer.startedAt;
      if (anchorTs < cutoffTs) continue;
      const day = new Date(anchorTs).toISOString().slice(0, 10);
      timerSecondsByDay.set(day, (timerSecondsByDay.get(day) ?? 0) + Math.max(0, timer.totalSeconds));
    }

    const allDays = new Set<string>([
      ...messageCountsByDay.keys(),
      ...timerSecondsByDay.keys(),
    ]);
    const timeSpentDaily = [...allDays]
      .sort((a, b) => a.localeCompare(b))
      .map((day) => {
        const timerSeconds = timerSecondsByDay.get(day) ?? 0;
        const estimatedSeconds = Math.max(0, Math.round((messageCountsByDay.get(day) ?? 0) * 45));
        return {
          day,
          timerSeconds,
          estimatedSeconds,
          totalSeconds: Math.max(timerSeconds, estimatedSeconds),
          messages: messageCountsByDay.get(day) ?? 0,
        };
      });

    const quizTrendMap = new Map<string, { totalPercent: number; attempts: number }>();
    for (const quiz of quizzes) {
      if (quiz.submittedAt < cutoffTs) continue;
      const day = new Date(quiz.submittedAt).toISOString().slice(0, 10);
      const total = Math.max(1, quiz.total);
      const scorePercent = (quiz.score / total) * 100;
      const existing = quizTrendMap.get(day) ?? { totalPercent: 0, attempts: 0 };
      existing.totalPercent += scorePercent;
      existing.attempts += 1;
      quizTrendMap.set(day, existing);
    }
    const quizTrend = [...quizTrendMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, stats]) => ({
        day,
        attempts: stats.attempts,
        averageScore: Math.round(stats.totalPercent / Math.max(1, stats.attempts)),
      }));

    const filteredRows = studentRows.filter((row) => row.day >= cutoffDay);
    const activeDays = new Set(timeSpentDaily.map((item) => item.day)).size || 1;
    const totalMessages = Object.values(modeMessageCounts).reduce((sum, value) => sum + value, 0);
    const totalStudySeconds = timeSpentDaily.reduce((sum, item) => sum + item.totalSeconds, 0);
    const uniqueTopics = new Set(
      filteredRows
        .flatMap((row) => row.topicsExplored)
        .map((topic) => topic.trim().toLowerCase())
        .filter(Boolean),
    ).size;
    const estimatedSessions = Math.max(1, Math.round(totalStudySeconds / (25 * 60)));

    return {
      timeSpentDaily,
      modeMessageCounts,
      quizTrend,
      productivity: {
        totalStudySeconds,
        estimatedSessions,
        messagesPerSession: Number((totalMessages / estimatedSessions).toFixed(1)),
        topicDepth: Number((uniqueTopics / activeDays).toFixed(1)),
        activeDays,
      },
    };
  },
});
