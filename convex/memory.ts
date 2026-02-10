import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";

const vMemoryEntry = v.object({
  key: v.string(),
  value: v.string(),
  confidence: v.number(),
  extractedAt: v.number(),
});

function flatten(entries: Array<{ key: string; value: string }>) {
  return entries.map((entry) => `- ${entry.key}: ${entry.value}`).join("\n");
}

export const getUserMemory = query({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const row = await ctx.db
      .query("userMemory")
      .withIndex("by_user", (q) => q.eq("userId", actor._id))
      .unique();

    if (!row) {
      return {
        rawMemoryText: "",
        entries: [],
        updatedAt: 0,
      };
    }

    return {
      rawMemoryText: row.rawMemoryText,
      entries: row.entries,
      updatedAt: row.updatedAt,
    };
  },
});

export const upsertUserMemory = mutation({
  args: {
    actorClerkId: v.string(),
    rawMemoryText: v.optional(v.string()),
    entries: v.array(vMemoryEntry),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("userMemory")
      .withIndex("by_user", (q) => q.eq("userId", actor._id))
      .unique();

    const rawMemoryText = args.rawMemoryText ?? flatten(args.entries);

    if (existing) {
      await ctx.db.patch(existing._id, {
        rawMemoryText,
        entries: args.entries,
        updatedAt: now,
      });
      return { ok: true, updatedAt: now };
    }

    await ctx.db.insert("userMemory", {
      userId: actor._id,
      orgId: actor.orgId,
      rawMemoryText,
      entries: args.entries,
      updatedAt: now,
    });

    return { ok: true, updatedAt: now };
  },
});
