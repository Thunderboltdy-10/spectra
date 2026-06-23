import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";
import { estimateUsageCostCents } from "../shared/spending";
import { vRole } from "./shared";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { purgeUserData } from "./userLifecycle";
import {
  addOrgToPlatformStats,
  addUserToPlatformStats,
  countPlatformStats,
  rebuildPlatformStatsAggregates,
  removeOrgFromPlatformStats,
  updateUserInPlatformStats,
} from "./platformStatsAggregates";
import { ensureStarterWorkspace, getCapacitySnapshot, requireCapacity } from "./accessControl";
import { isSuperAdminEmail } from "./constants";

const DEFAULT_MAX_RESOURCE_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MIN_RESOURCE_FILE_SIZE_BYTES = 1 * 1024 * 1024;
const MAX_RESOURCE_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const PLATFORM_STATS_SINGLETON = "global";

function randomToken(length = 48) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let token = "";
  for (let i = 0; i < length; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

function normalizeMaxResourceFileSizeBytes(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESOURCE_FILE_SIZE_BYTES;
  }
  return Math.min(
    MAX_RESOURCE_FILE_SIZE_BYTES,
    Math.max(MIN_RESOURCE_FILE_SIZE_BYTES, Math.round(value)),
  );
}

async function getOrgMemberCapacity(
  ctx: Parameters<typeof getUserByClerkId>[0],
  orgId: Id<"orgs">,
) {
  const capacity = await getCapacitySnapshot(ctx, orgId);
  return { maxMembers: capacity.maxMembers, memberCount: capacity.memberCount, used: capacity.used };
}

async function computePlatformStats(ctx: QueryCtx | MutationCtx) {
  return countPlatformStats(ctx);
}

async function ensureOrgHasCapacityForMember(
  ctx: Parameters<typeof getUserByClerkId>[0],
  orgId: Id<"orgs">,
  options?: { excludingUserId?: Id<"users"> },
) {
  await requireCapacity(ctx, orgId, { excludeMemberId: options?.excludingUserId });
}

async function requireSuperAdmin(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  if (!isSuperAdminEmail(actor.email)) {
    throw new Error("Super admin access required");
  }
  return actor;
}

/**
 * List all orgs with member counts
 */
export const listAllOrgs = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);

    const orgs = await ctx.db.query("orgs").collect();

    const orgsWithCounts = await Promise.all(
      orgs.map(async (org) => {
        const members = await ctx.db
          .query("users")
          .withIndex("by_org", (q) => q.eq("orgId", org._id))
          .collect();
        const capacity = await getCapacitySnapshot(ctx, org._id);
        return {
          ...org,
          memberCount: members.length,
          capacity,
        };
      }),
    );

    return orgsWithCounts.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/**
 * Get full org data with members list
 */
export const getOrgDetail = query({
  args: {
    actorClerkId: v.string(),
    orgId: v.id("orgs"),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);

    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Org not found");

    const members = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    const logoUrl =
      org.logoStorageId
        ? await ctx.storage.getUrl(org.logoStorageId).catch(() => null)
        : null;

    const [invitations, accessRequests, capacity] = await Promise.all([
      ctx.db.query("schoolInvitations").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect(),
      ctx.db.query("accessRequests").withIndex("by_org_status", (q) => q.eq("orgId", args.orgId).eq("status", "pending")).collect(),
      getCapacitySnapshot(ctx, args.orgId),
    ]);
    return {
      org: { ...org, logoUrl: logoUrl ?? undefined },
      members,
      invitations,
      accessRequests,
      capacity,
    };
  },
});

export const getOrgUsageSummary = query({
  args: {
    actorClerkId: v.string(),
    orgId: v.id("orgs"),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);

    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Org not found");

    const days = Math.max(7, Math.min(args.days ?? 30, 180));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const [events, users] = await Promise.all([
      ctx.db
        .query("usageEvents")
        .withIndex("by_org_day", (q) => q.eq("orgId", args.orgId))
        .collect(),
      ctx.db
        .query("users")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .collect(),
    ]);

    const filtered = events.filter((event) => event.day >= cutoff);
    const totals = filtered.reduce(
      (acc, event) => {
        const tokens = Math.max(0, event.totalTokens ?? 0);
        const costCents = Math.max(0, event.costCents ?? 0);
        acc.events += 1;
        acc.tokens += tokens;
        acc.costCents += costCents;
        acc.models.add(event.model);
        acc.userIds.add(String(event.userId));
        return acc;
      },
      {
        events: 0,
        tokens: 0,
        costCents: 0,
        models: new Set<string>(),
        userIds: new Set<string>(),
      },
    );

    const byDay = new Map<string, { day: string; events: number; tokens: number; costCents: number }>();
    for (const event of filtered) {
      const bucket = byDay.get(event.day) ?? { day: event.day, events: 0, tokens: 0, costCents: 0 };
      bucket.events += 1;
      bucket.tokens += Math.max(0, event.totalTokens ?? 0);
      bucket.costCents += Math.max(0, event.costCents ?? 0);
      byDay.set(event.day, bucket);
    }

    return {
      orgId: args.orgId,
      orgName: org.name,
      days,
      memberCount: users.length,
      totals: {
        events: totals.events,
        totalTokens: totals.tokens,
        totalCostCents: totals.costCents,
        uniqueUsers: totals.userIds.size,
        uniqueModels: totals.models.size,
      },
      byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    };
  },
});

export const getOrgSoulOverview = query({
  args: {
    actorClerkId: v.string(),
    orgId: v.id("orgs"),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);

    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Org not found");

    const docs = await ctx.db
      .query("orgSoulDocs")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const publishedDocs = docs.filter((doc) => typeof doc.publishedAt === "number").length;
    const latestUpdatedAt = docs.reduce((latest, doc) => Math.max(latest, doc.updatedAt), 0);
    const latestPublishedAt = docs.reduce((latest, doc) => Math.max(latest, doc.publishedAt ?? 0), 0);

    return {
      orgId: args.orgId,
      orgName: org.name,
      flags: {
        soulEnabled: org.soulEnabled ?? true,
        adaptiveQuizEnabled: org.adaptiveQuizEnabled ?? true,
        spacedRepetitionEnabled: org.spacedRepetitionEnabled ?? true,
      },
      docs: {
        total: docs.length,
        published: publishedDocs,
        drafts: Math.max(0, docs.length - publishedDocs),
        latestUpdatedAt: latestUpdatedAt || null,
        latestPublishedAt: latestPublishedAt || null,
      },
      sections: Array.from(new Set(docs.map((doc) => doc.section).filter(Boolean))).sort(),
    };
  },
});

/**
 * Get global stats: total orgs, total users, total messages
 */
export const getGlobalStats = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);

    const cached = await ctx.db
      .query("platformStats")
      .withIndex("by_singleton", (q) => q.eq("singletonKey", PLATFORM_STATS_SINGLETON))
      .unique();
    if (cached) {
      return {
        totalOrgs: cached.totalOrgs,
        totalUsers: cached.totalUsers,
        totalMessages: cached.totalMessages,
        totalAdmins: cached.totalAdmins,
        lastComputedAt: cached.lastComputedAt,
      };
    }

    const live = await computePlatformStats(ctx);

    return {
      ...live,
      lastComputedAt: null,
    };
  },
});

export const refreshPlatformStats = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Always do a full rebuild so every refreshPlatformStats call produces
    // accurate aggregates across all namespaces. The zero-guard was removed
    // because it allowed permanently undercounted stats whenever only some
    // dimensions were zero.
    const next = await rebuildPlatformStatsAggregates(ctx);
    const existing = await ctx.db
      .query("platformStats")
      .withIndex("by_singleton", (q) => q.eq("singletonKey", PLATFORM_STATS_SINGLETON))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...next,
        lastComputedAt: now,
      });
    } else {
      await ctx.db.insert("platformStats", {
        singletonKey: PLATFORM_STATS_SINGLETON,
        ...next,
        lastComputedAt: now,
      });
    }

    return { ok: true, ...next, lastComputedAt: now };
  },
});

export const rebuildPlatformStats = mutation({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);
    const rebuilt = await rebuildPlatformStatsAggregates(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("platformStats")
      .withIndex("by_singleton", (q) => q.eq("singletonKey", PLATFORM_STATS_SINGLETON))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...rebuilt,
        lastComputedAt: now,
      });
    } else {
      await ctx.db.insert("platformStats", {
        singletonKey: PLATFORM_STATS_SINGLETON,
        ...rebuilt,
        lastComputedAt: now,
      });
    }
    return {
      ok: true,
      ...rebuilt,
      lastComputedAt: now,
    };
  },
});

function normalizeModelLabel(modelId: string) {
  return modelId
    .replace(/:free$/i, "")
    .replace(/[\s(_-]*\bfree\b[\s)_-]*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function weekStartFromDay(day: string) {
  const base = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return day;
  const weekday = base.getUTCDay() || 7;
  base.setUTCDate(base.getUTCDate() - weekday + 1);
  return base.toISOString().slice(0, 10);
}

export const getUsageOverview = query({
  args: {
    actorClerkId: v.string(),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);
    const days = Math.max(7, Math.min(args.days ?? 30, 180));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const [users, orgs, catalog] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("orgs").collect(),
      ctx.db.query("modelCatalog").collect(),
    ]);
    const filtered = [];
    for (const org of orgs) {
      const rows = await ctx.db
        .query("usageEvents")
        .withIndex("by_org_day", (q) => q.eq("orgId", org._id).gte("day", cutoff))
        .collect();
      filtered.push(...rows);
    }
    const pricingByOrgModel = new Map(
      catalog.map((row) => [
        `${String(row.orgId)}::${row.modelId}`,
        {
          inputCostPerM: row.inputCostPerM,
          outputCostPerM: row.outputCostPerM,
          isFree: row.isFree ?? false,
        },
      ]),
    );

    const totals = {
      events: 0,
      totalTokens: 0,
      totalCostCents: 0,
      effectiveCostCents: 0,
      estimatedCostCents: 0,
      unpricedEvents: 0,
    };
    const byDay = new Map<string, { day: string; events: number; totalTokens: number; totalCostCents: number; effectiveCostCents: number; userIds: Set<string> }>();
    const byWeek = new Map<string, { weekStart: string; events: number; totalTokens: number; totalCostCents: number; effectiveCostCents: number }>();
    const byModel = new Map<string, { modelId: string; events: number; totalTokens: number; totalCostCents: number; effectiveCostCents: number }>();
    const byUser = new Map<string, { userId: string; events: number; totalTokens: number; totalCostCents: number; effectiveCostCents: number; byModel: Map<string, number> }>();
    const byOrg = new Map<string, { orgId: string; events: number; totalTokens: number; totalCostCents: number; effectiveCostCents: number }>();

    for (const event of filtered) {
      const safeTokens = Math.max(0, event.totalTokens ?? 0);
      const safeCost = Math.max(0, event.costCents ?? 0);
      const pricing = pricingByOrgModel.get(`${String(event.orgId)}::${event.model}`);
      const estimatedCost = safeCost > 0
        ? 0
        : estimateUsageCostCents(event, pricing);
      const effectiveCost = safeCost > 0 ? safeCost : Math.max(0, estimatedCost);
      totals.events += 1;
      totals.totalTokens += safeTokens;
      totals.totalCostCents += safeCost;
      totals.effectiveCostCents += effectiveCost;
      if (safeCost === 0 && effectiveCost > 0) {
        totals.estimatedCostCents += effectiveCost;
      }
      if (safeCost === 0 && safeTokens > 0) {
        totals.unpricedEvents += 1;
      }

      const dayBucket = byDay.get(event.day) ?? {
        day: event.day,
        events: 0,
        totalTokens: 0,
        totalCostCents: 0,
        effectiveCostCents: 0,
        userIds: new Set<string>(),
      };
      dayBucket.events += 1;
      dayBucket.totalTokens += safeTokens;
      dayBucket.totalCostCents += safeCost;
      dayBucket.effectiveCostCents += effectiveCost;
      dayBucket.userIds.add(event.userId);
      byDay.set(event.day, dayBucket);

      const weekStart = weekStartFromDay(event.day);
      const weekBucket = byWeek.get(weekStart) ?? {
        weekStart,
        events: 0,
        totalTokens: 0,
        totalCostCents: 0,
        effectiveCostCents: 0,
      };
      weekBucket.events += 1;
      weekBucket.totalTokens += safeTokens;
      weekBucket.totalCostCents += safeCost;
      weekBucket.effectiveCostCents += effectiveCost;
      byWeek.set(weekStart, weekBucket);

      const modelBucket = byModel.get(event.model) ?? {
        modelId: event.model,
        events: 0,
        totalTokens: 0,
        totalCostCents: 0,
        effectiveCostCents: 0,
      };
      modelBucket.events += 1;
      modelBucket.totalTokens += safeTokens;
      modelBucket.totalCostCents += safeCost;
      modelBucket.effectiveCostCents += effectiveCost;
      byModel.set(event.model, modelBucket);

      const userBucket = byUser.get(event.userId) ?? {
        userId: event.userId,
        events: 0,
        totalTokens: 0,
        totalCostCents: 0,
        effectiveCostCents: 0,
        byModel: new Map<string, number>(),
      };
      userBucket.events += 1;
      userBucket.totalTokens += safeTokens;
      userBucket.totalCostCents += safeCost;
      userBucket.effectiveCostCents += effectiveCost;
      userBucket.byModel.set(event.model, (userBucket.byModel.get(event.model) ?? 0) + safeTokens);
      byUser.set(event.userId, userBucket);

      const orgBucket = byOrg.get(event.orgId) ?? {
        orgId: event.orgId,
        events: 0,
        totalTokens: 0,
        totalCostCents: 0,
        effectiveCostCents: 0,
      };
      orgBucket.events += 1;
      orgBucket.totalTokens += safeTokens;
      orgBucket.totalCostCents += safeCost;
      orgBucket.effectiveCostCents += effectiveCost;
      byOrg.set(event.orgId, orgBucket);
    }

    const userById = new Map(users.map((user) => [String(user._id), user]));
    const orgById = new Map(orgs.map((org) => [String(org._id), org]));

    return {
      days,
      totals,
      byDay: [...byDay.values()]
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((row) => ({
          day: row.day,
          events: row.events,
          totalTokens: row.totalTokens,
          totalCostCents: row.totalCostCents,
          effectiveCostCents: Number(row.effectiveCostCents.toFixed(6)),
          uniqueUsers: row.userIds.size,
        })),
      byWeek: [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
      topModels: [...byModel.values()]
        .sort((a, b) => b.totalTokens - a.totalTokens || b.effectiveCostCents - a.effectiveCostCents)
        .slice(0, 12)
        .map((model) => ({
          ...model,
          effectiveCostCents: Number(model.effectiveCostCents.toFixed(6)),
          modelLabel: normalizeModelLabel(model.modelId),
        })),
      topUsers: [...byUser.values()]
        .sort((a, b) => b.totalTokens - a.totalTokens || b.effectiveCostCents - a.effectiveCostCents)
        .slice(0, 15)
        .map((row) => {
          const user = userById.get(String(row.userId));
          return {
            userId: row.userId,
            name: user?.name ?? "Unknown user",
            email: user?.email ?? "unknown",
            role: user?.role ?? "student",
            orgName: user ? (orgById.get(String(user.orgId))?.name ?? "Unknown school") : "Unknown school",
            events: row.events,
            totalTokens: row.totalTokens,
            totalCostCents: row.totalCostCents,
            effectiveCostCents: Number(row.effectiveCostCents.toFixed(6)),
            topModels: [...row.byModel.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([modelId, tokens]) => ({
                modelId,
                modelLabel: normalizeModelLabel(modelId),
                tokens,
              })),
          };
        }),
      topOrgs: [...byOrg.values()]
        .sort((a, b) => b.totalTokens - a.totalTokens || b.effectiveCostCents - a.effectiveCostCents)
        .slice(0, 12)
        .map((row) => ({
          ...row,
          effectiveCostCents: Number(row.effectiveCostCents.toFixed(6)),
          orgName: orgById.get(String(row.orgId))?.name ?? "Unknown school",
        })),
    };
  },
});

/**
 * Get storage statistics across the platform.
 * Note: file size tracking comes from `resources.size` metadata.
 */
export const getStorageStats = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);

    const now = Date.now();
    const [resources, orgs, images] = await Promise.all([
      ctx.db.query("resources").collect(),
      ctx.db.query("orgs").collect(),
      ctx.db.query("generatedImages").collect(),
    ]);

    const orgNameById = new Map(orgs.map((org) => [org._id, org.name]));
    const totalSizeBytes = resources.reduce((sum, resource) => sum + Math.max(0, resource.size ?? 0), 0);

    const byOrg = new Map<
      string,
      { orgId: string; orgName: string; fileCount: number; totalSizeBytes: number }
    >();
    for (const resource of resources) {
      const current = byOrg.get(resource.orgId) ?? {
        orgId: resource.orgId,
        orgName: orgNameById.get(resource.orgId) ?? "Unknown school",
        fileCount: 0,
        totalSizeBytes: 0,
      };
      current.fileCount += 1;
      current.totalSizeBytes += Math.max(0, resource.size ?? 0);
      byOrg.set(resource.orgId, current);
    }

    const sizeByOrg = [...byOrg.values()]
      .sort((a, b) => b.totalSizeBytes - a.totalSizeBytes || b.fileCount - a.fileCount)
      .map((row) => ({
        ...row,
        totalSizeMegabytes: Math.round((row.totalSizeBytes / (1024 * 1024)) * 100) / 100,
      }));

    const largestFiles = resources
      .slice()
      .sort((a, b) => b.size - a.size || b.createdAt - a.createdAt)
      .slice(0, 25)
      .map((resource) => ({
        resourceId: resource._id,
        orgId: resource.orgId,
        orgName: orgNameById.get(resource.orgId) ?? "Unknown school",
        filename: resource.filename,
        scope: resource.scope,
        sizeBytes: resource.size,
        sizeMegabytes: Math.round((resource.size / (1024 * 1024)) * 100) / 100,
        createdAt: resource.createdAt,
      }));

    const pinnedImages = images.filter((image) => image.pinned).length;
    const expiringIn3Days = images.filter((image) => {
      if (image.pinned) return false;
      return typeof image.expiresAt === "number" && image.expiresAt < now + 3 * 24 * 60 * 60 * 1000;
    }).length;

    return {
      totalFiles: resources.length + images.length,
      resourceFileCount: resources.length,
      generatedImageCount: images.length,
      totalSizeBytes,
      totalSizeMegabytes: Math.round((totalSizeBytes / (1024 * 1024)) * 100) / 100,
      pinnedImageCount: pinnedImages,
      expiringImageCountIn3Days: expiringIn3Days,
      sizeByOrg,
      largestFiles,
    };
  },
});

export const resetPlatformData = mutation({
  args: {
    actorClerkId: v.string(),
    confirmation: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx, args.actorClerkId);
    const normalizedConfirmation = args.confirmation.trim().toUpperCase();
    if (normalizedConfirmation !== "RESET PLATFORM DATA") {
      throw new Error("Invalid confirmation phrase. Type RESET PLATFORM DATA to continue.");
    }

    const summary: Record<string, number> = {};
    const now = Date.now();

    const tablesToClear = [
      "packs",
      "chunks",
      "agents",
      "agentModelStats",
      "chats",
      "messages",
      "usageDaily",
      "usageEvents",
      "artifacts",
      "artifactVersions",
      "userSpending",
      "userMemory",
      "userMemoryEntries",
      "studentAnalytics",
      "weeklySummaries",
      "nudges",
      "achievements",
      "userStreaks",
      "studyTimers",
      "messageBookmarks",
      "chatBranches",
      "notifications",
      "conversationTemplates",
      "flashcardProgress",
      "quizResults",
      "quizSessions",
      "flashcardDecks",
      "auditLog",
      "modelRuntimeStats",
      "schoolInvitations",
      "accessRequests",
      "userSoulPreferences",
      "errorEvents",
    ] as const;
    type ClearableTable = (typeof tablesToClear)[number];

    const deleteRowsFromTable = async (tableName: ClearableTable) => {
      const rows = await ctx.db.query(tableName).collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
      summary[tableName] = rows.length;
      return rows.length;
    };

    const resources = await ctx.db.query("resources").collect();
    const resourceStorageIds = resources
      .map((resource) => resource.storageId)
      .filter((value): value is Id<"_storage"> => Boolean(value));
    for (const storageId of resourceStorageIds) {
      await ctx.storage.delete(storageId).catch(() => {});
    }
    for (const resource of resources) {
      await ctx.db.delete(resource._id);
    }
    summary.resources = resources.length;

    const generatedImages = await ctx.db.query("generatedImages").collect();
    const imageStorageIds = new Set<Id<"_storage">>();
    for (const image of generatedImages) {
      if (image.storageId) imageStorageIds.add(image.storageId);
      if (image.thumbnailStorageId) imageStorageIds.add(image.thumbnailStorageId);
    }
    for (const storageId of imageStorageIds) {
      await ctx.storage.delete(storageId).catch(() => {});
    }
    for (const image of generatedImages) {
      await ctx.db.delete(image._id);
    }
    summary.generatedImages = generatedImages.length;

    const feedbackRows = await ctx.db.query("feedback").collect();
    const feedbackStorageIds = feedbackRows
      .map((item) => item.screenshotStorageId)
      .filter((value): value is Id<"_storage"> => Boolean(value));
    for (const storageId of feedbackStorageIds) {
      await ctx.storage.delete(storageId).catch(() => {});
    }
    for (const item of feedbackRows) {
      await ctx.db.delete(item._id);
    }
    summary.feedback = feedbackRows.length;

    for (const tableName of tablesToClear) {
      await deleteRowsFromTable(tableName);
    }

    const users = await ctx.db.query("users").collect();
    for (const user of users) {
      await ctx.db.patch(user._id, {
        userStreakId: undefined,
        lastActiveAt: undefined,
        updatedAt: now,
      });
    }
    summary.userMetadataReset = users.length;

    const rebuiltStats = await rebuildPlatformStatsAggregates(ctx);
    summary.platformStatsRebuilt = 1;

    await ctx.runMutation(internal.auditLog.logAction, {
      actorUserId: actor._id as Id<"users">,
      action: "super_admin.platform_reset",
      targetType: "platform",
      targetId: "global",
      details: JSON.stringify(summary),
    });

    return {
      ok: true,
      summary,
      platformStats: rebuiltStats,
      resetAt: now,
    };
  },
});

/**
 * List all admin users across schools.
 */
export const listAllAdmins = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);
    const [admins, orgs] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("orgs").collect(),
    ]);
    const orgById = new Map(orgs.map((org) => [org._id, org]));
    return admins
      .filter((user) => user.role === "admin")
      .map((admin) => ({
        ...admin,
        orgName: orgById.get(admin.orgId)?.name ?? "Unknown",
        orgSlug: orgById.get(admin.orgId)?.slug ?? "unknown",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Create a new school org
 */
export const createOrg = mutation({
  args: {
    actorClerkId: v.string(),
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    schoolType: v.optional(v.string()),
    country: v.optional(v.string()),
    timezone: v.optional(v.string()),
    maxStudents: v.optional(v.number()),
    tokenBudgetDaily: v.optional(v.number()),
    maxResourceFileSizeBytes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx, args.actorClerkId);

    const existing = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (existing) throw new Error(`Org with slug "${args.slug}" already exists`);

    const normalizedMaxMembers =
      typeof args.maxStudents === "number" && Number.isFinite(args.maxStudents) && args.maxStudents > 0
        ? Math.max(1, Math.floor(args.maxStudents))
        : undefined;

    const now = Date.now();
    const orgId = await ctx.db.insert("orgs", {
      name: args.name,
      slug: args.slug,
      description: args.description,
      schoolType: args.schoolType,
      country: args.country,
      timezone: args.timezone,
      maxStudents: normalizedMaxMembers,
      tokenBudgetDaily: args.tokenBudgetDaily ?? 500000,
      maxResourceFileSizeBytes: normalizeMaxResourceFileSizeBytes(args.maxResourceFileSizeBytes),
      verifyMarkerPassEnabled: false,
      orchestratorV2Enabled: true,
      soulEnabled: true,
      agentModelBoostEnabled: true,
      adaptiveQuizEnabled: true,
      spacedRepetitionEnabled: true,
      isActive: true,
      createdBy: actor.email,
      createdAt: now,
      updatedAt: now,
    });
    await addOrgToPlatformStats(ctx, orgId);

    const superAdminMembershipId = await ctx.db.insert("users", {
      clerkId: actor.clerkId,
      email: actor.email.trim().toLowerCase(),
      name: actor.name,
      role: "admin",
      orgId,
      createdAt: now,
      updatedAt: now,
    });
    await addUserToPlatformStats(ctx, { _id: superAdminMembershipId, role: "admin" });
    await ensureStarterWorkspace(ctx, superAdminMembershipId, orgId);

    await ctx.runMutation(internal.auditLog.logAction, {
      actorUserId: actor._id as Id<"users">,
      action: "super_admin.create_org",
      targetType: "org",
      targetId: orgId,
      details: `name=${args.name};slug=${args.slug}`,
    });

    return { orgId };
  },
});

/**
 * Update school settings
 */
export const updateOrg = mutation({
  args: {
    actorClerkId: v.string(),
    orgId: v.id("orgs"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    schoolType: v.optional(v.string()),
    country: v.optional(v.string()),
    timezone: v.optional(v.string()),
    maxStudents: v.optional(v.number()),
    tokenBudgetDaily: v.optional(v.number()),
    maxResourceFileSizeBytes: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    allowPaidModels: v.optional(v.boolean()),
    soulEnabled: v.optional(v.boolean()),
    adaptiveQuizEnabled: v.optional(v.boolean()),
    spacedRepetitionEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx, args.actorClerkId);

    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Org not found");

    const updates = Object.fromEntries(
      Object.entries(args).filter(
        ([key, value]) => key !== "actorClerkId" && key !== "orgId" && value !== undefined,
      ),
    );

    if ("maxResourceFileSizeBytes" in updates) {
      updates.maxResourceFileSizeBytes = normalizeMaxResourceFileSizeBytes(
        typeof updates.maxResourceFileSizeBytes === "number"
          ? updates.maxResourceFileSizeBytes
          : undefined,
      );
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        patch[key] = value;
      }
    }

    const requestedMaxMembers =
      typeof updates.maxStudents === "number" && Number.isFinite(updates.maxStudents)
        ? Math.max(1, Math.floor(updates.maxStudents))
        : undefined;

    if (typeof requestedMaxMembers === "number") {
      const capacity = await getOrgMemberCapacity(ctx, args.orgId);
      if (
        requestedMaxMembers < capacity.used
      ) {
        throw new Error(`Member allocation cannot be below used/reserved seats (${capacity.used}).`);
      }
      patch.maxStudents = requestedMaxMembers;
    }

    await ctx.db.patch(args.orgId, patch);
    await ctx.runMutation(internal.auditLog.logAction, {
      actorUserId: actor._id as Id<"users">,
      action: "super_admin.update_org",
      targetType: "org",
      targetId: args.orgId,
      details: `fields=${Object.keys(updates).join(",") || "none"}`,
    });
    return { ok: true };
  },
});

export const updateOrgBudget = mutation({
  args: {
    actorClerkId: v.string(),
    orgId: v.id("orgs"),
    monthlyBudgetCentsPerUser: v.number(),
    budgetMarginPercent: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx, args.actorClerkId);

    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Org not found");

    const monthlyBudgetCentsPerUser = Math.max(100, Math.round(args.monthlyBudgetCentsPerUser));
    const budgetMarginPercent = Math.min(40, Math.max(5, Math.round(args.budgetMarginPercent)));
    const softLimitCents = Math.max(0, Math.floor(monthlyBudgetCentsPerUser * (1 - budgetMarginPercent / 100)));
    const cheapOnlyLimitCents = Math.max(0, Math.floor(monthlyBudgetCentsPerUser * 0.9));
    const now = Date.now();

    await ctx.db.patch(args.orgId, {
      monthlyBudgetCentsPerUser,
      budgetMarginPercent,
      updatedAt: now,
    });

    await ctx.runMutation(internal.auditLog.logAction, {
      actorUserId: actor._id as Id<"users">,
      action: "super_admin.update_org_budget",
      targetType: "org",
      targetId: args.orgId,
      details: `monthlyBudgetCentsPerUser=${monthlyBudgetCentsPerUser};budgetMarginPercent=${budgetMarginPercent};softLimitCents=${softLimitCents};cheapOnlyLimitCents=${cheapOnlyLimitCents}`,
    });

    return {
      ok: true,
      monthlyBudgetCentsPerUser,
      budgetMarginPercent,
      softLimitCents,
      cheapOnlyLimitCents,
      hardLimitCents: monthlyBudgetCentsPerUser,
    };
  },
});

/**
 * Deactivate an org (sets isActive to false)
 */

export const deleteOrg = mutation({
  args: {
    actorClerkId: v.string(),
    orgId: v.id("orgs"),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx, args.actorClerkId);

    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Org not found");

    const users = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    if (users.length > 0) {
      throw new Error("Cannot delete a school that still has members. Remove members first.");
    }

    const now = Date.now();

    const invitationBatches = await Promise.all([
      ctx.db.query("schoolInvitations").withIndex("by_org_status", (q) => q.eq("orgId", args.orgId).eq("status", "pending")).collect(),
      ctx.db.query("schoolInvitations").withIndex("by_org_status", (q) => q.eq("orgId", args.orgId).eq("status", "accepted")).collect(),
      ctx.db.query("schoolInvitations").withIndex("by_org_status", (q) => q.eq("orgId", args.orgId).eq("status", "expired")).collect(),
    ]);
    for (const invitation of invitationBatches.flat()) {
      await ctx.db.delete(invitation._id);
    }

    const accessRequestBatches = await Promise.all([
      ctx.db.query("accessRequests").withIndex("by_org_status", (q) => q.eq("orgId", args.orgId).eq("status", "pending")).collect(),
      ctx.db.query("accessRequests").withIndex("by_org_status", (q) => q.eq("orgId", args.orgId).eq("status", "invited")).collect(),
      ctx.db.query("accessRequests").withIndex("by_org_status", (q) => q.eq("orgId", args.orgId).eq("status", "rejected")).collect(),
    ]);
    for (const request of accessRequestBatches.flat()) {
      await ctx.db.delete(request._id);
    }

    const packs = await ctx.db.query("packs").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect();
    for (const pack of packs) {
      await ctx.db.delete(pack._id);
    }

    const resources = await ctx.db.query("resources").withIndex("by_org_updated", (q) => q.eq("orgId", args.orgId)).collect();
    for (const resource of resources) {
      if (resource.storageId) {
        await ctx.storage.delete(resource.storageId).catch(() => {});
      }
      await ctx.db.delete(resource._id);
    }

    const agents = await ctx.db.query("agents").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect();
    for (const agent of agents) {
      await ctx.db.delete(agent._id);
    }

    const orgSoulDocs = await ctx.db.query("orgSoulDocs").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect();
    for (const doc of orgSoulDocs) {
      await ctx.db.delete(doc._id);
    }

    const usageDailyRows = await ctx.db.query("usageDaily").withIndex("by_org_day", (q) => q.eq("orgId", args.orgId)).collect();
    for (const row of usageDailyRows) {
      await ctx.db.delete(row._id);
    }

    const usageEvents = await ctx.db.query("usageEvents").withIndex("by_org_day", (q) => q.eq("orgId", args.orgId)).collect();
    for (const event of usageEvents) {
      await ctx.db.delete(event._id);
    }

    const modelCatalogRows = await ctx.db.query("modelCatalog").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect();
    for (const row of modelCatalogRows) {
      await ctx.db.delete(row._id);
    }

    const modelRuntimeStatsRows = await ctx.db.query("modelRuntimeStats").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect();
    for (const row of modelRuntimeStatsRows) {
      await ctx.db.delete(row._id);
    }

    const studentAnalyticsRows = await ctx.db.query("studentAnalytics").withIndex("by_org_day", (q) => q.eq("orgId", args.orgId)).collect();
    for (const row of studentAnalyticsRows) {
      await ctx.db.delete(row._id);
    }

    const weeklySummariesRows = await ctx.db.query("weeklySummaries").withIndex("by_org_week", (q) => q.eq("orgId", args.orgId)).collect();
    for (const row of weeklySummariesRows) {
      await ctx.db.delete(row._id);
    }

    const nudgesRows = await ctx.db.query("nudges").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect();
    for (const row of nudgesRows) {
      await ctx.db.delete(row._id);
    }

    const userSoulPreferencesRows = await ctx.db.query("userSoulPreferences").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect();
    for (const row of userSoulPreferencesRows) {
      await ctx.db.delete(row._id);
    }

    const workstreamsRows = await ctx.db.query("workstreams").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect();
    for (const row of workstreamsRows) {
      await ctx.db.delete(row._id);
    }

    if (org.logoStorageId) {
      await ctx.storage.delete(org.logoStorageId).catch(() => {});
    }

    await ctx.db.delete(args.orgId);
    await removeOrgFromPlatformStats(ctx, args.orgId);

    await ctx.runMutation(internal.auditLog.logAction, {
      actorUserId: actor._id as Id<"users">,
      action: "super_admin.delete_org",
      targetType: "org",
      targetId: args.orgId,
      details: `name=${org.name};slug=${org.slug};deletedAt=${now}`,
    });

    return { ok: true };
  },
});

export const deactivateOrg = mutation({
  args: {
    actorClerkId: v.string(),
    orgId: v.id("orgs"),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx, args.actorClerkId);

    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Org not found");

    await ctx.db.patch(args.orgId, {
      isActive: false,
      updatedAt: Date.now(),
    });

    await ctx.runMutation(internal.auditLog.logAction, {
      actorUserId: actor._id as Id<"users">,
      action: "super_admin.deactivate_org",
      targetType: "org",
      targetId: args.orgId,
      details: "isActive=false",
    });

    return { ok: true };
  },
});

/**
 * Find or create a user and assign them as admin of a given org
 */
export const assignOrgAdmin = mutation({
  args: {
    actorClerkId: v.string(),
    orgId: v.id("orgs"),
    email: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx, args.actorClerkId);

    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Org not found");
    const normalizedEmail = args.email.trim().toLowerCase();

    // Try to find existing user by email in this org
    const allUsers = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const existingInOrg = allUsers.find((u) => u.email.toLowerCase() === normalizedEmail);

    if (existingInOrg) {
      const previous = { _id: existingInOrg._id, role: existingInOrg.role };
      await ctx.db.patch(existingInOrg._id, {
        role: "admin",
        updatedAt: Date.now(),
      });
      await updateUserInPlatformStats(
        ctx,
        previous,
        { _id: existingInOrg._id, role: "admin" },
      );
      await ctx.runMutation(internal.auditLog.logAction, {
        actorUserId: actor._id as Id<"users">,
        action: "super_admin.assign_org_admin",
        targetType: "user",
        targetId: existingInOrg._id,
        details: `orgId=${args.orgId};email=${normalizedEmail};path=existing_in_org`,
      });
      return { userId: existingInOrg._id, updated: true };
    }

    // Try to find existing user in any org
    const allOrgUsers = await ctx.db.query("users").collect();
    const existingAnywhere = allOrgUsers.find((u) => u.email.toLowerCase() === normalizedEmail);

    if (existingAnywhere) throw new Error("ALREADY_IN_ANOTHER_SCHOOL: This user belongs to another school and cannot be moved implicitly.");

    const now = Date.now();
    const existingInvitation = await ctx.db
      .query("schoolInvitations")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .collect();
    
    const pendingForOrg = existingInvitation.find(
      (inv) => inv.orgId === args.orgId && inv.status === "pending" && inv.expiresAt > now
    );
    
    if (pendingForOrg) {
      const ensuredToken = pendingForOrg.token || randomToken();
      await ctx.db.patch(pendingForOrg._id, {
        role: "admin",
        token: ensuredToken,
        expiresAt: now + 7 * 24 * 60 * 60 * 1000,
      });
      const refreshedInvitation = await ctx.db.get(pendingForOrg._id);
      await ctx.runMutation(internal.auditLog.logAction, {
        actorUserId: actor._id as Id<"users">,
        action: "super_admin.assign_org_admin",
        targetType: "invitation",
        targetId: pendingForOrg._id,
        details: `orgId=${args.orgId};email=${normalizedEmail};path=update_pending_invitation`,
      });
      return {
        invitationId: pendingForOrg._id,
        invitationUpdated: true,
        token: refreshedInvitation?.token ?? ensuredToken,
      };
    }

    for (const inv of existingInvitation) {
      if (inv.orgId === args.orgId && inv.status === "pending") {
        await ctx.db.patch(inv._id, { status: "expired" });
      }
    }

    const token = randomToken();
    await requireCapacity(ctx, args.orgId);

    const invitationId = await ctx.db.insert("schoolInvitations", {
      orgId: args.orgId,
      email: normalizedEmail,
      role: "admin",
      invitedBy: actor._id as Id<"users">,
      status: "pending",
      token,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    });

    await ctx.runMutation(internal.auditLog.logAction, {
      actorUserId: actor._id as Id<"users">,
      action: "super_admin.assign_org_admin",
      targetType: "invitation",
      targetId: invitationId,
      details: `orgId=${args.orgId};email=${normalizedEmail};path=create_invitation`,
    });

    return { invitationId, invitationCreated: true, token };
  },
});

export const revokeOrgInvitation = mutation({
  args: { actorClerkId: v.string(), orgId: v.id("orgs"), invitationId: v.id("schoolInvitations") },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation || invitation.orgId !== args.orgId) throw new Error("Invitation not found");
    if (invitation.status === "revoked") return { ok: true };
    if (invitation.status !== "pending") throw new Error("Only pending invitations can be revoked");
    const now = Date.now();
    await ctx.db.patch(invitation._id, { status: "revoked", revokedAt: now, updatedAt: now });
    return { ok: true };
  },
});

/**
 * Super admin can update any member role within a school.
 */
export const updateOrgMemberRole = mutation({
  args: {
    actorClerkId: v.string(),
    orgId: v.id("orgs"),
    userId: v.id("users"),
    role: vRole,
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx, args.actorClerkId);
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    if (user.orgId !== args.orgId) throw new Error("User is not in this school");
    const capacity = await getOrgMemberCapacity(ctx, args.orgId);
    if (
      typeof capacity.maxMembers === "number"
      && capacity.memberCount > capacity.maxMembers
    ) {
      throw new Error("School member allocation is currently exceeded; resolve allocation before role updates.");
    }

    if (user.role === "admin" && args.role !== "admin") {
      const admins = await ctx.db
        .query("users")
        .withIndex("by_org_role", (q) => q.eq("orgId", args.orgId).eq("role", "admin"))
        .collect();
      if (admins.length <= 1) {
        throw new Error("School must keep at least one admin");
      }
    }

    await ctx.db.patch(args.userId, {
      role: args.role,
      updatedAt: Date.now(),
    });
    await updateUserInPlatformStats(
      ctx,
      { _id: user._id, role: user.role },
      { _id: user._id, role: args.role },
    );
    await ctx.runMutation(internal.auditLog.logAction, {
      actorUserId: actor._id as Id<"users">,
      action: "super_admin.update_org_member_role",
      targetType: "user",
      targetId: args.userId,
      details: `orgId=${args.orgId};from=${user.role};to=${args.role}`,
    });
    return { ok: true };
  },
});

/**
 * Super admin can remove members from a school.
 */
export const removeOrgMember = mutation({
  args: {
    actorClerkId: v.string(),
    orgId: v.id("orgs"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx, args.actorClerkId);
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    if (user.orgId !== args.orgId) throw new Error("User is not in this school");

    if (user.role === "admin") {
      const admins = await ctx.db
        .query("users")
        .withIndex("by_org_role", (q) => q.eq("orgId", args.orgId).eq("role", "admin"))
        .collect();
      if (admins.length <= 1) {
        throw new Error("School must keep at least one admin");
      }
    }

    const replacementOwner =
      actor.orgId === args.orgId
        ? actor
        : (
            await ctx.db
              .query("users")
              .withIndex("by_org_role", (q) => q.eq("orgId", args.orgId).eq("role", "admin"))
              .collect()
          ).find((candidate) => candidate._id !== user._id)
          ?? (
            await ctx.db
              .query("users")
              .withIndex("by_org_role", (q) => q.eq("orgId", args.orgId).eq("role", "teacher"))
              .collect()
          ).find((candidate) => candidate._id !== user._id)
          ?? null;

    const purgeSummary = await purgeUserData(ctx, {
      actor,
      target: user,
      replacementOwner,
    });
    await ctx.runMutation(internal.auditLog.logAction, {
      actorUserId: actor._id as Id<"users">,
      action: "super_admin.remove_org_member",
      targetType: "user",
      targetId: args.userId,
      details: JSON.stringify({
        orgId: args.orgId,
        role: user.role,
        email: user.email,
        purgeSummary,
      }),
    });
    return { ok: true };
  },
});

/**
 * Move a user from one org to another
 */
export const transferUser = mutation({
  args: {
    actorClerkId: v.string(),
    userId: v.id("users"),
    targetOrgId: v.id("orgs"),
    role: v.optional(vRole),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx, args.actorClerkId);

    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    const targetOrg = await ctx.db.get(args.targetOrgId);
    if (!targetOrg) throw new Error("Target org not found");

    if (user.orgId !== args.targetOrgId) {
      await ensureOrgHasCapacityForMember(ctx, args.targetOrgId);
      if (user.role === "admin") {
        const sourceAdmins = await ctx.db
          .query("users")
          .withIndex("by_org_role", (q) => q.eq("orgId", user.orgId).eq("role", "admin"))
          .collect();
        if (sourceAdmins.length <= 1) {
          throw new Error("Source school must keep at least one admin");
        }
      }
    }

    const nextRole = args.role ?? user.role;
    await ctx.db.patch(args.userId, {
      orgId: args.targetOrgId,
      role: nextRole,
      updatedAt: Date.now(),
    });
    await updateUserInPlatformStats(
      ctx,
      { _id: user._id, role: user.role },
      { _id: user._id, role: nextRole },
    );

    await ctx.runMutation(internal.auditLog.logAction, {
      actorUserId: actor._id as Id<"users">,
      action: "super_admin.transfer_user",
      targetType: "user",
      targetId: args.userId,
      details: `fromOrgId=${user.orgId};toOrgId=${args.targetOrgId};role=${args.role ?? user.role}`,
    });

    return { ok: true, fromOrgId: user.orgId, toOrgId: args.targetOrgId };
  },
});

/**
 * List members of any org (super admin only)
 */
export const listOrgMembers = query({
  args: {
    actorClerkId: v.string(),
    orgId: v.id("orgs"),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);

    const members = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    return {
      members: members.map((m) => ({
        _id: m._id,
        name: m.name ?? "",
        email: m.email,
        role: m.role,
        createdAt: m.createdAt,
      })),
    };
  },
});

/**
 * Remove any member from any school (super admin only, no orgId required)
 */
export const removeAnyMember = mutation({
  args: {
    actorClerkId: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx, args.actorClerkId);

    const userId = args.userId;
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    if (user.role === "admin") {
      const admins = await ctx.db
        .query("users")
        .withIndex("by_org_role", (q) => q.eq("orgId", user.orgId).eq("role", "admin"))
        .collect();
      if (admins.length <= 1) {
        throw new Error("School must keep at least one admin");
      }
    }

    const replacementOwner = (
      await ctx.db
        .query("users")
        .withIndex("by_org_role", (q) => q.eq("orgId", user.orgId).eq("role", "admin"))
        .collect()
    ).find((candidate) => candidate._id !== user._id) ?? null;

    const purgeSummary = await purgeUserData(ctx, {
      actor,
      target: user,
      replacementOwner,
    });

    await ctx.runMutation(internal.auditLog.logAction, {
      actorUserId: actor._id as Id<"users">,
      action: "super_admin.remove_any_member",
      targetType: "user",
      targetId: userId,
      details: JSON.stringify({
        orgId: user.orgId,
        role: user.role,
        email: user.email,
        purgeSummary,
      }),
    });

    return { ok: true };
  },
});
