import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { LIMITS, MODEL_DEFAULTS } from "./constants";
import { getUserByClerkId } from "./helpers";

export const listPacks = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    return ctx.db
      .query("packs")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();
  },
});

export const getPack = query({
  args: {
    actorClerkId: v.string(),
    packId: v.id("packs"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const pack = await ctx.db.get(args.packId);
    if (!pack || pack.orgId !== actor.orgId) {
      throw new Error("Pack not found");
    }

    const resources = await ctx.db
      .query("resources")
      .withIndex("by_pack", (q) => q.eq("packId", args.packId))
      .collect();

    return { pack, resources };
  },
});

export const createPack = mutation({
  args: {
    actorClerkId: v.string(),
    name: v.string(),
    subject: v.string(),
    academicYear: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor || (actor.role !== "teacher" && actor.role !== "admin")) {
      throw new Error("Only teachers/admin can create packs");
    }

    const now = Date.now();
    const packId = await ctx.db.insert("packs", {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      name: args.name,
      subject: args.subject,
      academicYear: args.academicYear,
      strictness: "medium",
      defaultModel: MODEL_DEFAULTS.tutorFast,
      allowedModels: [
        MODEL_DEFAULTS.tutorFast,
        MODEL_DEFAULTS.tutorHigh,
        MODEL_DEFAULTS.marker,
        MODEL_DEFAULTS.multimodal,
        MODEL_DEFAULTS.openrouterAuto,
      ],
      guidelinesSummary:
        "Awaiting teacher resources. Upload files to generate topic map, rubric hints, and misconceptions.",
      guidelinesTopicMap: [],
      guidelinesRubricHints: [],
      guidelinesMisconceptions: [],
      createdAt: now,
      updatedAt: now,
    });

    return { packId };
  },
});

export const updatePackSettings = mutation({
  args: {
    actorClerkId: v.string(),
    packId: v.id("packs"),
    strictness: v.optional(v.union(v.literal("hard"), v.literal("medium"), v.literal("soft"))),
    allowedModels: v.optional(v.array(v.string())),
    defaultModel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const pack = await ctx.db.get(args.packId);
    if (!pack || pack.orgId !== actor.orgId) {
      throw new Error("Pack not found");
    }

    const canEdit = actor.role === "admin" || pack.ownerUserId === actor._id;
    if (!canEdit) {
      throw new Error("Only owner/admin can update pack policy");
    }

    const patch: {
      strictness?: "hard" | "medium" | "soft";
      allowedModels?: string[];
      defaultModel?: string;
      updatedAt: number;
    } = { updatedAt: Date.now() };

    if (args.strictness) {
      patch.strictness = args.strictness;
    }
    if (args.allowedModels) {
      patch.allowedModels = args.allowedModels;
    }
    if (args.defaultModel !== undefined) {
      patch.defaultModel = args.defaultModel;
    }

    await ctx.db.patch(args.packId, patch);
    return { ok: true };
  },
});

export const updatePackGuidelines = mutation({
  args: {
    actorClerkId: v.string(),
    packId: v.id("packs"),
    summary: v.string(),
    topicMap: v.array(v.string()),
    rubricHints: v.array(v.string()),
    misconceptions: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor || (actor.role !== "teacher" && actor.role !== "admin")) {
      throw new Error("Only teacher/admin can update guidelines");
    }

    const pack = await ctx.db.get(args.packId);
    if (!pack || pack.orgId !== actor.orgId) {
      throw new Error("Pack not found");
    }

    await ctx.db.patch(args.packId, {
      guidelinesSummary: args.summary,
      guidelinesTopicMap: args.topicMap,
      guidelinesRubricHints: args.rubricHints,
      guidelinesMisconceptions: args.misconceptions,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const countPackResources = query({
  args: {
    actorClerkId: v.string(),
    packId: v.id("packs"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const pack = await ctx.db.get(args.packId);
    if (!pack || pack.orgId !== actor.orgId) {
      throw new Error("Pack not found");
    }

    const resources = await ctx.db
      .query("resources")
      .withIndex("by_pack", (q) => q.eq("packId", args.packId))
      .collect();

    return { count: resources.length, limit: LIMITS.maxTeacherFilesPerPack };
  },
});
