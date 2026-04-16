import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { adjustWorkstreamArtifactCount, getUserByClerkId } from "./helpers";
import { internal } from "./_generated/api";
import { decryptManagebacToken } from "../shared/managebac-crypto";
import { fetchManagebacJson } from "../src/lib/managebac/client";
import { normalizeManagebacStudentProfile } from "../src/lib/managebac/normalizer";
import { prepareManagebacSyncPayload } from "../src/lib/managebac/sync";
import {
  mapAnnouncementsToCache,
  mapManagebacAssignmentToPlanner,
  mapManagebacCasToNote,
  mapManagebacCasToPlanner,
  mapManagebacClassToWorkstream,
  matchManagebacTimetableForClass,
  shouldCreateCasReflectionNote,
} from "../src/lib/managebac/mapper";
const SUPER_ADMIN_EMAILS = new Set(
  (process.env.SUPER_ADMIN_EMAILS ?? "pablo.martinez.dovale@gmail.com")
    .split(/[,\s;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

function requireAdmin(actor: Doc<"users"> | null) {
  if (!actor || (actor.role !== "admin" && !SUPER_ADMIN_EMAILS.has(actor.email.trim().toLowerCase()))) {
    throw new Error("Only admin can manage ManageBac integration");
  }
  return actor;
}

const MANAGEBAC_RESOLUTION_TTL_MS = 12 * 60 * 60 * 1000;
const MANAGEBAC_HYDRATION_TTL_MS = 15 * 60 * 1000;

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

async function getManagebacConfigForOrg(ctx: Parameters<typeof getUserByClerkId>[0], orgId: Id<"orgs">) {
  const org = await ctx.db.get(orgId);
  if (!org?.managebacConfig?.encryptedToken || !org.managebacConfig.baseUrl) {
    return null;
  }
  const token = await decryptManagebacToken(org.managebacConfig.encryptedToken);
  return {
    org,
    baseUrl: org.managebacConfig.baseUrl,
    token,
    availableEndpoints: org.managebacConfig.availableEndpoints ?? [],
    announcementsCache: org.managebacConfig.announcementsCache ?? [],
  };
}

export const getManagebacConfigFullInternal = internalQuery({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, args) => getManagebacConfigForOrg(ctx, args.orgId),
});

export const resolveManagebacUserLinkInternal = internalMutation({
  args: {
    actorId: v.id("users"),
    actorOrgId: v.id("orgs"),
    actorClerkId: v.string(),
    actorEmail: v.string(),
    managebacStudentId: v.optional(v.string()),
    managebacStudentName: v.optional(v.string()),
    managebacGradeLevel: v.optional(v.string()),
    resolutionStatus: v.union(v.literal("resolved"), v.literal("not_found"), v.literal("ambiguous"), v.literal("error")),
    resolutionError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return upsertManagebacUserLink(ctx, {
      actor: {
        _id: args.actorId,
        orgId: args.actorOrgId,
        clerkId: args.actorClerkId,
        email: args.actorEmail,
      } as Doc<"users">,
      managebacStudentId: args.managebacStudentId,
      managebacStudentName: args.managebacStudentName,
      managebacGradeLevel: args.managebacGradeLevel,
      resolutionStatus: args.resolutionStatus,
      resolutionError: args.resolutionError,
    });
  },
});

type ManagebacDbReaderCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;
type ManagebacDbWriterCtx = Pick<MutationCtx, "db">;

type ManagebacResolutionStatus =
  | "not_configured"
  | "not_found"
  | "ambiguous"
  | "resolved"
  | "error";

type ManagebacResolutionResult = {
  configured: boolean;
  available: boolean;
  resolutionStatus: ManagebacResolutionStatus;
  message?: string;
  announcements?: unknown[];
};

type ManagebacUserSnapshot = ManagebacResolutionResult & {
  student?: {
    id?: string;
    name?: string;
    gradeLevel?: string;
    email: string;
  };
  workstreams?: unknown[];
  plannerItems?: unknown[];
  artifacts?: unknown[];
  lastHydratedAt?: number;
  lastHydrationStatus?: "idle" | "success" | "error";
  lastHydrationError?: string;
};

async function upsertManagebacUserLink(ctx: ManagebacDbWriterCtx, args: {
  actor: Doc<"users">;
  managebacStudentId?: string;
  managebacStudentName?: string;
  managebacGradeLevel?: string;
  resolutionStatus: "resolved" | "not_found" | "ambiguous" | "error";
  resolutionError?: string;
  hydrated?: boolean;
  hydrationError?: string;
}) {
  const existing = await ctx.db
    .query("managebacUserLinks")
    .withIndex("by_user", (q) => q.eq("userId", args.actor._id))
    .unique();
  const now = Date.now();
  const patch = {
    orgId: args.actor.orgId,
    userId: args.actor._id,
    clerkId: args.actor.clerkId,
    email: normalizeEmail(args.actor.email),
    managebacStudentId: args.managebacStudentId,
    managebacStudentName: args.managebacStudentName,
    managebacGradeLevel: args.managebacGradeLevel,
    resolutionStatus: args.resolutionStatus,
    resolutionCheckedAt: now,
    resolutionError: args.resolutionError,
    lastHydratedAt: args.hydrated ? now : existing?.lastHydratedAt,
    lastHydrationStatus: args.hydrated ? (args.hydrationError ? "error" : "success") : (existing?.lastHydrationStatus ?? "idle"),
    lastHydrationError: args.hydrationError ?? existing?.lastHydrationError,
    updatedAt: now,
  } as const;
  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }
  return ctx.db.insert("managebacUserLinks", {
    ...patch,
    createdAt: now,
  });
}

function plainTextDoc(text: string) {
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return {
    type: "doc",
    content: (blocks.length > 0 ? blocks : [""]).map((block) => ({
      type: "paragraph",
      content: block ? [{ type: "text", text: block }] : undefined,
    })),
  };
}

type SyncSummary = {
  syncedStudents: number;
  workstreamsCreated: number;
  workstreamsUpdated: number;
  plannerCreated: number;
  plannerUpdated: number;
  artifactsCreated: number;
  artifactsUpdated: number;
  notesCreated: number;
  notesUpdated: number;
  conflicts: number;
  warnings: string[];
};

type ManagebacStudentMapping = {
  clerkId: string;
  managebacStudentId: string;
  email?: string;
};

async function getActor(ctx: QueryCtx | MutationCtx, actorClerkId: string) {
  return getUserByClerkId(ctx, actorClerkId);
}

async function resolveMappedUserFromOrg(
  ctx: { db: ManagebacDbReaderCtx["db"] },
  orgId: Id<"orgs">,
  mappingClerkId: string,
) {
  const directMatch = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", mappingClerkId))
    .unique();
  if (directMatch?.orgId === orgId) {
    return directMatch;
  }

  const legacyUserId = ctx.db.normalizeId("users", mappingClerkId);
  if (!legacyUserId) {
    return null;
  }
  const legacyUser = await ctx.db.get(legacyUserId);
  if (legacyUser?.orgId !== orgId) {
    return null;
  }
  return legacyUser;
}

async function normalizeStudentMappingsForOrg(
  ctx: { db: ManagebacDbReaderCtx["db"] },
  orgId: Id<"orgs">,
  mappings: ManagebacStudentMapping[] | undefined,
) {
  const normalizedByClerkId = new Map<string, ManagebacStudentMapping>();
  for (const mapping of mappings ?? []) {
    const managebacStudentId = mapping.managebacStudentId.trim();
    if (!managebacStudentId) continue;

    const resolvedUser = await resolveMappedUserFromOrg(ctx, orgId, mapping.clerkId);
    const clerkId = resolvedUser?.clerkId ?? mapping.clerkId.trim();
    if (!clerkId) continue;

    normalizedByClerkId.set(clerkId, {
      clerkId,
      managebacStudentId,
      email: mapping.email?.trim() || resolvedUser?.email || undefined,
    });
  }
  return Array.from(normalizedByClerkId.values());
}

export const getAdminConfig = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    const actor = requireAdmin(await getActor(ctx, args.actorClerkId));
    const org = await ctx.db.get(actor.orgId);
    const config = org?.managebacConfig;
    const studentMappings = await normalizeStudentMappingsForOrg(ctx, actor.orgId, config?.studentMappings);
    return {
      configured: Boolean(config?.encryptedToken),
      baseUrl: config?.baseUrl,
      tokenLastFour: config?.tokenLastFour,
      studentMappings,
      syncEnabled: config?.syncEnabled ?? false,
      syncFrequencyHours: config?.syncFrequencyHours ?? 24,
      availableEndpoints: config?.availableEndpoints ?? [],
      lastSyncAt: config?.lastSyncAt,
      lastSyncStatus: config?.lastSyncStatus ?? "idle",
      lastSyncError: config?.lastSyncError,
      lastSyncDetails: config?.lastSyncDetails,
      announcementsCache: config?.announcementsCache ?? [],
    };
  },
});

export const saveAdminConfig = mutation({
  args: {
    actorClerkId: v.string(),
    baseUrl: v.string(),
    encryptedToken: v.optional(v.string()),
    tokenLastFour: v.optional(v.string()),
    studentMappings: v.optional(v.array(v.object({
      clerkId: v.string(),
      managebacStudentId: v.string(),
      email: v.optional(v.string()),
    }))),
    syncEnabled: v.optional(v.boolean()),
    syncFrequencyHours: v.optional(v.number()),
    availableEndpoints: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const actor = requireAdmin(await getActor(ctx, args.actorClerkId));
    const org = await ctx.db.get(actor.orgId);
    if (!org) throw new Error("Org not found");
    const existing = org.managebacConfig;
    const studentMappings = await normalizeStudentMappingsForOrg(
      ctx,
      actor.orgId,
      args.studentMappings ?? existing?.studentMappings,
    );
    await ctx.db.patch(actor.orgId, {
      managebacConfig: {
        baseUrl: args.baseUrl,
        encryptedToken: args.encryptedToken ?? existing?.encryptedToken ?? "",
        tokenLastFour: args.tokenLastFour ?? existing?.tokenLastFour,
        studentMappings,
        syncEnabled: args.syncEnabled ?? existing?.syncEnabled ?? false,
        syncFrequencyHours: args.syncFrequencyHours ?? existing?.syncFrequencyHours ?? 24,
        availableEndpoints: args.availableEndpoints ?? existing?.availableEndpoints ?? [],
        announcementsCache: existing?.announcementsCache ?? [],
        lastSyncAt: existing?.lastSyncAt,
        lastSyncStatus: existing?.lastSyncStatus ?? "idle",
        lastSyncError: existing?.lastSyncError,
        lastSyncDetails: existing?.lastSyncDetails,
        updatedAt: Date.now(),
      },
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const getUserSnapshot = action({
  args: { actorClerkId: v.string(), forceRefresh: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<ManagebacUserSnapshot> => {
    const actor = await ctx.runQuery(internal.managebacSync.getSyncActor, { actorClerkId: args.actorClerkId });
    if (!actor) throw new Error("Unauthorized");

    const config = await ctx.runQuery(internal.managebacSync.getOrgManagebacConfigInternal, { orgId: actor.orgId });
    if (!config?.configured) {
      return {
        configured: false,
        available: false,
        resolutionStatus: "not_configured",
        message: "ManageBac is not configured for this school.",
      };
    }

    const existingLink = await ctx.runQuery(internal.managebacSync.getManagebacUserLinkInternal, { userId: actor._id });
    const now = Date.now();
    const shouldResolve = args.forceRefresh
      || !existingLink
      || now - existingLink.resolutionCheckedAt > MANAGEBAC_RESOLUTION_TTL_MS
      || existingLink.resolutionStatus === "error";
    const shouldHydrate = args.forceRefresh
      || !existingLink?.lastHydratedAt
      || now - existingLink.lastHydratedAt > MANAGEBAC_HYDRATION_TTL_MS
      || existingLink.lastHydrationStatus === "error";

    let resolved = existingLink;
    if (shouldResolve) {
      const resolution: ManagebacResolutionResult = await ctx.runAction(internal.managebacSync.resolveAndHydrateCurrentUserInternal, {
        actorClerkId: args.actorClerkId,
        hydrate: shouldHydrate,
      });
      if (!resolution.available) {
        return resolution;
      }
      resolved = await ctx.runQuery(internal.managebacSync.getManagebacUserLinkInternal, { userId: actor._id });
    } else if (shouldHydrate && resolved?.managebacStudentId) {
      const hydration: ManagebacResolutionResult = await ctx.runAction(internal.managebacSync.resolveAndHydrateCurrentUserInternal, {
        actorClerkId: args.actorClerkId,
        hydrate: true,
        skipResolution: true,
      });
      if (!hydration.available && hydration.resolutionStatus !== "resolved") {
        return hydration;
      }
      resolved = await ctx.runQuery(internal.managebacSync.getManagebacUserLinkInternal, { userId: actor._id });
    }

    const [workstreams, plannerItems, artifacts, org] = await Promise.all([
      ctx.runQuery(internal.managebacSync.getManagebacWorkstreamsInternal, { userId: actor._id }),
      ctx.runQuery(internal.managebacSync.getManagebacPlannerItemsInternal, { userId: actor._id }),
      ctx.runQuery(internal.managebacSync.getManagebacArtifactsInternal, { userId: actor._id }),
      ctx.runQuery(internal.managebacSync.getOrgManagebacConfigInternal, { orgId: actor.orgId }),
    ]);

    return {
      configured: true,
      available: resolved?.resolutionStatus === "resolved",
      resolutionStatus: resolved?.resolutionStatus ?? "not_found",
      message:
        resolved?.resolutionStatus === "resolved"
          ? undefined
          : resolved?.resolutionStatus === "ambiguous"
            ? "Multiple ManageBac students matched this account email."
            : "ManageBac is not available for this account.",
      student: resolved?.resolutionStatus === "resolved"
        ? {
            id: resolved.managebacStudentId,
            name: resolved.managebacStudentName,
            gradeLevel: resolved.managebacGradeLevel,
            email: actor.email,
          }
        : undefined,
      announcements: org?.announcementsCache ?? [],
      workstreams,
      plannerItems,
      artifacts,
      lastHydratedAt: resolved?.lastHydratedAt,
      lastHydrationStatus: resolved?.lastHydrationStatus ?? "idle",
      lastHydrationError: resolved?.lastHydrationError,
    };
  },
});

export const manualSync = action({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args): Promise<unknown> => {
    const actor = await ctx.runQuery(internal.managebacSync.getSyncActor, { actorClerkId: args.actorClerkId });
    if (!actor || (actor.role !== "admin" && !SUPER_ADMIN_EMAILS.has(actor.email.trim().toLowerCase()))) {
      throw new Error("Only admin can trigger manual sync");
    }
    return ctx.runAction(internal.managebacSync.runOrgSyncInternal, { orgId: actor.orgId });
  },
});

export const getSyncActor = internalQuery({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => getUserByClerkId(ctx, args.actorClerkId),
});

export const listSyncTargets = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("orgs").collect();
    return orgs
      .filter((org) => org.managebacConfig?.encryptedToken && org.managebacConfig.syncEnabled)
      .map((org) => ({
        orgId: org._id,
        managebacConfig: org.managebacConfig,
      }));
  },
});

export const markSyncState = internalMutation({
  args: {
    orgId: v.id("orgs"),
    status: v.union(v.literal("idle"), v.literal("success"), v.literal("error")),
    lastSyncError: v.optional(v.string()),
    lastSyncDetails: v.optional(v.any()),
    announcementsCache: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org?.managebacConfig) return;
    await ctx.db.patch(args.orgId, {
      managebacConfig: {
        ...org.managebacConfig,
        lastSyncAt: Date.now(),
        lastSyncStatus: args.status,
        lastSyncError: args.lastSyncError,
        lastSyncDetails: args.lastSyncDetails ?? org.managebacConfig.lastSyncDetails,
        announcementsCache: args.announcementsCache ?? org.managebacConfig.announcementsCache,
        updatedAt: Date.now(),
      },
      updatedAt: Date.now(),
    });
  },
});

export const applyPreparedSync = internalMutation({
  args: {
    orgId: v.id("orgs"),
    userId: v.id("users"),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const payload = args.payload as Awaited<ReturnType<typeof prepareManagebacSyncPayload>>;
    const summary: SyncSummary = {
      syncedStudents: 1,
      workstreamsCreated: 0,
      workstreamsUpdated: 0,
      plannerCreated: 0,
      plannerUpdated: 0,
      artifactsCreated: 0,
      artifactsUpdated: 0,
      notesCreated: 0,
      notesUpdated: 0,
      conflicts: 0,
      warnings: [...payload.warnings],
    };

    const workstreams = await ctx.db
      .query("workstreams")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", args.userId))
      .collect();
    const plannerItems = await ctx.db
      .query("plannerItems")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", args.userId))
      .collect();
    const artifacts = await ctx.db
      .query("artifacts")
      .withIndex("by_owner_updated", (q) => q.eq("ownerUserId", args.userId))
      .collect();

    const classWorkstreamIds = new Map<string, Id<"workstreams">>();
    const classesSeen = new Set<string>();

    for (const klass of payload.classes) {
      classesSeen.add(klass.id);
      const matchedTimetable = matchManagebacTimetableForClass({
        klass,
        timetable: payload.timetable,
      });
      const mapped = mapManagebacClassToWorkstream({
        klass,
        timetable: matchedTimetable,
        student: payload.student,
      });
      const existing = workstreams.find((row) => row.managebacClassId === klass.id);
      if (existing) {
        await ctx.db.patch(existing._id, {
          title: mapped.title,
          subjectCode: mapped.subjectCode,
          managebacContext: mapped.managebacContext,
          managebacInactiveSince: undefined,
          updatedAt: Date.now(),
        });
        classWorkstreamIds.set(klass.id, existing._id);
        summary.workstreamsUpdated += 1;
      } else {
        const workstreamId = await ctx.db.insert("workstreams", {
          ownerUserId: args.userId,
          orgId: args.orgId,
          type: "subject",
          title: mapped.title,
          description: klass.description,
          emoji: undefined,
          color: undefined,
          status: "active",
          subjectCode: mapped.subjectCode,
          managebacClassId: klass.id,
          managebacContext: mapped.managebacContext,
          managebacInactiveSince: undefined,
          artifactCount: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        classWorkstreamIds.set(klass.id, workstreamId);
        summary.workstreamsCreated += 1;
      }
    }

    for (const workstream of workstreams) {
      if (workstream.managebacClassId && !classesSeen.has(workstream.managebacClassId) && !workstream.managebacInactiveSince) {
        await ctx.db.patch(workstream._id, {
          managebacInactiveSince: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }

    const timetableManagebacItemId = `managebac:timetable:${payload.studentId}`;
    const timetableArtifactTitle = "ManageBac timetable";
    const existingTimetableArtifact = artifacts.find((row) => row.managebacItemId === timetableManagebacItemId);
    if (payload.timetable.length > 0) {
      if (existingTimetableArtifact) {
        await ctx.db.patch(existingTimetableArtifact._id, {
          title: timetableArtifactTitle,
          type: "timetable",
          workstreamId: undefined,
          content: payload.timetable,
          sourceType: "managebac_sync",
          sourceDeleted: false,
          sourceUpdatedAt: Date.now(),
          syncConflictSummary: undefined,
          updatedAt: Date.now(),
        });
        await ctx.db.insert("artifactVersions", {
          artifactId: existingTimetableArtifact._id,
          diff: { op: "update", previous: existingTimetableArtifact.content },
          snapshot: payload.timetable,
          authorType: "system",
          description: "Updated ManageBac timetable",
          status: "confirmed",
          createdAt: Date.now(),
        });
        summary.artifactsUpdated += 1;
      } else {
        const artifactId = await ctx.db.insert("artifacts", {
          ownerUserId: args.userId,
          orgId: args.orgId,
          workstreamId: undefined,
          type: "timetable",
          title: timetableArtifactTitle,
          content: payload.timetable,
          sourceType: "managebac_sync",
          managebacItemId: timetableManagebacItemId,
          sourceDeleted: false,
          sourceUpdatedAt: Date.now(),
          status: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        await ctx.db.insert("artifactVersions", {
          artifactId,
          diff: { op: "create" },
          snapshot: payload.timetable,
          authorType: "system",
          description: "Created ManageBac timetable",
          status: "confirmed",
          createdAt: Date.now(),
        });
        summary.artifactsCreated += 1;
      }
    } else if (existingTimetableArtifact && !existingTimetableArtifact.sourceDeleted) {
      await ctx.db.patch(existingTimetableArtifact._id, {
        sourceDeleted: true,
        syncConflictSummary: "Removed from ManageBac",
        updatedAt: Date.now(),
      });
    }

    const assignmentIds = new Set<string>();
    for (const assignment of payload.assignments) {
      assignmentIds.add(assignment.id);
      const mapped = mapManagebacAssignmentToPlanner({
        assignment,
        workstreamId: assignment.classId ? classWorkstreamIds.get(assignment.classId) : undefined,
      });
      const existing = plannerItems.find((row) => row.managebacItemId === assignment.id);
      if (existing) {
        await ctx.db.patch(existing._id, {
          title: mapped.title,
          description: mapped.description,
          dueAt: mapped.dueAt,
          workstreamId: mapped.workstreamId as Id<"workstreams"> | undefined,
          sourceDeleted: false,
          sourceUpdatedAt: mapped.sourceUpdatedAt,
          syncConflictSummary: undefined,
          updatedAt: Date.now(),
        });
        summary.plannerUpdated += 1;
      } else {
        await ctx.db.insert("plannerItems", {
          ownerUserId: args.userId,
          orgId: args.orgId,
          workstreamId: mapped.workstreamId as Id<"workstreams"> | undefined,
          title: mapped.title,
          description: mapped.description,
          type: "deadline",
          priority: "medium",
          status: "pending",
          dueAt: mapped.dueAt,
          sourceType: "managebac_sync",
          managebacItemId: mapped.managebacItemId,
          sourceDeleted: false,
          sourceUpdatedAt: mapped.sourceUpdatedAt,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        summary.plannerCreated += 1;
      }
    }

    const casWorkstreamTitle = "CAS";
    let casWorkstream = workstreams.find((row) => row.managebacClassId === `managebac:cas:${payload.studentId}`);
    if (!casWorkstream) {
      const casId = await ctx.db.insert("workstreams", {
        ownerUserId: args.userId,
        orgId: args.orgId,
        type: "general",
        title: casWorkstreamTitle,
        status: "active",
        managebacClassId: `managebac:cas:${payload.studentId}`,
        managebacContext: {
          syncedAt: Date.now(),
          kind: "cas",
        },
        artifactCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      casWorkstream = await ctx.db.get(casId) as Doc<"workstreams">;
      summary.workstreamsCreated += 1;
    }

    const casIds = new Set<string>();
    for (const activity of payload.casActivities) {
      casIds.add(activity.id);
      const mappedPlanner = mapManagebacCasToPlanner({
        activity,
        workstreamId: casWorkstream?._id,
      });
      const existingPlanner = plannerItems.find((row) => row.managebacItemId === activity.id);
      if (existingPlanner) {
        await ctx.db.patch(existingPlanner._id, {
          title: mappedPlanner.title,
          description: mappedPlanner.description,
          workstreamId: casWorkstream?._id,
          sourceDeleted: false,
          sourceUpdatedAt: mappedPlanner.sourceUpdatedAt,
          syncConflictSummary: undefined,
          updatedAt: Date.now(),
        });
        summary.plannerUpdated += 1;
      } else {
        await ctx.db.insert("plannerItems", {
          ownerUserId: args.userId,
          orgId: args.orgId,
          workstreamId: casWorkstream?._id,
          title: mappedPlanner.title,
          description: mappedPlanner.description,
          type: "milestone",
          priority: "medium",
          status: "pending",
          sourceType: "managebac_sync",
          managebacItemId: mappedPlanner.managebacItemId,
          sourceDeleted: false,
          sourceUpdatedAt: mappedPlanner.sourceUpdatedAt,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        summary.plannerCreated += 1;
      }

      if (shouldCreateCasReflectionNote(activity)) {
        const mappedNote = mapManagebacCasToNote(activity);
        const existingDocument = artifacts.find((row) => row.managebacItemId === activity.id && row.type === "document");
        if (existingDocument) {
          const incomingPlaintext = mappedNote.plaintext;
          const localEditedAfterSource =
            typeof existingDocument.sourceUpdatedAt === "number"
            && existingDocument.updatedAt > existingDocument.sourceUpdatedAt
            && (existingDocument.contentPlaintext ?? "").trim() !== incomingPlaintext.trim();
          if (localEditedAfterSource) {
            await ctx.db.patch(existingDocument._id, {
              syncConflictSummary: "ManageBac source updated. Review changes before replacing local edits.",
              sourceUpdatedAt: mappedNote.sourceUpdatedAt,
              updatedAt: Date.now(),
            });
            summary.conflicts += 1;
          } else {
            await ctx.db.patch(existingDocument._id, {
              title: mappedNote.title,
              type: "document",
              content: plainTextDoc(mappedNote.plaintext),
              contentPlaintext: mappedNote.plaintext,
              editorMode: "simple",
              sourceType: "managebac_sync",
              sourceDeleted: false,
              sourceUpdatedAt: mappedNote.sourceUpdatedAt,
              syncConflictSummary: undefined,
              updatedAt: Date.now(),
            });
            await ctx.db.insert("artifactVersions", {
              artifactId: existingDocument._id,
              diff: { op: "update", previous: existingDocument.content },
              snapshot: plainTextDoc(mappedNote.plaintext),
              authorType: "system",
              description: "Updated ManageBac CAS reflection",
              status: "confirmed",
              createdAt: Date.now(),
            });
            summary.artifactsUpdated += 1;
            summary.notesUpdated += 1;
          }
        } else {
          const artifactId = await ctx.db.insert("artifacts", {
            ownerUserId: args.userId,
            orgId: args.orgId,
            workstreamId: casWorkstream?._id,
            type: "document",
            title: mappedNote.title,
            content: plainTextDoc(mappedNote.plaintext),
            contentPlaintext: mappedNote.plaintext,
            editorMode: "simple",
            sourceType: "managebac_sync",
            managebacItemId: mappedNote.managebacItemId,
            sourceDeleted: false,
            sourceUpdatedAt: mappedNote.sourceUpdatedAt,
            status: "active",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          await ctx.db.insert("artifactVersions", {
            artifactId,
            diff: { op: "create" },
            snapshot: plainTextDoc(mappedNote.plaintext),
            authorType: "system",
            description: "Created ManageBac CAS reflection",
            status: "confirmed",
            createdAt: Date.now(),
          });
          await adjustWorkstreamArtifactCount(ctx, casWorkstream?._id, 1);
          summary.artifactsCreated += 1;
          summary.notesCreated += 1;
        }
      }
    }

    for (const item of plannerItems.filter((row) => row.sourceType === "managebac_sync" && row.managebacItemId)) {
      const isAssignment = assignmentIds.has(item.managebacItemId!);
      const isCas = casIds.has(item.managebacItemId!);
      if (!isAssignment && !isCas) {
        await ctx.db.patch(item._id, {
          sourceDeleted: true,
          syncConflictSummary: "Removed from ManageBac",
          updatedAt: Date.now(),
        });
      }
    }

    for (const artifact of artifacts.filter((row) => row.sourceType === "managebac_sync" && row.managebacItemId)) {
      if (artifact.managebacItemId === timetableManagebacItemId) continue;
      if (artifact.type === "document" && !casIds.has(artifact.managebacItemId!)) {
        await ctx.db.patch(artifact._id, {
          sourceDeleted: true,
          syncConflictSummary: "Removed from ManageBac",
          updatedAt: Date.now(),
        });
      }
    }

    return {
      summary,
      announcements: mapAnnouncementsToCache(payload.announcements),
    };
  },
});

export const runOrgSyncInternal = internalAction({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, args) => {
    const org = await ctx.runQuery(internal.managebacSync.getOrgConfigInternal, { orgId: args.orgId });
    if (!org?.managebacConfig?.encryptedToken || !org.managebacConfig.baseUrl) {
      return { ok: false, reason: "ManageBac not configured" } as const;
    }

    const token = await decryptManagebacToken(org.managebacConfig.encryptedToken);
    const mappings = org.managebacConfig.studentMappings ?? [];
    const warnings: string[] = [];
    const aggregate: SyncSummary = {
      syncedStudents: 0,
      workstreamsCreated: 0,
      workstreamsUpdated: 0,
      plannerCreated: 0,
      plannerUpdated: 0,
      artifactsCreated: 0,
      artifactsUpdated: 0,
      notesCreated: 0,
      notesUpdated: 0,
      conflicts: 0,
      warnings,
    };
    let latestAnnouncements: unknown[] = [];

    try {
      for (const mapping of mappings) {
        const user = await ctx.runQuery(internal.managebacSync.resolveMappedUserInternal, {
          orgId: args.orgId,
          mappingClerkId: mapping.clerkId,
        });
        if (!user) {
          warnings.push(`Missing user for mapping ${mapping.clerkId}`);
          continue;
        }
        const payload = await prepareManagebacSyncPayload({
          baseUrl: org.managebacConfig.baseUrl,
          token,
          studentId: mapping.managebacStudentId,
          endpoints: org.managebacConfig.availableEndpoints ?? [],
        });
        const applied = await ctx.runMutation(internal.managebacSync.applyPreparedSync, {
          orgId: args.orgId,
          userId: user._id,
          payload,
        });
        latestAnnouncements = applied.announcements;
        const summary = applied.summary as SyncSummary;
        aggregate.syncedStudents += summary.syncedStudents;
        aggregate.workstreamsCreated += summary.workstreamsCreated;
        aggregate.workstreamsUpdated += summary.workstreamsUpdated;
        aggregate.plannerCreated += summary.plannerCreated;
        aggregate.plannerUpdated += summary.plannerUpdated;
        aggregate.artifactsCreated += summary.artifactsCreated;
        aggregate.artifactsUpdated += summary.artifactsUpdated;
        aggregate.notesCreated += summary.notesCreated;
        aggregate.notesUpdated += summary.notesUpdated;
        aggregate.conflicts += summary.conflicts;
        warnings.push(...summary.warnings);
      }

      await ctx.runMutation(internal.managebacSync.markSyncState, {
        orgId: args.orgId,
        status: "success",
        lastSyncDetails: aggregate,
        announcementsCache: latestAnnouncements,
      });
      return { ok: true, summary: aggregate } as const;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.managebacSync.markSyncState, {
        orgId: args.orgId,
        status: "error",
        lastSyncError: message,
        lastSyncDetails: aggregate,
        announcementsCache: latestAnnouncements,
      });
      throw error;
    }
  },
});

export const getOrgConfigInternal = internalQuery({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, args) => ctx.db.get(args.orgId),
});

export const getUserByClerkIdInternal = internalQuery({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const users = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .collect();
    return users[0] ?? null;
  },
});

export const resolveMappedUserInternal = internalQuery({
  args: {
    orgId: v.id("orgs"),
    mappingClerkId: v.string(),
  },
  handler: async (ctx, args) => resolveMappedUserFromOrg(ctx, args.orgId, args.mappingClerkId),
});

export const runScheduledSync: ReturnType<typeof internalAction> = internalAction({
  args: {},
  handler: async (ctx) => {
    const targets = await ctx.runQuery(internal.managebacSync.listSyncTargets, {});
    const results = [];
    for (const target of targets) {
      results.push(await ctx.runAction(internal.managebacSync.runOrgSyncInternal, { orgId: target.orgId }));
    }
    return { ok: true, count: results.length };
  },
});

export const getOrgManagebacConfigInternal = internalQuery({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    return org?.managebacConfig
      ? {
          configured: Boolean(org.managebacConfig.encryptedToken && org.managebacConfig.baseUrl),
          announcementsCache: org.managebacConfig.announcementsCache ?? [],
        }
      : { configured: false, announcementsCache: [] };
  },
});

export const getManagebacUserLinkInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return ctx.db.query("managebacUserLinks").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique();
  },
});

export const getManagebacWorkstreamsInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("workstreams").withIndex("by_owner", (q) => q.eq("ownerUserId", args.userId)).collect();
    return rows.filter((item) => Boolean(item.managebacClassId || item.managebacContext)).slice(0, 20);
  },
});

export const getManagebacPlannerItemsInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("plannerItems").withIndex("by_owner", (q) => q.eq("ownerUserId", args.userId)).collect();
    return rows.filter((item) => item.sourceType === "managebac_sync").slice(0, 50);
  },
});

export const getManagebacArtifactsInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("artifacts").withIndex("by_owner_updated", (q) => q.eq("ownerUserId", args.userId)).collect();
    return rows.filter((item) => item.sourceType === "managebac_sync").slice(0, 50);
  },
});

export const resolveAndHydrateCurrentUserInternal = internalAction({
  args: { actorClerkId: v.string(), hydrate: v.optional(v.boolean()), skipResolution: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<ManagebacResolutionResult> => {
    const actor = await ctx.runQuery(internal.managebacSync.getSyncActor, { actorClerkId: args.actorClerkId });
    if (!actor) throw new Error("Unauthorized");

    let link = await ctx.runQuery(internal.managebacSync.getManagebacUserLinkInternal, { userId: actor._id });
    if (!args.skipResolution || !link?.managebacStudentId) {
      const config = await ctx.runQuery(internal.managebacSync.getManagebacConfigFullInternal, { orgId: actor.orgId });
      if (!config) {
        return {
          configured: false,
          available: false,
          resolutionStatus: "not_configured",
          message: "ManageBac is not configured for this school.",
        };
      }
      const studentsPayload = await fetchManagebacJson({
        baseUrl: config.baseUrl,
        token: config.token,
        path: "/api/v2/students",
      });
      const rows = Array.isArray((studentsPayload as { data?: unknown } | null)?.data)
        ? ((studentsPayload as { data?: unknown[] }).data ?? [])
        : Array.isArray(studentsPayload)
          ? studentsPayload as unknown[]
          : [];
      const targetEmail = normalizeEmail(actor.email);
      const matches = rows
        .map((row) => normalizeManagebacStudentProfile(row))
        .filter((row): row is NonNullable<typeof row> => Boolean(row) && normalizeEmail(row?.email ?? "") === targetEmail);

      if (matches.length === 0) {
        await ctx.runMutation(internal.managebacSync.resolveManagebacUserLinkInternal, {
          actorId: actor._id,
          actorOrgId: actor.orgId,
          actorClerkId: actor.clerkId,
          actorEmail: actor.email,
          resolutionStatus: "not_found",
        });
        return {
          configured: true,
          available: false,
          resolutionStatus: "not_found",
          message: "ManageBac is not available for this account.",
          announcements: config.announcementsCache ?? [],
        };
      }
      if (matches.length > 1) {
        await ctx.runMutation(internal.managebacSync.resolveManagebacUserLinkInternal, {
          actorId: actor._id,
          actorOrgId: actor.orgId,
          actorClerkId: actor.clerkId,
          actorEmail: actor.email,
          resolutionStatus: "ambiguous",
          resolutionError: "Multiple ManageBac students matched this email.",
        });
        return {
          configured: true,
          available: false,
          resolutionStatus: "ambiguous",
          message: "Multiple ManageBac students matched this account email.",
          announcements: config.announcementsCache ?? [],
        };
      }
      const match = matches[0];
      await ctx.runMutation(internal.managebacSync.resolveManagebacUserLinkInternal, {
        actorId: actor._id,
        actorOrgId: actor.orgId,
        actorClerkId: actor.clerkId,
        actorEmail: actor.email,
        managebacStudentId: match.id,
        managebacStudentName: match.name,
        managebacGradeLevel: match.gradeLevel,
        resolutionStatus: "resolved",
      });
      link = await ctx.runQuery(internal.managebacSync.getManagebacUserLinkInternal, { userId: actor._id });
    }

    if (!args.hydrate || !link?.managebacStudentId) {
      return { configured: true, available: true, resolutionStatus: "resolved" };
    }

    const managebacConfig = await ctx.runQuery(internal.managebacSync.getManagebacConfigFullInternal, { orgId: actor.orgId });
    if (!managebacConfig) {
      return {
        configured: false,
        available: false,
        resolutionStatus: "not_configured",
        message: "ManageBac is not configured for this school.",
      };
    }

    try {
      const payload = await prepareManagebacSyncPayload({
        baseUrl: managebacConfig.baseUrl,
        token: managebacConfig.token,
        studentId: link.managebacStudentId,
        endpoints: managebacConfig.availableEndpoints,
      });
      await ctx.runMutation(internal.managebacSync.applyPreparedSync, {
        orgId: actor.orgId,
        userId: actor._id,
        payload,
      });
      await ctx.runMutation(internal.managebacSync.markSyncState, {
        orgId: actor.orgId,
        status: "success",
        lastSyncDetails: {
          syncedStudents: 1,
          warnings: payload.warnings,
        },
        announcementsCache: mapAnnouncementsToCache(payload.announcements),
      });
      await ctx.runMutation(internal.managebacSync.upsertManagebacUserLinkHydrationInternal, {
        userId: actor._id,
        hydrationStatus: "success",
      });
      return { configured: true, available: true, resolutionStatus: "resolved" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "ManageBac hydration failed.";
      await ctx.runMutation(internal.managebacSync.upsertManagebacUserLinkHydrationInternal, {
        userId: actor._id,
        hydrationStatus: "error",
        hydrationError: message,
      });
      return {
        configured: true,
        available: false,
        resolutionStatus: "error",
        message,
      };
    }
  },
});

export const upsertManagebacUserLinkHydrationInternal = internalMutation({
  args: {
    userId: v.id("users"),
    hydrationStatus: v.union(v.literal("success"), v.literal("error")),
    hydrationError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("managebacUserLinks").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique();
    if (!existing) return;
    await ctx.db.patch(existing._id, {
      lastHydratedAt: args.hydrationStatus === "success" ? Date.now() : existing.lastHydratedAt,
      lastHydrationStatus: args.hydrationStatus,
      lastHydrationError: args.hydrationError,
      updatedAt: Date.now(),
    });
  },
});
