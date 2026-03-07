import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";
import type { Doc } from "./_generated/dataModel";

const SUPER_ADMIN_EMAILS = new Set(
  (process.env.SUPER_ADMIN_EMAILS ?? "pablo.martinez.dovale@gmail.com")
    .split(/[,\s;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

async function requireActor(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

async function requireOrgAdmin(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await requireActor(ctx, actorClerkId);
  if (actor.role !== "admin") {
    throw new Error("Admin access required");
  }
  return actor;
}

function isSuperAdminEmail(email: string) {
  return SUPER_ADMIN_EMAILS.has(email.trim().toLowerCase());
}

function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

export const createNotification = mutation({
  args: {
    actorClerkId: v.string(),
    type: v.string(),
    title: v.string(),
    body: v.string(),
    actionUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const notificationId = await ctx.db.insert("notifications", {
      userId: actor._id,
      orgId: actor.orgId,
      type: args.type,
      title: args.title.trim(),
      body: args.body.trim(),
      actionUrl: args.actionUrl,
      read: false,
      createdAt: Date.now(),
    });
    return { notificationId };
  },
});

export const sendSuperAdminAnnouncement = mutation({
  args: {
    actorClerkId: v.string(),
    audience: v.union(v.literal("all"), v.literal("org"), v.literal("email")),
    title: v.string(),
    body: v.string(),
    actionUrl: v.optional(v.string()),
    orgId: v.optional(v.id("orgs")),
    userEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    if (!isSuperAdminEmail(actor.email)) {
      throw new Error("Super admin access required");
    }

    const title = args.title.trim();
    const body = args.body.trim();
    const actionUrl = args.actionUrl?.trim() || undefined;
    if (!title || !body) {
      throw new Error("Title and body are required");
    }

    let recipients: Doc<"users">[] = [];
    if (args.audience === "all") {
      recipients = await ctx.db.query("users").collect();
    } else if (args.audience === "org") {
      if (!args.orgId) {
        throw new Error("orgId is required for org audience");
      }
      recipients = await ctx.db
        .query("users")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId!))
        .collect();
    } else {
      const email = args.userEmail?.trim().toLowerCase();
      if (!email) {
        throw new Error("userEmail is required for email audience");
      }
      const allUsers = await ctx.db.query("users").collect();
      recipients = allUsers.filter((user) => user.email.trim().toLowerCase() === email);
    }

    const uniqueRecipients = Array.from(
      new Map(recipients.map((user) => [user._id, user])).values(),
    );
    const createdAt = Date.now();

    for (const recipient of uniqueRecipients) {
      await ctx.db.insert("notifications", {
        userId: recipient._id,
        orgId: recipient.orgId,
        type: "super_admin_announcement",
        title,
        body,
        actionUrl,
        read: false,
        createdAt,
      });
    }

    return {
      sentCount: uniqueRecipients.length,
    };
  },
});

export const searchOrgRecipients = query({
  args: {
    actorClerkId: v.string(),
    search: v.optional(v.string()),
    role: v.optional(v.union(v.literal("student"), v.literal("teacher"), v.literal("admin"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireOrgAdmin(ctx, args.actorClerkId);
    const search = args.search?.trim().toLowerCase() ?? "";
    const limit = Math.min(50, Math.max(1, Math.round(args.limit ?? 12)));

    let recipients = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();

    if (args.role) {
      recipients = recipients.filter((user) => user.role === args.role);
    }

    if (search) {
      recipients = recipients.filter((user) =>
        user.name.trim().toLowerCase().includes(search)
        || user.email.trim().toLowerCase().includes(search),
      );
    }

    return {
      recipients: recipients
        .sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email))
        .slice(0, limit)
        .map((user) => ({
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
        })),
    };
  },
});

export const sendOrgAnnouncement = mutation({
  args: {
    actorClerkId: v.string(),
    title: v.string(),
    body: v.string(),
    actionUrl: v.optional(v.string()),
    recipientEmails: v.optional(v.array(v.string())),
    role: v.optional(v.union(v.literal("student"), v.literal("teacher"), v.literal("admin"))),
  },
  handler: async (ctx, args) => {
    const actor = await requireOrgAdmin(ctx, args.actorClerkId);
    const title = args.title.trim();
    const body = args.body.trim();
    const actionUrl = args.actionUrl?.trim() || undefined;

    if (!title || !body) {
      throw new Error("Title and body are required");
    }

    const orgUsers = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();

    const requestedEmails = new Set(
      (args.recipientEmails ?? [])
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    );

    let recipients = orgUsers.filter((user) => {
      if (args.role && user.role !== args.role) return false;
      if (requestedEmails.size > 0) {
        return requestedEmails.has(user.email.trim().toLowerCase());
      }
      return true;
    });

    recipients = Array.from(new Map(recipients.map((user) => [user._id, user])).values());
    if (recipients.length === 0) {
      throw new Error("No matching recipients found for this school");
    }

    const createdAt = Date.now();
    for (const recipient of recipients) {
      await ctx.db.insert("notifications", {
        userId: recipient._id,
        orgId: recipient.orgId,
        type: "school_admin_announcement",
        title,
        body,
        actionUrl,
        read: false,
        createdAt,
      });
    }

    await ctx.db.insert("auditLog", {
      actorUserId: actor._id,
      action: "school_admin_notification_sent",
      targetType: "org",
      targetId: String(actor.orgId),
      details: JSON.stringify({
        title,
        role: args.role,
        recipientEmails: [...requestedEmails],
        sentCount: recipients.length,
      }),
      createdAt,
    });

    return {
      sentCount: recipients.length,
    };
  },
});

export const listNotifications = query({
  args: {
    actorClerkId: v.string(),
    read: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const limit = Math.min(100, Math.max(1, args.limit ?? 30));

    let rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", actor._id))
      .collect();

    if (args.read !== undefined) {
      rows = rows.filter((row) => row.read === args.read);
    }

    rows.sort((a, b) => b.createdAt - a.createdAt);

    let startIndex = 0;
    if (args.cursor) {
      const cursorIndex = rows.findIndex((row) => row._id === args.cursor);
      if (cursorIndex !== -1) startIndex = cursorIndex + 1;
    }

    const page = rows.slice(startIndex, startIndex + limit);

    return {
      notifications: page,
      nextCursor: page.length === limit ? page[page.length - 1]?._id : undefined,
      totalCount: rows.length,
    };
  },
});

export const markRead = mutation({
  args: {
    actorClerkId: v.string(),
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.userId !== actor._id) {
      throw new Error("Notification not found");
    }

    await ctx.db.patch(args.notificationId, {
      read: true,
    });

    return { ok: true };
  },
});

export const markAllRead = mutation({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q) => q.eq("userId", actor._id).eq("read", false))
      .collect();

    for (const row of unread) {
      await ctx.db.patch(row._id, { read: true });
    }

    return { updated: unread.length };
  },
});

export const getUnreadCount = query({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q) => q.eq("userId", actor._id).eq("read", false))
      .collect();

    return {
      unreadCount: unread.length,
    };
  },
});

export const generateDailyStudyReminders = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const today = dayKey(now);
    const yesterday = dayKey(now - 86_400_000);
    const oneWeekAgo = now - (7 * 86_400_000);

    const users = await ctx.db.query("users").collect();
    let notificationsCreated = 0;

    for (const user of users) {
      const existingNotifications = await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();

      const todaysTypes = new Set(
        existingNotifications
          .filter((row) => dayKey(row.createdAt) === today)
          .map((row) => row.type),
      );

      if (!todaysTypes.has("reminder_flashcards_due")) {
        const dueFlashcards = await ctx.db
          .query("flashcardProgress")
          .withIndex("by_user_due", (q) => q.eq("userId", user._id).lte("nextReviewAt", now))
          .collect();

        if (dueFlashcards.length > 0) {
          await ctx.db.insert("notifications", {
            userId: user._id,
            orgId: user.orgId,
            type: "reminder_flashcards_due",
            title: "Flashcards are due",
            body: `You have ${dueFlashcards.length} flashcard${dueFlashcards.length === 1 ? "" : "s"} ready for review.`,
            actionUrl: "/flashcards",
            read: false,
            createdAt: now,
          });
          notificationsCreated += 1;
        }
      }

      if (!todaysTypes.has("reminder_streak_risk")) {
        const streak = await ctx.db
          .query("userStreaks")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .collect()
          .then((rows) => rows[0] ?? null);

        if (streak && streak.currentStreak > 0 && streak.lastActiveDate === yesterday) {
          await ctx.db.insert("notifications", {
            userId: user._id,
            orgId: user.orgId,
            type: "reminder_streak_risk",
            title: "Protect your streak",
            body: `Your ${streak.currentStreak}-day streak will reset if you skip study today.`,
            actionUrl: "/",
            read: false,
            createdAt: now,
          });
          notificationsCreated += 1;
        }
      }

      if (!todaysTypes.has("reminder_study_plan")) {
        const recentQuizResults = await ctx.db
          .query("quizResults")
          .withIndex("by_user_submitted", (q) => q.eq("userId", user._id).gte("submittedAt", oneWeekAgo))
          .collect();

        if (recentQuizResults.length >= 2) {
          const averageScore = recentQuizResults.reduce((sum, row) => {
            const total = Math.max(1, row.total);
            return sum + (row.score / total);
          }, 0) / recentQuizResults.length;

          await ctx.db.insert("notifications", {
            userId: user._id,
            orgId: user.orgId,
            type: "reminder_study_plan",
            title: "New study plan ready",
            body: averageScore < 0.7
              ? "Based on your recent quiz performance, generate a study plan for targeted practice."
              : "Your recent quiz momentum looks strong. Generate a fresh study plan to keep improving.",
            actionUrl: "/",
            read: false,
            createdAt: now,
          });
          notificationsCreated += 1;
        }
      }
    }

    return {
      usersProcessed: users.length,
      notificationsCreated,
      generatedAt: now,
    };
  },
});
