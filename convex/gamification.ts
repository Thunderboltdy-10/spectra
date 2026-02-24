import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { computeStreakProgress, dayKey, parseIsoDate } from "./streakLogic";

type AchievementDefinition = {
  type: string;
  name: string;
  description: string;
  xpEarned: number;
  difficulty: "starter" | "bronze" | "silver" | "gold" | "legend";
};

type AchievementPayload = {
  type: string;
  name: string;
  description: string;
  xpEarned: number;
  earnedAt: number;
  difficulty?: AchievementDefinition["difficulty"];
};

const ACHIEVEMENTS: Record<string, AchievementDefinition> = {
  first_chat: {
    type: "first_chat",
    name: "First Steps",
    description: "Send your first message",
    xpEarned: 1,
    difficulty: "starter",
  },
  chat_50: {
    type: "chat_50",
    name: "Conversation Cadet",
    description: "Send 50 study messages",
    xpEarned: 14,
    difficulty: "bronze",
  },
  chat_200: {
    type: "chat_200",
    name: "Dialogue Driver",
    description: "Send 200 study messages",
    xpEarned: 45,
    difficulty: "silver",
  },
  chat_500: {
    type: "chat_500",
    name: "Scholar in Motion",
    description: "Send 500 study messages",
    xpEarned: 100,
    difficulty: "gold",
  },
  speed_reader: {
    type: "speed_reader",
    name: "Speed Reader",
    description: "Send 200+ study messages",
    xpEarned: 55,
    difficulty: "silver",
  },
  marathon_learner: {
    type: "marathon_learner",
    name: "Marathon Learner",
    description: "Reach 1,000 study messages",
    xpEarned: 180,
    difficulty: "legend",
  },
  streak_3: {
    type: "streak_3",
    name: "Getting Started",
    description: "Maintain a 3-day streak",
    xpEarned: 5,
    difficulty: "starter",
  },
  streak_7: {
    type: "streak_7",
    name: "Week Warrior",
    description: "Maintain a 7-day streak",
    xpEarned: 15,
    difficulty: "bronze",
  },
  streak_14: {
    type: "streak_14",
    name: "Fortnight Focus",
    description: "Maintain a 14-day streak",
    xpEarned: 30,
    difficulty: "silver",
  },
  streak_30: {
    type: "streak_30",
    name: "Monthly Master",
    description: "Maintain a 30-day streak",
    xpEarned: 50,
    difficulty: "silver",
  },
  streak_60: {
    type: "streak_60",
    name: "Momentum Engine",
    description: "Maintain a 60-day streak",
    xpEarned: 80,
    difficulty: "gold",
  },
  streak_100: {
    type: "streak_100",
    name: "Century Scholar",
    description: "Maintain a 100-day streak",
    xpEarned: 140,
    difficulty: "legend",
  },
  first_quiz: {
    type: "first_quiz",
    name: "Quiz Kickoff",
    description: "Complete your first quiz",
    xpEarned: 8,
    difficulty: "starter",
  },
  quiz_master: {
    type: "quiz_master",
    name: "Quiz Master",
    description: "Complete 10 quizzes",
    xpEarned: 20,
    difficulty: "bronze",
  },
  quiz_50: {
    type: "quiz_50",
    name: "Quiz Veteran",
    description: "Complete 50 quizzes",
    xpEarned: 60,
    difficulty: "silver",
  },
  quiz_100: {
    type: "quiz_100",
    name: "Quiz Titan",
    description: "Complete 100 quizzes",
    xpEarned: 110,
    difficulty: "gold",
  },
  quiz_250: {
    type: "quiz_250",
    name: "Quiz Legend",
    description: "Complete 250 quizzes",
    xpEarned: 200,
    difficulty: "legend",
  },
  quiz_perfect: {
    type: "quiz_perfect",
    name: "Perfect Score",
    description: "Score 100% on a quiz",
    xpEarned: 10,
    difficulty: "bronze",
  },
  quiz_streak_3: {
    type: "quiz_streak_3",
    name: "Accuracy Run",
    description: "Get 3 perfect quiz scores in a row",
    xpEarned: 30,
    difficulty: "silver",
  },
  quiz_streak_7: {
    type: "quiz_streak_7",
    name: "Unstoppable Accuracy",
    description: "Get 7 perfect quiz scores in a row",
    xpEarned: 80,
    difficulty: "gold",
  },
  first_flashcard: {
    type: "first_flashcard",
    name: "Deck Starter",
    description: "Review your first flashcard",
    xpEarned: 6,
    difficulty: "starter",
  },
  flashcard_50: {
    type: "flashcard_50",
    name: "Memory Builder",
    description: "Review 50 flashcards",
    xpEarned: 30,
    difficulty: "bronze",
  },
  flashcard_100: {
    type: "flashcard_100",
    name: "Card Collector",
    description: "Review 100 flashcards",
    xpEarned: 15,
    difficulty: "silver",
  },
  flashcard_250: {
    type: "flashcard_250",
    name: "Retention Architect",
    description: "Review 250 flashcards",
    xpEarned: 90,
    difficulty: "gold",
  },
  first_tutor: {
    type: "first_tutor",
    name: "Guided Start",
    description: "Complete your first Learn session",
    xpEarned: 6,
    difficulty: "starter",
  },
  tutor_50: {
    type: "tutor_50",
    name: "Concept Climber",
    description: "Complete 50 Learn sessions",
    xpEarned: 45,
    difficulty: "silver",
  },
  tutor_200: {
    type: "tutor_200",
    name: "Socratic Specialist",
    description: "Complete 200 Learn sessions",
    xpEarned: 120,
    difficulty: "gold",
  },
  first_research: {
    type: "first_research",
    name: "Research Starter",
    description: "Complete your first research session with sources",
    xpEarned: 8,
    difficulty: "starter",
  },
  research_pro: {
    type: "research_pro",
    name: "Research Pro",
    description: "Complete 10 research sessions with sources",
    xpEarned: 20,
    difficulty: "bronze",
  },
  research_50: {
    type: "research_50",
    name: "Evidence Hunter",
    description: "Complete 50 research sessions with sources",
    xpEarned: 80,
    difficulty: "gold",
  },
  research_100: {
    type: "research_100",
    name: "Source Strategist",
    description: "Complete 100 research sessions with sources",
    xpEarned: 140,
    difficulty: "legend",
  },
  first_image: {
    type: "first_image",
    name: "Visual Thinker",
    description: "Generate your first image response",
    xpEarned: 8,
    difficulty: "starter",
  },
  image_10: {
    type: "image_10",
    name: "Image Studio",
    description: "Generate 10 image responses",
    xpEarned: 35,
    difficulty: "silver",
  },
  mode_explorer: {
    type: "mode_explorer",
    name: "Mode Explorer",
    description: "Use all available study modes",
    xpEarned: 24,
    difficulty: "silver",
  },
  bookworm: {
    type: "bookworm",
    name: "Bookworm",
    description: "Upload 5 personal resources",
    xpEarned: 10,
    difficulty: "bronze",
  },
  resource_curator: {
    type: "resource_curator",
    name: "Resource Curator",
    description: "Upload 15 personal resources",
    xpEarned: 45,
    difficulty: "gold",
  },
  early_bird: {
    type: "early_bird",
    name: "Early Bird",
    description: "Study before 7:00 AM",
    xpEarned: 12,
    difficulty: "bronze",
  },
  night_owl: {
    type: "night_owl",
    name: "Night Owl",
    description: "Study after 11:00 PM",
    xpEarned: 12,
    difficulty: "bronze",
  },
  weekend_warrior: {
    type: "weekend_warrior",
    name: "Weekend Warrior",
    description: "Study on a Saturday or Sunday",
    xpEarned: 12,
    difficulty: "bronze",
  },
  focus_five_hours: {
    type: "focus_five_hours",
    name: "Deep Focus",
    description: "Accumulate 5+ hours of study timer sessions",
    xpEarned: 36,
    difficulty: "silver",
  },
  feature_explorer: {
    type: "feature_explorer",
    name: "Feature Explorer",
    description: "Unlock mode explorer, bookworm, and core mode starters",
    xpEarned: 40,
    difficulty: "gold",
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
  "quiz",
  "flashcard",
  "research",
  "general",
  "image",
];

async function requireActor(ctx: QueryCtx | MutationCtx, actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

function pickCanonicalStreakDoc(rows: Array<Doc<"userStreaks">>) {
  return [...rows].sort((a, b) => {
    if (a.totalXp !== b.totalXp) return b.totalXp - a.totalXp;
    if (a.longestStreak !== b.longestStreak) return b.longestStreak - a.longestStreak;
    if (a.currentStreak !== b.currentStreak) return b.currentStreak - a.currentStreak;
    if (a.lastActiveDate !== b.lastActiveDate) return b.lastActiveDate.localeCompare(a.lastActiveDate);
    return b._creationTime - a._creationTime;
  })[0] ?? null;
}

async function getUserStreakDoc(
  ctx: QueryCtx | MutationCtx,
  userId: Doc<"users">["_id"],
) {
  const rows = await ctx.db
    .query("userStreaks")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return pickCanonicalStreakDoc(rows);
}

async function reconcileDuplicateStreakDocs(
  ctx: MutationCtx,
  actor: Doc<"users">,
  rows: Array<Doc<"userStreaks">>,
) {
  const actorStreakId = (actor as Doc<"users"> & { userStreakId?: Doc<"userStreaks">["_id"] }).userStreakId;
  const canonical = pickCanonicalStreakDoc(rows);
  if (!canonical) return null;

  if (rows.length === 1) {
    if (actorStreakId !== canonical._id) {
      await ctx.db.patch(actor._id, {
        userStreakId: canonical._id,
        updatedAt: Date.now(),
      });
    }
    return canonical;
  }

  const byLatestDate = [...rows].sort((a, b) => b.lastActiveDate.localeCompare(a.lastActiveDate))[0] ?? canonical;
  const mergedCurrentStreak = Math.max(
    byLatestDate.currentStreak,
    ...rows
      .filter((row) => row.lastActiveDate === byLatestDate.lastActiveDate)
      .map((row) => row.currentStreak),
  );
  const mergedLongestStreak = Math.max(...rows.map((row) => row.longestStreak));
  const mergedTotalXp = Math.max(...rows.map((row) => row.totalXp));

  await ctx.db.patch(canonical._id, {
    currentStreak: Math.max(0, mergedCurrentStreak),
    longestStreak: Math.max(0, mergedLongestStreak),
    totalXp: Math.max(0, mergedTotalXp),
    lastActiveDate: byLatestDate.lastActiveDate,
  });

  const duplicateIds = rows
    .filter((row) => row._id !== canonical._id)
    .map((row) => row._id);
  for (const duplicateId of duplicateIds) {
    await ctx.db.delete(duplicateId);
  }

  await ctx.db.patch(actor._id, {
    userStreakId: canonical._id,
    updatedAt: Date.now(),
  });

  return ctx.db.get(canonical._id);
}

async function ensureUserStreakDoc(ctx: MutationCtx, actor: Doc<"users">) {
  const actorStreakId = (actor as Doc<"users"> & { userStreakId?: Doc<"userStreaks">["_id"] }).userStreakId;
  if (actorStreakId) {
    const linked = await ctx.db.get(actorStreakId);
    if (linked && linked.userId === actor._id && linked.orgId === actor.orgId) {
      const rows = await ctx.db
        .query("userStreaks")
        .withIndex("by_user", (q) => q.eq("userId", actor._id))
        .collect();
      if (rows.length > 1) {
        const reconciled = await reconcileDuplicateStreakDocs(ctx, actor, rows);
        if (reconciled) return reconciled;
      }
      return linked;
    }
  }

  const rows = await ctx.db
    .query("userStreaks")
    .withIndex("by_user", (q) => q.eq("userId", actor._id))
    .collect();

  if (rows.length > 0) {
    const existing = await reconcileDuplicateStreakDocs(ctx, actor, rows);
    if (existing) return existing;
  }

  const previousDay = dayKey(Date.now() - 86_400_000);
  const streakId = await ctx.db.insert("userStreaks", {
    userId: actor._id,
    orgId: actor.orgId,
    currentStreak: 0,
    longestStreak: 0,
    lastActiveDate: previousDay,
    totalXp: 0,
  });

  // This write creates a deterministic owner pointer on the user document.
  // Under concurrent first-time requests, Convex retries one transaction,
  // preventing duplicate committed streak docs for the same user.
  await ctx.db.patch(actor._id, {
    userStreakId: streakId,
    updatedAt: Date.now(),
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
    difficulty: definition.difficulty,
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
    { value: 100, key: "streak_100" },
    { value: 60, key: "streak_60" },
    { value: 30, key: "streak_30" },
    { value: 14, key: "streak_14" },
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

async function listUserMessages(ctx: MutationCtx, userId: Doc<"users">["_id"]) {
  return ctx.db
    .query("messages")
    .withIndex("by_user_created", (q) => q.eq("userId", userId))
    .collect();
}

async function countMessagesByMode(
  ctx: MutationCtx,
  userId: Doc<"users">["_id"],
  mode: string,
) {
  const messages = await listUserMessages(ctx, userId);
  return messages.filter((message) => message.role === "assistant" && message.mode === mode).length;
}

async function countUserMessageTurns(ctx: MutationCtx, userId: Doc<"users">["_id"]) {
  const messages = await listUserMessages(ctx, userId);
  return messages.filter((message) => message.role === "user").length;
}

async function countStudyTimerSeconds(ctx: MutationCtx, userId: Doc<"users">["_id"]) {
  const sessions = await ctx.db
    .query("studyTimers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return sessions.reduce((sum, session) => sum + Math.max(0, session.totalSeconds), 0);
}

function computePerfectQuizStreak(rows: Array<Doc<"quizResults">>) {
  const sorted = [...rows].sort((a, b) => b.submittedAt - a.submittedAt);
  let streak = 0;
  for (const row of sorted) {
    const total = Math.max(1, row.total);
    if (row.score >= total) {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

async function maybeAwardTimeBasedAchievements(
  ctx: MutationCtx,
  actor: Doc<"users">,
  existingTypes: Set<string>,
) {
  const unlocked: AchievementPayload[] = [];
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();

  if (hour < 7) {
    const earlyBird = await maybeAwardAchievement(ctx, actor, existingTypes, "early_bird");
    if (earlyBird) unlocked.push(earlyBird);
  }

  if (hour >= 23) {
    const nightOwl = await maybeAwardAchievement(ctx, actor, existingTypes, "night_owl");
    if (nightOwl) unlocked.push(nightOwl);
  }

  if (day === 0 || day === 6) {
    const weekendWarrior = await maybeAwardAchievement(ctx, actor, existingTypes, "weekend_warrior");
    if (weekendWarrior) unlocked.push(weekendWarrior);
  }

  return unlocked;
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

  let personalResourceCount: number | undefined;
  let quizResults: Array<Doc<"quizResults">> | undefined;
  let flashcardReviews: number | undefined;
  let researchSessionsWithSources: number | undefined;
  let userMessageTurns: number | undefined;
  let tutorSessions: number | undefined;
  let imageResponses: number | undefined;
  let totalStudySeconds: number | undefined;

  const getPersonalResources = async () => {
    if (typeof personalResourceCount === "number") return personalResourceCount;
    personalResourceCount = await countPersonalResources(ctx, actor._id);
    return personalResourceCount;
  };

  const getQuizResults = async () => {
    if (quizResults) return quizResults;
    quizResults = await ctx.db
      .query("quizResults")
      .withIndex("by_user_submitted", (q) => q.eq("userId", actor._id))
      .collect();
    return quizResults;
  };

  const getFlashcardReviews = async () => {
    if (typeof flashcardReviews === "number") return flashcardReviews;
    flashcardReviews = await countFlashcardReviews(ctx, actor._id);
    return flashcardReviews;
  };

  const getResearchSessions = async () => {
    if (typeof researchSessionsWithSources === "number") return researchSessionsWithSources;
    researchSessionsWithSources = await countResearchSessionsWithSources(ctx, actor._id);
    return researchSessionsWithSources;
  };

  const getUserMessageTurns = async () => {
    if (typeof userMessageTurns === "number") return userMessageTurns;
    userMessageTurns = await countUserMessageTurns(ctx, actor._id);
    return userMessageTurns;
  };

  const getTutorSessions = async () => {
    if (typeof tutorSessions === "number") return tutorSessions;
    tutorSessions = await countMessagesByMode(ctx, actor._id, "tutor");
    return tutorSessions;
  };

  const getImageResponses = async () => {
    if (typeof imageResponses === "number") return imageResponses;
    imageResponses = await countMessagesByMode(ctx, actor._id, "image");
    return imageResponses;
  };

  const getTotalStudySeconds = async () => {
    if (typeof totalStudySeconds === "number") return totalStudySeconds;
    totalStudySeconds = await countStudyTimerSeconds(ctx, actor._id);
    return totalStudySeconds;
  };

  if (previousTotalXp === 0 && !existingTypes.has(ACHIEVEMENTS.first_chat.type)) {
    const firstChat = await maybeAwardAchievement(ctx, actor, existingTypes, "first_chat");
    if (firstChat) unlocked.push(firstChat);
  }

  if ((currentStreak ?? 0) >= 3) {
    const streakUnlocks = await maybeAwardStreakAchievements(ctx, actor, currentStreak ?? 0, existingTypes);
    unlocked.push(...streakUnlocks);
  }

  unlocked.push(...(await maybeAwardTimeBasedAchievements(ctx, actor, existingTypes)));

  if (!existingTypes.has(ACHIEVEMENTS.mode_explorer.type)) {
    const allModesUsed = await hasUsedAllExplorerModes(ctx, actor._id, modeUsed);
    if (allModesUsed) {
      const modeExplorer = await maybeAwardAchievement(ctx, actor, existingTypes, "mode_explorer");
      if (modeExplorer) unlocked.push(modeExplorer);
    }
  }

  const resources = await getPersonalResources();
  if (resources >= 5 && !existingTypes.has(ACHIEVEMENTS.bookworm.type)) {
    const bookworm = await maybeAwardAchievement(ctx, actor, existingTypes, "bookworm");
    if (bookworm) unlocked.push(bookworm);
  }
  if (resources >= 15 && !existingTypes.has(ACHIEVEMENTS.resource_curator.type)) {
    const curator = await maybeAwardAchievement(ctx, actor, existingTypes, "resource_curator");
    if (curator) unlocked.push(curator);
  }

  if (modeUsed === "tutor" || activityType === "chat") {
    const tutorCount = await getTutorSessions();
    if (tutorCount >= 1) {
      const firstTutor = await maybeAwardAchievement(ctx, actor, existingTypes, "first_tutor");
      if (firstTutor) unlocked.push(firstTutor);
    }
    if (tutorCount >= 50) {
      const tutor50 = await maybeAwardAchievement(ctx, actor, existingTypes, "tutor_50");
      if (tutor50) unlocked.push(tutor50);
    }
    if (tutorCount >= 200) {
      const tutor200 = await maybeAwardAchievement(ctx, actor, existingTypes, "tutor_200");
      if (tutor200) unlocked.push(tutor200);
    }
  }

  if (modeUsed === "image" || activityType === "chat") {
    const imageCount = await getImageResponses();
    if (imageCount >= 1) {
      const firstImage = await maybeAwardAchievement(ctx, actor, existingTypes, "first_image");
      if (firstImage) unlocked.push(firstImage);
    }
    if (imageCount >= 10) {
      const image10 = await maybeAwardAchievement(ctx, actor, existingTypes, "image_10");
      if (image10) unlocked.push(image10);
    }
  }

  if (activityType === "chat") {
    const turns = await getUserMessageTurns();
    if (turns >= 50) {
      const chat50 = await maybeAwardAchievement(ctx, actor, existingTypes, "chat_50");
      if (chat50) unlocked.push(chat50);
    }
    if (turns >= 200) {
      const chat200 = await maybeAwardAchievement(ctx, actor, existingTypes, "chat_200");
      if (chat200) unlocked.push(chat200);
    }
    if (turns >= 500) {
      const chat500 = await maybeAwardAchievement(ctx, actor, existingTypes, "chat_500");
      if (chat500) unlocked.push(chat500);
    }
    if (turns >= 200) {
      const speedReader = await maybeAwardAchievement(ctx, actor, existingTypes, "speed_reader");
      if (speedReader) unlocked.push(speedReader);
    }
    if (turns >= 1000) {
      const marathon = await maybeAwardAchievement(ctx, actor, existingTypes, "marathon_learner");
      if (marathon) unlocked.push(marathon);
    }
  }

  if (activityType === "quiz" || modeUsed === "quiz") {
    const results = await getQuizResults();
    if (results.length >= 1) {
      const firstQuiz = await maybeAwardAchievement(ctx, actor, existingTypes, "first_quiz");
      if (firstQuiz) unlocked.push(firstQuiz);
    }
    if (results.length >= 10) {
      const quizMaster = await maybeAwardAchievement(ctx, actor, existingTypes, "quiz_master");
      if (quizMaster) unlocked.push(quizMaster);
    }
    if (results.length >= 50) {
      const quiz50 = await maybeAwardAchievement(ctx, actor, existingTypes, "quiz_50");
      if (quiz50) unlocked.push(quiz50);
    }
    if (results.length >= 100) {
      const quiz100 = await maybeAwardAchievement(ctx, actor, existingTypes, "quiz_100");
      if (quiz100) unlocked.push(quiz100);
    }
    if (results.length >= 250) {
      const quiz250 = await maybeAwardAchievement(ctx, actor, existingTypes, "quiz_250");
      if (quiz250) unlocked.push(quiz250);
    }

    const hasPerfectScore = results.some((row) => row.total > 0 && row.score >= row.total);
    if (hasPerfectScore) {
      const perfect = await maybeAwardAchievement(ctx, actor, existingTypes, "quiz_perfect");
      if (perfect) unlocked.push(perfect);
    }

    const perfectStreak = computePerfectQuizStreak(results);
    if (perfectStreak >= 3) {
      const quizStreak3 = await maybeAwardAchievement(ctx, actor, existingTypes, "quiz_streak_3");
      if (quizStreak3) unlocked.push(quizStreak3);
    }
    if (perfectStreak >= 7) {
      const quizStreak7 = await maybeAwardAchievement(ctx, actor, existingTypes, "quiz_streak_7");
      if (quizStreak7) unlocked.push(quizStreak7);
    }
  }

  if (activityType === "flashcard" || modeUsed === "flashcard") {
    const reviews = await getFlashcardReviews();
    if (reviews >= 1) {
      const firstFlashcard = await maybeAwardAchievement(ctx, actor, existingTypes, "first_flashcard");
      if (firstFlashcard) unlocked.push(firstFlashcard);
    }
    if (reviews >= 50) {
      const flash50 = await maybeAwardAchievement(ctx, actor, existingTypes, "flashcard_50");
      if (flash50) unlocked.push(flash50);
    }
    if (reviews >= 100) {
      const flash100 = await maybeAwardAchievement(ctx, actor, existingTypes, "flashcard_100");
      if (flash100) unlocked.push(flash100);
    }
    if (reviews >= 250) {
      const flash250 = await maybeAwardAchievement(ctx, actor, existingTypes, "flashcard_250");
      if (flash250) unlocked.push(flash250);
    }
  }

  if (activityType === "research" || modeUsed === "research") {
    const researchSessions = await getResearchSessions();
    if (researchSessions >= 1) {
      const firstResearch = await maybeAwardAchievement(ctx, actor, existingTypes, "first_research");
      if (firstResearch) unlocked.push(firstResearch);
    }
    if (researchSessions >= 10) {
      const researchPro = await maybeAwardAchievement(ctx, actor, existingTypes, "research_pro");
      if (researchPro) unlocked.push(researchPro);
    }
    if (researchSessions >= 50) {
      const research50 = await maybeAwardAchievement(ctx, actor, existingTypes, "research_50");
      if (research50) unlocked.push(research50);
    }
    if (researchSessions >= 100) {
      const research100 = await maybeAwardAchievement(ctx, actor, existingTypes, "research_100");
      if (research100) unlocked.push(research100);
    }
  }

  const timerSeconds = await getTotalStudySeconds();
  if (timerSeconds >= 5 * 60 * 60) {
    const focus = await maybeAwardAchievement(ctx, actor, existingTypes, "focus_five_hours");
    if (focus) unlocked.push(focus);
  }

  const featurePrereqs = [
    ACHIEVEMENTS.mode_explorer.type,
    ACHIEVEMENTS.bookworm.type,
    ACHIEVEMENTS.first_flashcard.type,
    ACHIEVEMENTS.first_research.type,
  ];
  const hasFeaturePrereqs = featurePrereqs.every((type) => existingTypes.has(type));
  if (hasFeaturePrereqs) {
    const featureExplorer = await maybeAwardAchievement(ctx, actor, existingTypes, "feature_explorer");
    if (featureExplorer) unlocked.push(featureExplorer);
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
    if (!parseIsoDate(today)) {
      throw new Error("activityDate must be YYYY-MM-DD");
    }

    const streakDoc = await ensureUserStreakDoc(ctx, actor);
    if (!streakDoc) throw new Error("Unable to initialize streak");
    const existingAchievements = await listUserAchievements(ctx, actor._id);
    const existingTypes = new Set(existingAchievements.map((item) => item.type));

    const progress = computeStreakProgress({
      currentStreak: streakDoc.currentStreak,
      longestStreak: streakDoc.longestStreak,
      lastActiveDate: streakDoc.lastActiveDate,
      activityDate: today,
    });
    if (!progress.changed) {
      return {
        currentStreak: progress.currentStreak,
        longestStreak: progress.longestStreak,
        lastActiveDate: progress.lastActiveDate,
        totalXp: streakDoc.totalXp,
        unlockedAchievements: [] as AchievementPayload[],
      };
    }

    const currentStreak = progress.currentStreak;
    const longestStreak = progress.longestStreak;
    const streakUnlocks = await maybeAwardStreakAchievements(ctx, actor, currentStreak, existingTypes);
    const streakBonusXp = streakUnlocks.reduce((sum, item) => sum + item.xpEarned, 0);
    const totalXp = streakDoc.totalXp + streakBonusXp;

    await ctx.db.patch(streakDoc._id, {
      currentStreak,
      longestStreak,
      lastActiveDate: progress.lastActiveDate,
      totalXp,
    });

    return {
      currentStreak,
      longestStreak,
      lastActiveDate: progress.lastActiveDate,
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
