import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";

const SUPER_ADMIN_EMAILS = new Set(
  (process.env.SUPER_ADMIN_EMAILS ?? "pablo.martinez.dovale@gmail.com")
    .split(",")
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

export const logAction = internalMutation({
  args: {
    actorUserId: v.id("users"),
    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    details: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const createdAt = args.createdAt ?? Date.now();
    const logId = await ctx.db.insert("auditLog", {
      actorUserId: args.actorUserId,
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId,
      details: args.details,
      createdAt,
    });
    return { logId };
  },
});

export const listAuditLogs = query({
  args: {
    actorClerkId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);
    const limit = Math.min(200, Math.max(1, args.limit ?? 100));

    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_created")
      .collect();

    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },
});
