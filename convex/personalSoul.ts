import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";

/**
 * Get the current user's soul preferences for their org, or null if not set
 */
export const getPreferences = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const prefs = await ctx.db
      .query("userSoulPreferences")
      .withIndex("by_user", (q) => q.eq("userId", actor._id))
      .collect();

    // Return the preference row for the current org, if any
    return prefs.find((p) => p.orgId === actor.orgId) ?? null;
  },
});

/**
 * Upsert (create or update) the user's soul preferences
 */
export const savePreferences = mutation({
  args: {
    actorClerkId: v.string(),
    learningStyle: v.optional(v.string()),
    preferredDifficulty: v.optional(v.string()),
    interests: v.optional(v.array(v.string())),
    weakAreas: v.optional(v.array(v.string())),
    preferredModes: v.optional(v.array(v.string())),
    communicationStyle: v.optional(v.string()),
    customGuidance: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const { actorClerkId: _id, ...fields } = args;
    const now = Date.now();

    const existing = await ctx.db
      .query("userSoulPreferences")
      .withIndex("by_user", (q) => q.eq("userId", actor._id))
      .collect()
      .then((rows) => rows.find((r) => r.orgId === actor.orgId));

    if (existing) {
      const patch: Record<string, unknown> = { updatedAt: now };
      if (fields.learningStyle !== undefined) patch.learningStyle = fields.learningStyle;
      if (fields.preferredDifficulty !== undefined) patch.preferredDifficulty = fields.preferredDifficulty;
      if (fields.interests !== undefined) patch.interests = fields.interests;
      if (fields.weakAreas !== undefined) patch.weakAreas = fields.weakAreas;
      if (fields.preferredModes !== undefined) patch.preferredModes = fields.preferredModes;
      if (fields.communicationStyle !== undefined) patch.communicationStyle = fields.communicationStyle;
      if (fields.customGuidance !== undefined) patch.customGuidance = fields.customGuidance;

      await ctx.db.patch(existing._id, patch);
      return { prefsId: existing._id, updated: true };
    }

    const prefsId = await ctx.db.insert("userSoulPreferences", {
      userId: actor._id,
      orgId: actor.orgId,
      learningStyle: fields.learningStyle,
      preferredDifficulty: fields.preferredDifficulty,
      interests: fields.interests,
      weakAreas: fields.weakAreas,
      preferredModes: fields.preferredModes,
      communicationStyle: fields.communicationStyle,
      customGuidance: fields.customGuidance,
      onboardingComplete: false,
      createdAt: now,
      updatedAt: now,
    });

    return { prefsId, created: true };
  },
});

/**
 * Mark onboarding as complete on both the user record and the preferences record
 */
export const completeOnboarding = mutation({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const now = Date.now();

    // Mark on user record
    await ctx.db.patch(actor._id, {
      onboardingComplete: true,
      updatedAt: now,
    });

    // Mark on preferences record (upsert)
    const existing = await ctx.db
      .query("userSoulPreferences")
      .withIndex("by_user", (q) => q.eq("userId", actor._id))
      .collect()
      .then((rows) => rows.find((r) => r.orgId === actor.orgId));

    if (existing) {
      await ctx.db.patch(existing._id, {
        onboardingComplete: true,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("userSoulPreferences", {
        userId: actor._id,
        orgId: actor.orgId,
        onboardingComplete: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { ok: true };
  },
});
