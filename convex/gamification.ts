import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type AchievementDefinition = {
  type: string;
  name: string;
  description: string;
  xpEarned: number;
};

type AchievementPayload = {
  type: string;
  name: string;
  description: string;
  xpEarned: number;
  earnedAt: number;
};

const ACHIEVEMENTS: Record<string, AchievementDefinition> = {
  first_chat: {
    type: "first_chat",
    name: "First Steps",
    description: "Send your first message",
    xpEarned: 1,
  },
  streak_3: {
    type: "streak_3",
    name: "Getting Started",
    description: "Maintain a 3-day streak",
    xpEarned: 5,
  },
  streak_7: {
    type: "streak_7",
    name: "Week Warrior",
    description: "Maintain a 7-day streak",
    xpEarned: 15,
  },
  streak_30: {
    type: "streak_30",
    name: "Monthly Master",
    description: "Maintain a 30-day streak",
    xpEarned: 50,
  },
  quiz_perfect: {
    type: "quiz_perfect",
    name: "Perfect Score",
    description: "Score 100% on a quiz",
    xpEarned: 10,
  },
  quiz_master: {
    type: "quiz_master",
    name: "Quiz Master",
    description: "Complete 10 quizzes",
    xpEarned: 20,
  },
  flashcard_100: {
    type: "flashcard_100",
    name: "Card Collector",
    description: "Review 100 flashcards",
    xpEarned: 15,
  },
  research_pro: {
    type: "research_pro",
    name: "Research Pro",
    description: "Complete 10 research sessions with sources",
    xpEarned: 20,
  },
  mode_explorer: {
    type: "mode_explorer",
    name: "Mode Explorer",
    description: "Use all 10 modes",
    xpEarned: 10,
  },
  bookworm: {
    type: "bookworm",
    name: "Bookworm",
    description: "Upload 5 personal resources",
    xpEarned: 10,
  },
};

const XP_BY_ACTIVITY: Record<string, number> = {
  chat: 1,
  quiz: 5,
  flashcard: 2,
  research: 3,
};

const MODE_EXPLORER_TARGET_MODES = [
  "tutor",
  "marker",
  "exam",
  "draft_coach",
  "quiz",
  "flashcard",
  "research",
  "explain",
  "general",
  "image",
];

function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function parseIsoDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

async function requireActor(ctx: QueryCtx | MutationCtx, actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

async function getUserStreakDoc(
  ctx: QueryCtx | MutationCtx,
  userId: Doc<"users">["_id"],
) {
  const rows = await ctx.db
    .query("userStreaks")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return rows.sort((a, b) => b.lastActiveDate.localeCompare(a.lastActiveDate))[0] ?? null;
}

async function ensureUserStreakDoc(ctx: MutationCtx, actor: Doc<"users">) {
  const existing = await getUserStreakDoc(ctx, actor._id);
  if (existing) return existing;

  const today = dayKey();
  const streakId = await ctx.db.insert("userStreaks", {
    userId: actor._id,
    orgId: actor.orgId,
    currentStreak: 0,
    longestStreak: 0,
    lastActiveDate: today,
    totalXp: 0,
  });
  return ctx.db.get(streakId);
}

async function listUserAchievements(
  ctx: QueryCtx | MutationCtx,
  userId: Doc<"users">["_id"],
) {
  return ctx.db
    .query("achievements")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
}

async function unlockAchievement(
  ctx: MutationCtx,
  actor: Doc<"users">,
  definition: AchievementDefinition,
) {
  const earnedAt = Date.now();
  await ctx.db.insert("achievements", {
    userId: actor._id,
    orgId: actor.orgId,
    type: definition.type,
    name: definition.name,
    description: definition.description,
    xpEarned: definition.xpEarned,
    earnedAt,
  });

  await ctx.db.insert("notifications", {
    userId: actor._id,
    orgId: actor.orgId,
    type: "achievement_unlocked",
    title: `Achievement unlocked: ${definition.name}`,
    body: `${definition.description} (+${definition.xpEarned} XP)`,
    actionUrl: "/achievements",
    read: false,
    createdAt: earnedAt,
  });

  return {
    type: definition.type,
    name: definition.name,
    description: definition.description,
    xpEarned: definition.xpEarned,
    earnedAt,
  } satisfies AchievementPayload;
}

async function maybeAwardAchievement(
  ctx: MutationCtx,
  actor: Doc<"users">,
  existingTypes: Set<string>,
  key: keyof typeof ACHIEVEMENTS,
) {
  const definition = ACHIEVEMENTS[key];
  if (!definition || existingTypes.has(definition.type)) return null;

  const achievement = await unlockAchievement(ctx, actor, definition);
  existingTypes.add(definition.type);
  return achievement;
}

async function maybeAwardStreakAchievements(
  ctx: MutationCtx,
  actor: Doc<"users">,
  currentStreak: number,
  existingTypes: Set<string>,
) {
  const thresholds: Array<{ value: number; key: keyof typeof ACHIEVEMENTS }> = [
    { value: 30, key: "streak_30" },
    { value: 7, key: "streak_7" },
    { value: 3, key: "streak_3" },
  ];

  const unlocked: AchievementPayload[] = [];
  for (const threshold of thresholds) {
    if (currentStreak < threshold.value) continue;
    const achievement = await maybeAwardAchievement(ctx, actor, existingTypes, threshold.key);
    if (achievement) unlocked.push(achievement);
  }

  return unlocked;
}

async function hasUsedAllExplorerModes(
  ctx: MutationCtx,
  userId: Doc<"users">["_id"],
  modeUsed?: string,
) {
  const analyticsRows = await ctx.db
    .query("studentAnalytics")
    .withIndex("by_user_day", (q) => q.eq("userId", userId))
    .collect();

  const usedModes = new Set<string>();
  for (const row of analyticsRows) {
    for (const mode of row.modesUsed) {
      usedModes.add(mode);
    }
  }

  if (modeUsed) {
    usedModes.add(modeUsed);
  }

  return MODE_EXPLORER_TARGET_MODES.every((mode) => usedModes.has(mode));
}

async function countResearchSessionsWithSources(ctx: MutationCtx, userId: Doc<"users">["_id"]) {
  const messages = await ctx.db
    .query("messages")
    .withIndex("by_user_created", (q) => q.eq("userId", userId))
    .collect();

  return messages.filter((message) =>
    message.role === "assistant" &&
    message.mode === "research" &&
    message.citations.length > 0
  ).length;
}

async function countFlashcardReviews(ctx: MutationCtx, userId: Doc<"users">["_id"]) {
  const progress = await ctx.db
    .query("flashcardProgress")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return progress.reduce((sum, item) => sum + Math.max(0, item.repetitions), 0);
}

async function countPersonalResources(ctx: MutationCtx, userId: Doc<"users">["_id"]) {
  const resources = await ctx.db
    .query("resources")
    .withIndex("by_owner_scope", (q) => q.eq("ownerUserId", userId).eq("scope", "personal"))
    .collect();
  return resources.length;
}

async function evaluateActivityAchievements(
  ctx: MutationCtx,
  params: {
    actor: Doc<"users">;
    existingTypes: Set<string>;
    activityType: string;
    modeUsed?: string;
    currentStreak?: number;
    previousTotalXp: number;
  },
) {
  const {
    actor,
    existingTypes,
    activityType,
    modeUsed,
    currentStreak,
    previousTotalXp,
  } = params;
  const unlocked: AchievementPayload[] = [];

  if (previousTotalXp === 0 && !existingTypes.has(ACHIEVEMENTS.first_chat.type)) {
    const firstChat = await maybeAwardAchievement(ctx, actor, existingTypes, "first_chat");
    if (firstChat) unlocked.push(firstChat);
  }

  if ((currentStreak ?? 0) >= 3) {
    const streakUnlocks = await maybeAwardStreakAchievements(ctx, actor, currentStreak ?? 0, existingTypes);
    unlocked.push(...streakUnlocks);
  }

  if (!existingTypes.has(ACHIEVEMENTS.mode_explorer.type)) {
    const allModesUsed = await hasUsedAllExplorerModes(ctx, actor._id, modeUsed);
    if (allModesUsed) {
      const modeExplorer = await maybeAwardAchievement(ctx, actor, existingTypes, "mode_explorer");
      if (modeExplorer) unlocked.push(modeExplorer);
    }
  }

  if (!existingTypes.has(ACHIEVEMENTS.bookworm.type)) {
    const personalResources = await countPersonalResources(ctx, actor._id);
    if (personalResources >= 5) {
      const bookworm = await maybeAwardAchievement(ctx, actor, existingTypes, "bookworm");
      if (bookworm) unlocked.push(bookworm);
    }
  }

  if (activityType === "quiz") {
    const quizResults = await ctx.db
      .query("quizResults")
      .withIndex("by_user_submitted", (q) => q.eq("userId", actor._id))
      .collect();

    if (!existingTypes.has(ACHIEVEMENTS.quiz_master.type) && quizResults.length >= 10) {
      const quizMaster = await maybeAwardAchievement(ctx, actor, existingTypes, "quiz_master");
      if (quizMaster) unlocked.push(quizMaster);
    }

    if (!existingTypes.has(ACHIEVEMENTS.quiz_perfect.type)) {
      const hasPerfectScore = quizResults.some((row) => row.total > 0 && row.score >= row.total);
      if (hasPerfectScore) {
        const perfect = await maybeAwardAchievement(ctx, actor, existingTypes, "quiz_perfect");
        if (perfect) unlocked.push(perfect);
      }
    }
  }

  if (activityType === "flashcard" && !existingTypes.has(ACHIEVEMENTS.flashcard_100.type)) {
    const reviews = await countFlashcardReviews(ctx, actor._id);
    if (reviews >= 100) {
      const collector = await maybeAwardAchievement(ctx, actor, existingTypes, "flashcard_100");
      if (collector) unlocked.push(collector);
    }
  }

  if (activityType === "research" && !existingTypes.has(ACHIEVEMENTS.research_pro.type)) {
    const researchSessions = await countResearchSessionsWithSources(ctx, actor._id);
    if (researchSessions >= 10) {
      const researchPro = await maybeAwardAchievement(ctx, actor, existingTypes, "research_pro");
      if (researchPro) unlocked.push(researchPro);
    }
  }

  return unlocked;
}

export const checkAndUpdateStreak = mutation({
  args: {
    actorClerkId: v.string(),
    activityDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const today = args.activityDate ?? dayKey();
    const todayTs = parseIsoDate(today);
    if (!todayTs) {
      throw new Error("activityDate must be YYYY-MM-DD");
    }

    const streakDoc = await ensureUserStreakDoc(ctx, actor);
    if (!streakDoc) throw new Error("Unable to initialize streak");
    const existingAchievements = await listUserAchievements(ctx, actor._id);
    const existingTypes = new Set(existingAchievements.map((item) => item.type));

    const lastTs = parseIsoDate(streakDoc.lastActiveDate);
    const dayDiff = lastTs ? Math.round((todayTs - lastTs) / 86_400_000) : 0;

    let currentStreak = streakDoc.currentStreak;
    if (dayDiff <= 0) {
      return {
        currentStreak,
        longestStreak: streakDoc.longestStreak,
        lastActiveDate: streakDoc.lastActiveDate,
        unlockedAchievements: [] as AchievementPayload[],
      };
    }

    if (dayDiff === 1) {
      currentStreak += 1;
    } else {
      currentStreak = 1;
    }

    const longestStreak = Math.max(streakDoc.longestStreak, currentStreak);
    const streakUnlocks = await maybeAwardStreakAchievements(ctx, actor, currentStreak, existingTypes);
    const streakBonusXp = streakUnlocks.reduce((sum, item) => sum + item.xpEarned, 0);
    const totalXp = streakDoc.totalXp + streakBonusXp;

    await ctx.db.patch(streakDoc._id, {
      currentStreak,
      longestStreak,
      lastActiveDate: today,
      totalXp,
    });

    return {
      currentStreak,
      longestStreak,
      lastActiveDate: today,
      totalXp,
      unlockedAchievements: streakUnlocks,
    };
  },
});

export const awardXp = mutation({
  args: {
    actorClerkId: v.string(),
    activityType: v.string(),
    xp: v.optional(v.number()),
    modeUsed: v.optional(v.string()),
    currentStreak: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const streakDoc = await ensureUserStreakDoc(ctx, actor);
    if (!streakDoc) throw new Error("Unable to initialize streak");

    const existingAchievements = await listUserAchievements(ctx, actor._id);
    const existingTypes = new Set(existingAchievements.map((item) => item.type));
    const xpAwarded = Math.max(0, args.xp ?? XP_BY_ACTIVITY[args.activityType] ?? 0);
    const unlockedAchievements = await evaluateActivityAchievements(ctx, {
      actor,
      existingTypes,
      activityType: args.activityType,
      modeUsed: args.modeUsed,
      currentStreak: args.currentStreak,
      previousTotalXp: streakDoc.totalXp,
    });
    const achievementXpEarned = unlockedAchievements.reduce((sum, achievement) => sum + achievement.xpEarned, 0);

    const totalXp = streakDoc.totalXp + xpAwarded + achievementXpEarned;
    if (xpAwarded > 0 || achievementXpEarned > 0) {
      await ctx.db.patch(streakDoc._id, {
        totalXp,
      });
    }

    return {
      xpAwarded,
      achievementXpEarned,
      totalXp,
      unlockedAchievements,
    };
  },
});

export const logStudyTimerSession = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.optional(v.id("chats")),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    totalSeconds: v.number(),
    sessionType: v.union(v.literal("pomodoro"), v.literal("free")),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const boundedTotalSeconds = Math.min(4 * 60 * 60, Math.max(1, Math.round(args.totalSeconds)));
    const endedAt = Math.round(args.endedAt ?? Date.now());
    const startedAt = Math.round(args.startedAt ?? (endedAt - boundedTotalSeconds * 1000));

    if (args.chatId) {
      const chat = await ctx.db.get(args.chatId);
      if (!chat || chat.ownerUserId !== actor._id || chat.orgId !== actor.orgId) {
        throw new Error("Chat not found");
      }
    }

    const timerId = await ctx.db.insert("studyTimers", {
      userId: actor._id,
      orgId: actor.orgId,
      chatId: args.chatId,
      startedAt: Math.max(0, startedAt),
      endedAt: Math.max(0, endedAt),
      totalSeconds: boundedTotalSeconds,
      sessionType: args.sessionType,
    });

    return {
      timerId,
      totalSeconds: boundedTotalSeconds,
    };
  },
});

export const awardAchievement = mutation({
  args: {
    actorClerkId: v.string(),
    type: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    xpEarned: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const definition: AchievementDefinition | undefined = ACHIEVEMENTS[args.type] ?? (
      args.name && args.description
        ? {
            type: args.type,
            name: args.name,
            description: args.description,
            xpEarned: Math.max(0, args.xpEarned ?? 0),
          }
        : undefined
    );

    if (!definition) {
      throw new Error(`Unknown achievement type: ${args.type}`);
    }

    const existing = await listUserAchievements(ctx, actor._id)
      .then((rows) => rows.find((row) => row.type === definition.type));

    if (existing) {
      return { awarded: false, achievement: existing };
    }

    const unlocked = await unlockAchievement(ctx, actor, definition);

    const streakDoc = await ensureUserStreakDoc(ctx, actor);
    if (streakDoc && definition.xpEarned > 0) {
      await ctx.db.patch(streakDoc._id, {
        totalXp: streakDoc.totalXp + definition.xpEarned,
      });
    }

    return { awarded: true, achievement: unlocked };
  },
});

export const getUserStreak = query({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const streakDoc = await getUserStreakDoc(ctx, actor._id);
    if (!streakDoc) {
      return {
        currentStreak: 0,
        longestStreak: 0,
        totalXp: 0,
        lastActiveDate: null,
      };
    }
    return streakDoc;
  },
});

export const getUserAchievements = query({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const achievements = await listUserAchievements(ctx, actor._id);

    return achievements.sort((a, b) => b.earnedAt - a.earnedAt);
  },
});

export const getAchievementCatalog = query({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.actorClerkId);
    return Object.values(ACHIEVEMENTS).sort((a, b) => a.xpEarned - b.xpEarned);
  },
});

export const getLeaderboard = query({
  args: {
    actorClerkId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const limit = Math.min(50, Math.max(1, args.limit ?? 10));

    const streaks = await ctx.db.query("userStreaks").collect();
    const orgStreaks = streaks.filter((streak) => streak.orgId === actor.orgId);

    const users = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();
    const usersById = new Map(users.map((user) => [user._id, user]));

    return orgStreaks
      .sort((a, b) => b.totalXp - a.totalXp)
      .slice(0, limit)
      .map((row, index) => ({
        rank: index + 1,
        userId: row.userId,
        name: usersById.get(row.userId)?.name ?? "Unknown",
        totalXp: row.totalXp,
        currentStreak: row.currentStreak,
        longestStreak: row.longestStreak,
      }));
  },
});
