import { action, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";
import { vFeedbackCategory, vFeedbackStatus } from "./shared";
import type { Id } from "./_generated/dataModel";

const SUPER_ADMIN_EMAILS = new Set(
  (process.env.SUPER_ADMIN_EMAILS ?? "pablo.martinez.dovale@gmail.com")
    .split(/[,\s;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

async function requireSuperAdmin(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  if (!SUPER_ADMIN_EMAILS.has(actor.email.trim().toLowerCase())) {
    throw new Error("Super admin access required");
  }
  return actor;
}

export const submitFeedback = mutation({
  args: {
    actorClerkId: v.optional(v.string()),
    category: vFeedbackCategory,
    message: v.string(),
    screenshotStorageId: v.optional(v.id("_storage")),
    context: v.optional(
      v.object({
        mode: v.optional(v.string()),
        page: v.optional(v.string()),
        device: v.optional(v.string()),
        traceId: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const actor = args.actorClerkId ? await getUserByClerkId(ctx, args.actorClerkId) : null;
    const now = Date.now();
    const trimmedMessage = args.message.trim();
    if (!trimmedMessage) {
      throw new Error("Feedback message is required");
    }

    const feedbackId = await ctx.db.insert("feedback", {
      userId: actor?.clerkId,
      orgId: actor?.orgId,
      category: args.category,
      message: trimmedMessage,
      screenshotStorageId: args.screenshotStorageId,
      context: args.context ?? {},
      status: "new",
      createdAt: now,
      updatedAt: now,
    });

    return { ok: true, feedbackId };
  },
});

export const storeFeedbackScreenshot = action({
  args: {
    base64Data: v.string(),
    mimeType: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.mimeType.startsWith("image/")) {
      throw new Error("Screenshot must be an image");
    }

    const base64Clean = args.base64Data.replace(/^data:[^;]+;base64,/, "");
    const binaryString = atob(base64Clean);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const storageId = await ctx.storage.store(new Blob([bytes], { type: args.mimeType }));
    return { storageId };
  },
});

export const listFeedback = query({
  args: {
    actorClerkId: v.string(),
    status: v.optional(vFeedbackStatus),
    category: v.optional(vFeedbackCategory),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);

    const limit = Math.min(100, Math.max(1, args.limit ?? 25));
    let items = await ctx.db
      .query("feedback")
      .withIndex("by_created")
      .collect();

    if (args.status) {
      items = items.filter((item) => item.status === args.status);
    }
    if (args.category) {
      items = items.filter((item) => item.category === args.category);
    }

    items.sort((a, b) => b.createdAt - a.createdAt);

    let startIndex = 0;
    if (args.cursor) {
      const cursorIndex = items.findIndex((item) => item._id === (args.cursor as Id<"feedback">));
      if (cursorIndex !== -1) startIndex = cursorIndex + 1;
    }

    const page = items.slice(startIndex, startIndex + limit);
    const withScreenshotUrls = await Promise.all(
      page.map(async (item) => ({
        ...item,
        screenshotUrl: item.screenshotStorageId
          ? await ctx.storage.getUrl(item.screenshotStorageId).catch(() => null)
          : null,
      })),
    );

    return {
      feedback: withScreenshotUrls,
      nextCursor: page.length === limit ? page[page.length - 1]?._id : undefined,
      totalCount: items.length,
    };
  },
});

export const getFeedbackStats = query({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);

    const items = await ctx.db.query("feedback").collect();

    const byStatus: Record<"new" | "in_progress" | "shipped", number> = {
      new: 0,
      in_progress: 0,
      shipped: 0,
    };

    const byCategory: Record<"bug" | "confusing" | "feature" | "safety", number> = {
      bug: 0,
      confusing: 0,
      feature: 0,
      safety: 0,
    };

    for (const item of items) {
      byStatus[item.status] += 1;
      byCategory[item.category] += 1;
    }

    return {
      total: items.length,
      byStatus,
      byCategory,
    };
  },
});

export const updateFeedbackStatus = mutation({
  args: {
    actorClerkId: v.string(),
    feedbackId: v.id("feedback"),
    status: vFeedbackStatus,
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);

    const feedback = await ctx.db.get(args.feedbackId);
    if (!feedback) throw new Error("Feedback not found");

    await ctx.db.patch(args.feedbackId, {
      status: args.status,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const replyToFeedback = mutation({
  args: {
    actorClerkId: v.string(),
    feedbackId: v.id("feedback"),
    adminReply: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);

    const feedback = await ctx.db.get(args.feedbackId);
    if (!feedback) throw new Error("Feedback not found");

    await ctx.db.patch(args.feedbackId, {
      adminReply: args.adminReply.trim(),
      status: feedback.status === "new" ? "in_progress" : feedback.status,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});
