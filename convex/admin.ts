import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";

export const getOrgSettings = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const org = await ctx.db.get(actor.orgId);
    const logoUrl =
      org?.logoStorageId
        ? await ctx.storage.getUrl(org.logoStorageId).catch(() => null)
        : null;
    return {
      org: org
        ? {
            ...org,
            logoUrl: logoUrl ?? undefined,
            allowPaidModels: org.allowPaidModels ?? true,
            orchestratorV2Enabled: org.orchestratorV2Enabled ?? true,
            soulEnabled: org.soulEnabled ?? true,
            agentModelBoostEnabled: org.agentModelBoostEnabled ?? true,
            adaptiveQuizEnabled: org.adaptiveQuizEnabled ?? true,
            spacedRepetitionEnabled: org.spacedRepetitionEnabled ?? true,
          }
        : org,
      actorRole: actor.role,
    };
  },
});

export const updateOrgSettings = mutation({
  args: {
    actorClerkId: v.string(),
    verifyMarkerPassEnabled: v.optional(v.boolean()),
    tokenBudgetDaily: v.optional(v.number()),
    monthlyBudgetCentsPerUser: v.optional(v.number()),
    budgetMarginPercent: v.optional(v.number()),
    allowPaidModels: v.optional(v.boolean()),
    description: v.optional(v.string()),
    schoolType: v.optional(v.string()),
    timezone: v.optional(v.string()),
    maxStudents: v.optional(v.number()),
    orchestratorV2Enabled: v.optional(v.boolean()),
    soulEnabled: v.optional(v.boolean()),
    agentModelBoostEnabled: v.optional(v.boolean()),
    adaptiveQuizEnabled: v.optional(v.boolean()),
    spacedRepetitionEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor || actor.role !== "admin") {
      throw new Error("Only admin can update org settings");
    }

    const org = await ctx.db.get(actor.orgId);
    if (!org) {
      throw new Error("Org not found");
    }

    const safeBudget = args.tokenBudgetDaily !== undefined
      ? Math.max(1_000, Math.round(args.tokenBudgetDaily))
      : org.tokenBudgetDaily;
    const safeMonthlyBudget = args.monthlyBudgetCentsPerUser !== undefined
      ? Math.max(100, Math.round(args.monthlyBudgetCentsPerUser))
      : org.monthlyBudgetCentsPerUser;
    const safeMargin = args.budgetMarginPercent !== undefined
      ? Math.min(45, Math.max(5, Math.round(args.budgetMarginPercent)))
      : org.budgetMarginPercent;
    const safeMaxStudents = args.maxStudents !== undefined
      ? Math.max(1, Math.round(args.maxStudents))
      : org.maxStudents;

    await ctx.db.patch(actor.orgId, {
      verifyMarkerPassEnabled:
        args.verifyMarkerPassEnabled !== undefined ? args.verifyMarkerPassEnabled : org.verifyMarkerPassEnabled,
      tokenBudgetDaily: safeBudget,
      monthlyBudgetCentsPerUser: safeMonthlyBudget,
      budgetMarginPercent: safeMargin,
      allowPaidModels:
        args.allowPaidModels !== undefined
          ? args.allowPaidModels
          : (org.allowPaidModels ?? true),
      description: args.description !== undefined ? args.description : org.description,
      schoolType: args.schoolType !== undefined ? args.schoolType : org.schoolType,
      timezone: args.timezone !== undefined ? args.timezone : org.timezone,
      maxStudents: safeMaxStudents,
      orchestratorV2Enabled:
        args.orchestratorV2Enabled !== undefined
          ? args.orchestratorV2Enabled
          : (org.orchestratorV2Enabled ?? true),
      soulEnabled:
        args.soulEnabled !== undefined
          ? args.soulEnabled
          : (org.soulEnabled ?? true),
      agentModelBoostEnabled:
        args.agentModelBoostEnabled !== undefined
          ? args.agentModelBoostEnabled
          : (org.agentModelBoostEnabled ?? true),
      adaptiveQuizEnabled:
        args.adaptiveQuizEnabled !== undefined
          ? args.adaptiveQuizEnabled
          : (org.adaptiveQuizEnabled ?? true),
      spacedRepetitionEnabled:
        args.spacedRepetitionEnabled !== undefined
          ? args.spacedRepetitionEnabled
          : (org.spacedRepetitionEnabled ?? true),
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const updateOrgBranding = mutation({
  args: {
    actorClerkId: v.string(),
    primaryColor: v.optional(v.string()),
    accentColor: v.optional(v.string()),
    welcomeMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor || actor.role !== "admin") {
      throw new Error("Only admin can update org branding");
    }

    const org = await ctx.db.get(actor.orgId);
    if (!org) {
      throw new Error("Org not found");
    }

    await ctx.db.patch(actor.orgId, {
      primaryColor: args.primaryColor ?? org.primaryColor,
      accentColor: args.accentColor ?? org.accentColor,
      welcomeMessage: args.welcomeMessage ?? org.welcomeMessage,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const createOrgLogoUploadUrl = mutation({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor || actor.role !== "admin") {
      throw new Error("Only admin can upload org logo");
    }
    return ctx.storage.generateUploadUrl();
  },
});

export const setOrgLogoStorageId = mutation({
  args: {
    actorClerkId: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor || actor.role !== "admin") {
      throw new Error("Only admin can upload org logo");
    }

    const org = await ctx.db.get(actor.orgId);
    if (!org) {
      throw new Error("Org not found");
    }

    if (org.logoStorageId && org.logoStorageId !== args.storageId) {
      await ctx.storage.delete(org.logoStorageId).catch(() => {});
    }

    await ctx.db.patch(actor.orgId, {
      logoStorageId: args.storageId,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const usageOverview = query({
  args: {
    actorClerkId: v.string(),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor || actor.role !== "admin") {
      throw new Error("Only admin can view usage overview");
    }

    const lookback = Math.min(Math.max(args.days ?? 7, 1), 30);
    const rows = await ctx.db
      .query("usageDaily")
      .withIndex("by_org_day", (q) => q.eq("orgId", actor.orgId))
      .collect();

    return rows
      .sort((a, b) => (a.day < b.day ? 1 : -1))
      .slice(0, lookback)
      .reverse();
  },
});
