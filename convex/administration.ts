import { type MutationCtx, type QueryCtx } from "./_generated/server";
import { internalAction, internalQuery, query } from "./functions";
import { internalMutation, mutation } from "./orgNodeMutation";
import { v } from "convex/values";
import type { PaginationOptions, PaginationResult } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { resolveActorContext } from "./identityShared";
import { writeAuditEvent } from "./auditShared";
import { bumpPolicyVersion } from "./authorityShared";
import { releaseClaimsForAccount } from "./regionClaims";
import { releasePayloadIfUnreferenced } from "./payloadLifecycle";
import { deleteStorageIfNoOtherBinding } from "./durableStorageBindings";

type Ctx = QueryCtx | MutationCtx;

function clean(value: string, maximum: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, maximum);
}

function day(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

async function schoolScope(
  ctx: Ctx,
  operatorSessionId?: Id<"operatorSchoolSessions">,
  write = false,
) {
  const actor = await resolveActorContext(ctx, operatorSessionId);
  const localAdmin =
    actor.membership?.role === "school_admin" && actor.membershipSchool;
  const operatorSchool = actor.operatorSession && actor.operationalSchool;
  if (!localAdmin && !operatorSchool)
    throw new Error(
      "AUTH_SCHOOL_ADMIN_REQUIRED: School administrator access is required.",
    );
  if (write && operatorSchool && actor.operatorSession!.mode !== "manage")
    throw new Error(
      "AUTH_OPERATOR_MANAGE_REQUIRED: Re-enter this school with manage access.",
    );
  return {
    actor,
    school: (operatorSchool ?? actor.membershipSchool)!,
    operatorSessionId: actor.operatorSession?._id,
  };
}

async function platformOperator(ctx: Ctx) {
  const actor = await resolveActorContext(ctx);
  if (!actor.platformOperator)
    throw new Error(
      "AUTH_OPERATOR_REQUIRED: Platform operator access is required.",
    );
  return actor;
}

export const agentGovernance = query({
  args: { operatorSessionId: v.optional(v.id("operatorSchoolSessions")) },
  handler: async (ctx, args) => {
    const { school } = await schoolScope(ctx, args.operatorSessionId);
    const schoolGrants = await ctx.db
      .query("accessGrants")
      .withIndex("by_school", (q) =>
        q.eq("schoolId", school._id).eq("resourceType", "agent"),
      )
      .collect();
    const now = Date.now();
    const visibleAgentIds = new Set(
      schoolGrants
        .filter(
          (grant) =>
            !grant.revokedAt &&
            (!grant.expiresAt || grant.expiresAt > now) &&
            (grant.principalType === "school" ||
              grant.principalType === "public"),
        )
        .map((grant) => grant.resourceId),
    );
    // Read the shared agents and their own aggregates by agent. Collecting
    // every active artifact in the school, content included, to find the
    // few agents failed on a large school.
    const ofSchool = <T extends { schoolId: Id<"schools"> }>(rows: T[]) =>
      rows.filter((row) => row.schoolId === school._id);
    const perAgent = await Promise.all(
      [...visibleAgentIds].map(async (resourceId) => {
        const agentId = ctx.db.normalizeId("spectraArtifacts", resourceId);
        if (!agentId) return null;
        const [artifact, usage, feedback, evaluations, releases] =
          await Promise.all([
            ctx.db.get(agentId),
            ctx.db
              .query("agentUsageAggregates")
              .withIndex("by_agent_day", (q) => q.eq("agentId", agentId))
              .collect(),
            ctx.db
              .query("agentFeedback")
              .withIndex("by_agent_created", (q) => q.eq("agentId", agentId))
              .collect(),
            ctx.db
              .query("agentEvalRuns")
              .withIndex("by_agent_created", (q) => q.eq("agentId", agentId))
              .collect(),
            ctx.db
              .query("agentReleases")
              .withIndex("by_agent_number", (q) => q.eq("agentId", agentId))
              .collect(),
          ]);
        return {
          artifact,
          usage: ofSchool(usage),
          feedback: ofSchool(feedback),
          evaluations: ofSchool(evaluations),
          releases: ofSchool(releases),
        };
      }),
    );
    const usage = perAgent.flatMap((row) => row?.usage ?? []);
    const feedback = perAgent.flatMap((row) => row?.feedback ?? []);
    const evaluations = perAgent.flatMap((row) => row?.evaluations ?? []);
    const releases = perAgent.flatMap((row) => row?.releases ?? []);
    const visible = perAgent.flatMap((row) =>
      row?.artifact &&
      row.artifact.schoolId === school._id &&
      row.artifact.status === "active" &&
      row.artifact.blueprintKey === "agent"
        ? [row.artifact]
        : [],
    );
    const summaries = visible.map((artifact) => {
      const agentUsage = usage.filter((row) => row.agentId === artifact._id);
      const agentFeedback = feedback.filter(
        (row) => row.agentId === artifact._id,
      );
      const agentEvals = evaluations.filter(
        (row) => row.agentId === artifact._id,
      );
      const agentReleases = releases.filter(
        (row) => row.agentId === artifact._id,
      );
      const invocations = agentUsage.reduce(
        (sum, row) => sum + row.invocations,
        0,
      );
      const completed = agentUsage.reduce((sum, row) => sum + row.completed, 0);
      return {
        agentId: artifact._id,
        title: artifact.title,
        invocations,
        completionRate: invocations ? completed / invocations : null,
        averageRating: agentFeedback.length
          ? agentFeedback.reduce((sum, row) => sum + row.rating, 0) /
            agentFeedback.length
          : null,
        evaluationPassRate: agentEvals.length
          ? agentEvals.filter((row) => row.status === "passed").length /
            agentEvals.length
          : null,
        publishedReleases: agentReleases.filter(
          (row) =>
            row.status === "published" &&
            (!row.rollout || row.rollout === "published"),
        ).length,
        suspendedReleases: agentReleases.filter(
          (row) => row.status === "suspended",
        ).length,
        updatedAt: artifact.updatedAt,
      };
    });
    const invocations = summaries.reduce(
      (sum, row) => sum + row.invocations,
      0,
    );
    return {
      totals: {
        sharedAgents: summaries.length,
        invocations,
        feedback: summaries.reduce(
          (sum, row) =>
            sum +
            feedback.filter((item) => item.agentId === row.agentId).length,
          0,
        ),
        passedEvaluations: evaluations.filter(
          (row) => visibleAgentIds.has(row.agentId) && row.status === "passed",
        ).length,
      },
      agents: summaries.sort(
        (left, right) =>
          right.invocations - left.invocations ||
          right.updatedAt - left.updatedAt,
      ),
      privacy:
        "Only school/public agent metadata and aggregate usage, evaluation, and consented rating counts are included. Prompts, threads, memory, artifacts, resource content, and feedback comments are excluded.",
    };
  },
});

async function schoolMemberRows(ctx: Ctx, schoolId: Id<"schools">) {
  const memberships = await ctx.db
    .query("schoolMemberships")
    .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
    .collect();
  return Promise.all(
    memberships.map(async (membership) => ({
      membership,
      account: await ctx.db.get(membership.accountId),
    })),
  );
}

async function lastActiveAdminCount(
  ctx: Ctx,
  schoolId: Id<"schools">,
  excluding?: Id<"schoolMemberships">,
) {
  const admins = await ctx.db
    .query("schoolMemberships")
    .withIndex("by_school_role", (q) =>
      q.eq("schoolId", schoolId).eq("role", "school_admin"),
    )
    .collect();
  return admins.filter(
    (membership) =>
      membership.status === "active" && membership._id !== excluding,
  ).length;
}

async function schoolUsage(
  ctx: Ctx,
  schoolId: Id<"schools">,
  fromDay: string,
  toDay: string,
) {
  const meters = await ctx.db
    .query("usageMeters")
    .withIndex("by_school_day", (q) =>
      q.eq("schoolId", schoolId).gte("day", fromDay).lte("day", toDay),
    )
    .collect();
  const totals: Record<string, number> = {
    storage_bytes: 0,
    bandwidth_bytes: 0,
    model_input_tokens: 0,
    model_output_tokens: 0,
    render_milliseconds: 0,
    collaboration_bytes: 0,
  };
  const series: Record<string, Record<string, number>> = {};
  for (const meter of meters) {
    totals[meter.category] = (totals[meter.category] ?? 0) + meter.quantity;
    series[meter.day] ??= {};
    series[meter.day]![meter.category] =
      (series[meter.day]![meter.category] ?? 0) + meter.quantity;
  }
  return {
    totals,
    series: Object.entries(series)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, values]) => ({ day: date, values })),
    completeThrough: toDay,
  };
}

export const schoolOverview = mutation({
  args: {
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    fromDay: v.string(),
    toDay: v.string(),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor, school, operatorSessionId } = await schoolScope(
      ctx,
      args.operatorSessionId,
    );
    const [
      memberRows,
      pendingInvitations,
      groups,
      workspaces,
      feedback,
      integration,
      openRequests,
      recentAudit,
      limitPolicy,
      usage,
      counters,
    ] = await Promise.all([
      schoolMemberRows(ctx, school._id),
      ctx.db
        .query("membershipInvitations")
        .withIndex("by_school_status", (q) =>
          q.eq("schoolId", school._id).eq("status", "pending"),
        )
        .collect(),
      ctx.db
        .query("schoolGroups")
        .withIndex("by_school_status", (q) =>
          q.eq("schoolId", school._id).eq("status", "active"),
        )
        .collect(),
      ctx.db
        .query("spectraWorkspaces")
        .withIndex("by_school_starter_status", (q) =>
          q
            .eq("schoolId", school._id)
            .eq("starterKey", "managebac-class")
            .eq("status", "active"),
        )
        .order("desc")
        .take(500),
      ctx.db
        .query("feedbackReports")
        .withIndex("by_school_status", (q) =>
          q.eq("schoolId", school._id).eq("status", "new"),
        )
        .order("desc")
        .take(100),
      ctx.db
        .query("schoolIntegrations")
        .withIndex("by_school_provider", (q) =>
          q.eq("schoolId", school._id).eq("provider", "managebac"),
        )
        .unique(),
      ctx.db
        .query("schoolRequests")
        .withIndex("by_school_status", (q) =>
          q.eq("schoolId", school._id).eq("status", "open"),
        )
        .take(100),
      ctx.db
        .query("auditEvents")
        .withIndex("by_school_created", (q) => q.eq("schoolId", school._id))
        .order("desc")
        .take(20),
      ctx.db
        .query("limitPolicies")
        .withIndex("by_scope_school", (q) =>
          q.eq("scope", "school").eq("schoolId", school._id),
        )
        .unique(),
      schoolUsage(ctx, school._id, args.fromDay, args.toDay),
      ctx.db
        .query("operationalCounters")
        .withIndex("by_school_day", (q) =>
          q
            .eq("schoolId", school._id)
            .gte("day", args.fromDay)
            .lte("day", args.toDay),
        )
        .collect(),
    ]);
    const activeMembers = memberRows.filter(
      ({ membership, account }) =>
        membership.status === "active" && account?.status === "active",
    );
    const active30d = activeMembers.filter(
      ({ account }) =>
        (account?.lastSeenAt ?? 0) >= Date.now() - 30 * 24 * 60 * 60_000,
    ).length;
    const classWorkspaces = workspaces;
    const computedAt = Date.now();
    // The overview only needs to know whether review is needed. Never load the
    // school's complete conflict payloads to draw its connection status.
    const openConflict = integration
      ? await ctx.db.query("externalSyncConflicts")
          .withIndex("by_integration_status", (q) => q.eq("integrationId", integration._id).eq("status", "open"))
          .first()
      : null;
    const directMetricState = { kind: "available" as const, updatedAt: computedAt };
    const counterMetricState = counters.length
      ? directMetricState
      : ({
          kind: "partial" as const,
          details:
            "No operational counter rows exist in this range, so disabled collection is not shown as zero.",
        });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: school._id,
      operatorSessionId,
      action: "admin.overview.viewed",
      targetType: "school",
      targetId: school._id,
      metadata: { requestId: args.requestId ?? null },
      requestId: args.requestId,
      retentionClass: "operational",
    });
    return {
      school: {
        schoolId: school._id,
        name: school.name,
        slug: school.slug,
        timezone: school.timezone,
        verifiedDomains: school.verifiedDomains,
        locale: school.locale,
        accentColor: school.accentColor,
        logoUrl: school.logoUrl,
        academicYearStart: school.academicYearStart,
        academicYearEnd: school.academicYearEnd,
        accessibilityDefaults: school.accessibilityDefaults,
        status: school.status,
        policyVersion: school.policyVersion,
      },
      operatorSession: actor.operatorSession
        ? {
            sessionId: actor.operatorSession._id,
            label: actor.operatorSession.label,
            mode: actor.operatorSession.mode,
            expiresAt: actor.operatorSession.expiresAt,
          }
        : null,
      metrics: {
        members: activeMembers.length,
        active30d,
        invitations: pendingInvitations.length,
        pendingApprovals: openRequests.length,
        groups: groups.length,
        classWorkspaces: classWorkspaces.length,
        feedbackNew: feedback.length,
        artifactsCreated: counters.length
          ? counters
              .filter((item) => item.category === "artifact_created")
              .reduce((sum, item) => sum + item.quantity, 0)
          : null,
        messages: counters.length
          ? counters
              .filter((item) => item.category === "thread_message")
              .reduce((sum, item) => sum + item.quantity, 0)
          : null,
        aiRuns: counters.length
          ? counters
              .filter((item) => item.category === "ai_run_started")
              .reduce((sum, item) => sum + item.quantity, 0)
          : null,
      },
      metricStates: {
        members: directMetricState,
        active30d: directMetricState,
        invitations: directMetricState,
        pendingApprovals: directMetricState,
        groups: directMetricState,
        classWorkspaces: directMetricState,
        feedbackNew: directMetricState,
        artifactsCreated: counterMetricState,
        messages: counterMetricState,
        aiRuns: counterMetricState,
      },
      computedAt,
      usage,
      limits: limitPolicy
        ? {
            policyId: limitPolicy._id,
            enforcement: limitPolicy.enforcement,
            rules: limitPolicy.rules,
            updatedAt: limitPolicy.updatedAt,
          }
        : {
            policyId: null,
            enforcement: "disabled" as const,
            rules: [],
            updatedAt: null,
          },
      integration: integration
        ? {
            integrationId: integration._id,
            status: integration.status,
            lastSyncAt: integration.lastSyncAt,
            nextSyncAt: integration.nextSyncAt,
            hasOpenConflicts: Boolean(openConflict),
            syncFreshness: !integration.lastSyncAt
              ? "never" as const
              : computedAt - integration.lastSyncAt > integration.freshnessSlaMinutes * 60_000
                ? "stale" as const
                : "current" as const,
            coverage: integration.capabilityCoverage,
          }
        : null,
      groupWorkspaces: classWorkspaces.slice(0, 12).map((workspace) => ({
        workspaceId: workspace._id,
        title: workspace.title,
        type: "class",
        lastActivityAt: workspace.lastActivityAt,
      })),
      feedback: feedback.slice(0, 8).map((item) => ({
        feedbackId: item._id,
        subject: item.subject,
        category: item.category,
        status: item.status,
        createdAt: item.createdAt,
      })),
      recentActivity: recentAudit.map((event) => ({
        eventId: event._id,
        action: event.action,
        targetType: event.targetType,
        createdAt: event.createdAt,
        operator: Boolean(event.operatorSessionId),
      })),
      privacy:
        "Operational aggregates only. Private prompts, thread content, memory, and ordinary artifact content are not queried.",
    };
  },
});

export const updateSchoolProfile = mutation({
  args: {
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    name: v.optional(v.string()),
    timezone: v.optional(v.string()),
    verifiedDomains: v.optional(v.array(v.string())),
    locale: v.optional(v.string()),
    accentColor: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    academicYearStart: v.optional(v.string()),
    academicYearEnd: v.optional(v.string()),
    accessibilityDefaults: v.optional(
      v.object({
        reducedMotion: v.boolean(),
        increasedContrast: v.boolean(),
        largerText: v.boolean(),
      }),
    ),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor, school, operatorSessionId } = await schoolScope(
      ctx,
      args.operatorSessionId,
      true,
    );
    const name = args.name === undefined ? school.name : clean(args.name, 140);
    if (name.length < 2)
      throw new Error("SCHOOL_NAME_INVALID: Add a valid school name.");
    if (args.timezone)
      try {
        new Intl.DateTimeFormat("en", { timeZone: args.timezone });
      } catch {
        throw new Error(
          "SCHOOL_TIMEZONE_INVALID: Choose a valid IANA timezone.",
        );
      }
    const domains = args.verifiedDomains?.map((value) =>
      value.trim().toLowerCase().replace(/^@/, ""),
    );
    if (
      domains?.some(
        (value) =>
          !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(value),
      )
    )
      throw new Error(
        "SCHOOL_DOMAIN_INVALID: Enter valid school email domains.",
      );
    const accent = args.accentColor?.trim().toLowerCase();
    if (accent && !/^#[0-9a-f]{6}$/.test(accent))
      throw new Error(
        "SCHOOL_ACCENT_INVALID: Use a six-digit hexadecimal colour.",
      );
    const logoUrl = args.logoUrl?.trim();
    if (logoUrl) {
      let parsed: URL;
      try {
        parsed = new URL(logoUrl);
      } catch {
        throw new Error("SCHOOL_LOGO_INVALID: Enter a valid HTTPS logo URL.");
      }
      if (parsed.protocol !== "https:")
        throw new Error("SCHOOL_LOGO_INVALID: Enter a valid HTTPS logo URL.");
    }
    const now = Date.now();
    await ctx.db.patch(school._id, {
      name,
      timezone: args.timezone ?? school.timezone,
      verifiedDomains: domains
        ? [...new Set(domains)].slice(0, 20)
        : school.verifiedDomains,
      locale: args.locale ? clean(args.locale, 30) : school.locale,
      accentColor: accent || school.accentColor,
      logoUrl: logoUrl || school.logoUrl,
      academicYearStart:
        args.academicYearStart === undefined
          ? school.academicYearStart
          : clean(args.academicYearStart, 20) || undefined,
      academicYearEnd:
        args.academicYearEnd === undefined
          ? school.academicYearEnd
          : clean(args.academicYearEnd, 20) || undefined,
      accessibilityDefaults:
        args.accessibilityDefaults ?? school.accessibilityDefaults,
      policyVersion: school.policyVersion + 1,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: school._id,
      operatorSessionId,
      action: "school.profile.updated",
      targetType: "school",
      targetId: school._id,
      metadata: {
        policyVersion: school.policyVersion + 1,
        domainsChanged: Boolean(args.verifiedDomains),
        brandingChanged: Boolean(args.accentColor || args.logoUrl),
      },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return {
      schoolId: school._id,
      policyVersion: school.policyVersion + 1,
      updatedAt: now,
    };
  },
});

export const people = query({
  args: {
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    search: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("invited"),
        v.literal("suspended"),
        v.literal("ended"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { school } = await schoolScope(ctx, args.operatorSessionId);
    const needle = clean(args.search ?? "", 200).toLowerCase();
    const rows = await schoolMemberRows(ctx, school._id);
    return rows
      .filter(
        ({ membership }) => !args.status || membership.status === args.status,
      )
      .filter(
        ({ account }) =>
          !needle ||
          `${account?.name ?? ""}\n${account?.email ?? ""}`
            .toLowerCase()
            .includes(needle),
      )
      .sort(
        (left, right) =>
          (right.account?.lastSeenAt ?? 0) - (left.account?.lastSeenAt ?? 0),
      )
      .slice(0, Math.max(1, Math.min(args.limit ?? 200, 500)))
      .map(({ membership, account }) => ({
        membershipId: membership._id,
        accountId: membership.accountId,
        name: account?.name ?? "Unavailable account",
        email: account?.email ?? "",
        avatarUrl: account?.avatarUrl,
        role: membership.role,
        status: membership.status,
        joinedAt: membership.joinedAt,
        lastSeenAt: account?.lastSeenAt,
      }));
  },
});

export const invitations = query({
  args: {
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("accepted"),
        v.literal("revoked"),
        v.literal("expired"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const { school } = await schoolScope(ctx, args.operatorSessionId);
    const rows = args.status
      ? await ctx.db
          .query("membershipInvitations")
          .withIndex("by_school_status", (q) =>
            q.eq("schoolId", school._id).eq("status", args.status!),
          )
          .order("desc")
          .take(500)
      : (
          await Promise.all(
            (["pending", "accepted", "revoked", "expired"] as const).map(
              (status) =>
                ctx.db
                  .query("membershipInvitations")
                  .withIndex("by_school_status", (q) =>
                    q.eq("schoolId", school._id).eq("status", status),
                  )
                  .take(250),
            ),
          )
        ).flat();
    return rows
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((item) => ({
        invitationId: item._id,
        email: item.email,
        role: item.role,
        status: item.status,
        expiresAt: item.expiresAt,
        createdAt: item.createdAt,
      }));
  },
});

export const changeMember = mutation({
  args: {
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    membershipId: v.id("schoolMemberships"),
    role: v.optional(
      v.union(
        v.literal("student"),
        v.literal("teacher"),
        v.literal("school_admin"),
      ),
    ),
    status: v.optional(
      v.union(v.literal("active"), v.literal("suspended"), v.literal("ended")),
    ),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor, school, operatorSessionId } = await schoolScope(
      ctx,
      args.operatorSessionId,
      true,
    );
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.schoolId !== school._id)
      throw new Error("MEMBERSHIP_NOT_FOUND: This member is unavailable.");
    const removesAdmin =
      membership.role === "school_admin" &&
      ((args.role && args.role !== "school_admin") ||
        (args.status && args.status !== "active"));
    if (
      removesAdmin &&
      (await lastActiveAdminCount(ctx, school._id, membership._id)) === 0
    )
      throw new Error(
        "MEMBERSHIP_LAST_ADMIN: Assign another active school admin first.",
      );
    if (
      membership.accountId === actor.accountId &&
      (args.status === "suspended" || args.status === "ended")
    )
      throw new Error(
        "MEMBERSHIP_SELF_LOCKOUT: Another administrator must perform this action.",
      );
    const now = Date.now();
    const nextStatus = args.status ?? membership.status;
    await ctx.db.patch(membership._id, {
      role: args.role ?? membership.role,
      status: nextStatus,
      endedAt: args.status === "ended" ? now : membership.endedAt,
      updatedAt: now,
    });
    if (nextStatus !== "active") {
      const account = await ctx.db.get(membership.accountId);
      if (account) {
        const normalizedEmail = account.email.trim().toLowerCase();
        const pendingInvitations = await ctx.db
          .query("membershipInvitations")
          .withIndex("by_school_email_status", (q) =>
            q.eq("schoolId", school._id).eq("email", normalizedEmail).eq("status", "pending"),
          )
          .collect();
        await Promise.all(pendingInvitations.map((invitation) =>
          ctx.db.patch(invitation._id, { status: "revoked", revokedAt: now, updatedAt: now }),
        ));
      }

      const liveDirectGrants = (await Promise.all([undefined, 0].map((revokedAt) =>
        ctx.db.query("accessGrants")
          .withIndex("by_school_principal_source_revoked", (q) =>
            q.eq("schoolId", school._id)
              .eq("principalType", "account")
              .eq("principalId", membership.accountId)
              .eq("source", "direct")
              .eq("revokedAt", revokedAt),
          )
          .collect(),
      ))).flat().filter((grant) => !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > now));
      const affectedResources = new Map<string, (typeof liveDirectGrants)[number]>();
      for (const grant of liveDirectGrants) {
        await ctx.db.patch(grant._id, { revokedAt: now, updatedAt: now });
        affectedResources.set(`${grant.resourceType}:${grant.resourceId}`, grant);
      }
      for (const grant of affectedResources.values()) {
        await bumpPolicyVersion(ctx, grant.resourceType, grant.resourceId, grant.schoolId ?? school._id, actor.accountId);
        if (grant.resourceType === "artifact" || grant.resourceType === "agent") {
          const artifactId = ctx.db.normalizeId("spectraArtifacts", grant.resourceId);
          if (artifactId) await releaseClaimsForAccount(ctx, artifactId, membership.accountId, now);
        }
      }
    }
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: school._id,
      operatorSessionId,
      action: "membership.changed",
      targetType: "membership",
      targetId: membership._id,
      metadata: {
        previousRole: membership.role,
        nextRole: args.role ?? membership.role,
        previousStatus: membership.status,
        nextStatus: args.status ?? membership.status,
      },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return {
      membershipId: membership._id,
      role: args.role ?? membership.role,
      status: args.status ?? membership.status,
      updatedAt: now,
    };
  },
});

export const revokeInvitation = mutation({
  args: {
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    invitationId: v.id("membershipInvitations"),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor, school, operatorSessionId } = await schoolScope(
      ctx,
      args.operatorSessionId,
      true,
    );
    const invitation = await ctx.db.get(args.invitationId);
    if (
      !invitation ||
      invitation.schoolId !== school._id ||
      invitation.status !== "pending"
    )
      throw new Error("INVITATION_NOT_FOUND: This invitation is unavailable.");
    const now = Date.now();
    await ctx.db.patch(invitation._id, {
      status: "revoked",
      revokedAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: school._id,
      operatorSessionId,
      action: "membership.invitation.revoked",
      targetType: "invitation",
      targetId: invitation._id,
      metadata: { email: invitation.email },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return { invitationId: invitation._id, revokedAt: now };
  },
});

export const groups = query({
  args: { operatorSessionId: v.optional(v.id("operatorSchoolSessions")) },
  handler: async (ctx, args) => {
    const { school } = await schoolScope(ctx, args.operatorSessionId);
    const rows = await ctx.db
      .query("schoolGroups")
      .withIndex("by_school_status", (q) =>
        q.eq("schoolId", school._id).eq("status", "active"),
      )
      .collect();
    return Promise.all(
      rows.map(async (group) => {
        const members = await ctx.db
          .query("schoolGroupMembers")
          .withIndex("by_group", (q) => q.eq("groupId", group._id))
          .collect();
        return {
          groupId: group._id,
          name: group.name,
          description: group.description,
          type: group.type,
          source: group.source,
          memberCount: members.length,
          updatedAt: group.updatedAt,
        };
      }),
    );
  },
});

export const createGroup = mutation({
  args: {
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    name: v.string(),
    description: v.optional(v.string()),
    type: v.union(
      v.literal("class"),
      v.literal("department"),
      v.literal("programme"),
      v.literal("custom"),
    ),
    memberAccountIds: v.optional(v.array(v.id("accounts"))),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor, school, operatorSessionId } = await schoolScope(
      ctx,
      args.operatorSessionId,
      true,
    );
    const name = clean(args.name, 160);
    if (name.length < 2)
      throw new Error("GROUP_NAME_REQUIRED: Add a group name.");
    const members = await schoolMemberRows(ctx, school._id);
    const activeIds = new Set(
      members
        .filter(({ membership }) => membership.status === "active")
        .map(({ membership }) => String(membership.accountId)),
    );
    const requested = [
      ...new Set((args.memberAccountIds ?? []).map(String)),
    ].slice(0, 1_000);
    if (requested.some((accountId) => !activeIds.has(accountId)))
      throw new Error(
        "GROUP_MEMBER_INVALID: Every group member must be active in this school.",
      );
    const now = Date.now();
    const groupId = await ctx.db.insert("schoolGroups", {
      schoolId: school._id,
      name,
      description: clean(args.description ?? "", 1_000) || undefined,
      type: args.type,
      source: "manual",
      status: "active",
      createdByAccountId: actor.accountId,
      createdAt: now,
      updatedAt: now,
    });
    for (const accountId of requested)
      await ctx.db.insert("schoolGroupMembers", {
        schoolId: school._id,
        groupId,
        accountId: accountId as Id<"accounts">,
        role: "member",
        createdByAccountId: actor.accountId,
        createdAt: now,
        updatedAt: now,
      });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: school._id,
      operatorSessionId,
      action: "school.group.created",
      targetType: "group",
      targetId: groupId,
      metadata: { type: args.type, memberCount: requested.length },
      requestId: args.requestId,
      retentionClass: "operational",
    });
    return { groupId, memberCount: requested.length };
  },
});

export const updateGroup = mutation({
  args: {
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    groupId: v.id("schoolGroups"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    memberAccountIds: v.optional(v.array(v.id("accounts"))),
    archived: v.optional(v.boolean()),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor, school, operatorSessionId } = await schoolScope(
      ctx,
      args.operatorSessionId,
      true,
    );
    const group = await ctx.db.get(args.groupId);
    if (!group || group.schoolId !== school._id)
      throw new Error("GROUP_NOT_FOUND: This group is unavailable.");
    if (group.source !== "manual")
      throw new Error(
        "GROUP_SOURCE_CONTROLLED: Manage this group through its source integration.",
      );
    const now = Date.now();
    const nextName =
      args.name === undefined ? group.name : clean(args.name, 160);
    if (nextName.length < 2)
      throw new Error("GROUP_NAME_REQUIRED: Add a group name.");
    let memberCount: number | undefined;
    if (args.memberAccountIds) {
      const activeMemberships = await ctx.db
        .query("schoolMemberships")
        .withIndex("by_school_status", (q) =>
          q.eq("schoolId", school._id).eq("status", "active"),
        )
        .collect();
      const activeIds = new Set(
        activeMemberships.map((item) => String(item.accountId)),
      );
      const requested = [
        ...new Set(args.memberAccountIds.map((item) => String(item))),
      ].slice(0, 1_000);
      if (requested.some((accountId) => !activeIds.has(accountId)))
        throw new Error(
          "GROUP_MEMBER_INVALID: Every group member must be active in this school.",
        );
      const existing = await ctx.db
        .query("schoolGroupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .collect();
      const desired = new Set(requested);
      for (const item of existing)
        if (!desired.has(String(item.accountId))) await ctx.db.delete(item._id);
      const existingIds = new Set(
        existing.map((item) => String(item.accountId)),
      );
      for (const accountId of requested)
        if (!existingIds.has(accountId))
          await ctx.db.insert("schoolGroupMembers", {
            schoolId: school._id,
            groupId: group._id,
            accountId: accountId as Id<"accounts">,
            role: "member",
            createdByAccountId: actor.accountId,
            createdAt: now,
            updatedAt: now,
          });
      memberCount = requested.length;
    }
    await ctx.db.patch(group._id, {
      name: nextName,
      description:
        args.description === undefined
          ? group.description
          : clean(args.description, 1_000) || undefined,
      status:
        args.archived === undefined
          ? group.status
          : args.archived
            ? "archived"
            : "active",
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: school._id,
      operatorSessionId,
      action: args.archived ? "school.group.archived" : "school.group.updated",
      targetType: "group",
      targetId: group._id,
      metadata: {
        memberCount: memberCount ?? null,
        status: args.archived ? "archived" : group.status,
      },
      requestId: args.requestId,
      retentionClass: "operational",
    });
    return { groupId: group._id, memberCount, updatedAt: now };
  },
});

async function announcementAudience(
  ctx: Ctx,
  schoolId: Id<"schools">,
  targetKind: "school" | "roles" | "groups",
  targetIds: string[],
) {
  const memberships = await ctx.db
    .query("schoolMemberships")
    .withIndex("by_school_status", (q) =>
      q.eq("schoolId", schoolId).eq("status", "active"),
    )
    .collect();
  if (targetKind === "school")
    return [...new Set(memberships.map((item) => item.accountId))];
  if (targetKind === "roles") {
    const roles = new Set(targetIds);
    return [
      ...new Set(
        memberships
          .filter((item) => roles.has(item.role))
          .map((item) => item.accountId),
      ),
    ];
  }
  const ids = targetIds
    .map((id) => ctx.db.normalizeId("schoolGroups", id))
    .filter((id): id is Id<"schoolGroups"> => Boolean(id));
  const groupRows = (
    await Promise.all(
      ids.map((groupId) =>
        ctx.db
          .query("schoolGroupMembers")
          .withIndex("by_group", (q) => q.eq("groupId", groupId))
          .collect(),
      ),
    )
  ).flat();
  return [...new Set(groupRows.map((item) => item.accountId))];
}

export const createAnnouncement = mutation({
  args: {
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    title: v.string(),
    body: v.string(),
    targetKind: v.union(
      v.literal("school"),
      v.literal("roles"),
      v.literal("groups"),
    ),
    targetIds: v.array(v.string()),
    scheduledAt: v.optional(v.number()),
    sendNow: v.optional(v.boolean()),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor, school, operatorSessionId } = await schoolScope(
      ctx,
      args.operatorSessionId,
      true,
    );
    const title = clean(args.title, 240);
    const body = args.body.trim().slice(0, 30_000);
    if (title.length < 2 || body.length < 2)
      throw new Error(
        "ANNOUNCEMENT_CONTENT_REQUIRED: Add a title and message.",
      );
    const recent = await ctx.db
      .query("schoolAnnouncements")
      .withIndex("by_school_created", (q) => q.eq("schoolId", school._id))
      .order("desc")
      .take(20);
    if (
      recent.filter(
        (item) =>
          item.createdByAccountId === actor.accountId &&
          item.createdAt >= Date.now() - 60 * 60_000,
      ).length >= 5
    )
      throw new Error(
        "ANNOUNCEMENT_RATE_LIMIT: Wait before sending more school messages.",
      );
    const audience = await announcementAudience(
      ctx,
      school._id,
      args.targetKind,
      args.targetIds,
    );
    if (!audience.length)
      throw new Error(
        "ANNOUNCEMENT_AUDIENCE_EMPTY: Choose an audience with active members.",
      );
    const now = Date.now();
    const sendNow = args.sendNow === true;
    const scheduledAt = sendNow
      ? now
      : Math.max(now + 60_000, args.scheduledAt ?? now + 60_000);
    const announcementId = await ctx.db.insert("schoolAnnouncements", {
      schoolId: school._id,
      title,
      body,
      targetKind: args.targetKind,
      targetIds: args.targetIds.slice(0, 100),
      audienceSnapshotCount: audience.length,
      status: sendNow ? "sent" : "scheduled",
      scheduledAt: sendNow ? undefined : scheduledAt,
      sentAt: sendNow ? now : undefined,
      createdByAccountId: actor.accountId,
      updatedByAccountId: actor.accountId,
      createdAt: now,
      updatedAt: now,
    });
    for (const accountId of audience)
      await ctx.db.insert("schoolAnnouncementDeliveries", {
        schoolId: school._id,
        announcementId,
        accountId,
        status: sendNow ? "delivered" : "pending",
        deliveredAt: sendNow ? now : undefined,
        createdAt: now,
        updatedAt: now,
      });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: school._id,
      operatorSessionId,
      action: sendNow ? "announcement.sent" : "announcement.scheduled",
      targetType: "announcement",
      targetId: announcementId,
      metadata: {
        audienceCount: audience.length,
        targetKind: args.targetKind,
        scheduledAt,
      },
      requestId: args.requestId,
      retentionClass: "operational",
    });
    return {
      announcementId,
      status: sendNow ? ("sent" as const) : ("scheduled" as const),
      audienceCount: audience.length,
      scheduledAt,
    };
  },
});

export const updateScheduledAnnouncement = mutation({
  args: {
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    announcementId: v.id("schoolAnnouncements"),
    title: v.string(),
    body: v.string(),
    targetKind: v.union(
      v.literal("school"),
      v.literal("roles"),
      v.literal("groups"),
    ),
    targetIds: v.array(v.string()),
    scheduledAt: v.number(),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor, school, operatorSessionId } = await schoolScope(
      ctx,
      args.operatorSessionId,
      true,
    );
    const announcement = await ctx.db.get(args.announcementId);
    if (
      !announcement ||
      announcement.schoolId !== school._id ||
      announcement.status !== "scheduled"
    )
      throw new Error(
        "ANNOUNCEMENT_NOT_EDITABLE: Only future scheduled announcements can be edited.",
      );
    const title = clean(args.title, 240);
    const body = args.body.trim().slice(0, 30_000);
    if (title.length < 2 || body.length < 2)
      throw new Error(
        "ANNOUNCEMENT_CONTENT_REQUIRED: Add a title and message.",
      );
    const now = Date.now();
    if (args.scheduledAt < now + 60_000)
      throw new Error(
        "ANNOUNCEMENT_SCHEDULE_INVALID: Choose a time at least one minute from now.",
      );
    const audience = await announcementAudience(
      ctx,
      school._id,
      args.targetKind,
      args.targetIds,
    );
    if (!audience.length)
      throw new Error(
        "ANNOUNCEMENT_AUDIENCE_EMPTY: Choose an audience with active members.",
      );
    const oldDeliveries = await ctx.db
      .query("schoolAnnouncementDeliveries")
      .withIndex("by_announcement", (q) =>
        q.eq("announcementId", announcement._id),
      )
      .collect();
    for (const delivery of oldDeliveries) await ctx.db.delete(delivery._id);
    for (const accountId of audience)
      await ctx.db.insert("schoolAnnouncementDeliveries", {
        schoolId: school._id,
        announcementId: announcement._id,
        accountId,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
    await ctx.db.patch(announcement._id, {
      title,
      body,
      targetKind: args.targetKind,
      targetIds: args.targetIds.slice(0, 100),
      audienceSnapshotCount: audience.length,
      scheduledAt: args.scheduledAt,
      updatedByAccountId: actor.accountId,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: school._id,
      operatorSessionId,
      action: "announcement.rescheduled",
      targetType: "announcement",
      targetId: announcement._id,
      metadata: {
        audienceCount: audience.length,
        scheduledAt: args.scheduledAt,
      },
      requestId: args.requestId,
      retentionClass: "operational",
    });
    return {
      announcementId: announcement._id,
      audienceCount: audience.length,
      scheduledAt: args.scheduledAt,
    };
  },
});

export const cancelAnnouncement = mutation({
  args: {
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    announcementId: v.id("schoolAnnouncements"),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor, school, operatorSessionId } = await schoolScope(
      ctx,
      args.operatorSessionId,
      true,
    );
    const announcement = await ctx.db.get(args.announcementId);
    if (
      !announcement ||
      announcement.schoolId !== school._id ||
      !["draft", "scheduled"].includes(announcement.status)
    )
      throw new Error(
        "ANNOUNCEMENT_NOT_CANCELLABLE: Sent announcements cannot be recalled.",
      );
    const now = Date.now();
    await ctx.db.patch(announcement._id, {
      status: "cancelled",
      cancelledAt: now,
      updatedByAccountId: actor.accountId,
      updatedAt: now,
    });
    const deliveries = await ctx.db
      .query("schoolAnnouncementDeliveries")
      .withIndex("by_announcement", (q) =>
        q.eq("announcementId", announcement._id),
      )
      .collect();
    for (const delivery of deliveries)
      if (delivery.status === "pending") await ctx.db.delete(delivery._id);
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: school._id,
      operatorSessionId,
      action: "announcement.cancelled",
      targetType: "announcement",
      targetId: announcement._id,
      metadata: { pendingDeliveriesRemoved: deliveries.length },
      requestId: args.requestId,
      retentionClass: "operational",
    });
    return { announcementId: announcement._id, cancelledAt: now };
  },
});

export const announcements = query({
  args: { operatorSessionId: v.optional(v.id("operatorSchoolSessions")) },
  handler: async (ctx, args) => {
    const { school } = await schoolScope(ctx, args.operatorSessionId);
    const rows = await ctx.db
      .query("schoolAnnouncements")
      .withIndex("by_school_created", (q) => q.eq("schoolId", school._id))
      .order("desc")
      .take(200);
    return Promise.all(
      rows.map(async (announcement) => {
        const deliveries = await ctx.db
          .query("schoolAnnouncementDeliveries")
          .withIndex("by_announcement", (q) =>
            q.eq("announcementId", announcement._id),
          )
          .collect();
        return {
          announcementId: announcement._id,
          title: announcement.title,
          targetKind: announcement.targetKind,
          targetIds: announcement.targetIds,
          audienceSnapshotCount: announcement.audienceSnapshotCount,
          status: announcement.status,
          scheduledAt: announcement.scheduledAt,
          sentAt: announcement.sentAt,
          delivered: deliveries.filter((item) =>
            ["delivered", "read"].includes(item.status),
          ).length,
          read: deliveries.filter((item) => item.status === "read").length,
          failed: deliveries.filter((item) => item.status === "failed").length,
          createdAt: announcement.createdAt,
        };
      }),
    );
  },
});

export const processScheduledAnnouncements = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("schoolAnnouncements")
      .withIndex("by_status_scheduled", (q) =>
        q.eq("status", "scheduled").lte("scheduledAt", now),
      )
      .take(50);
    for (const announcement of rows) {
      const deliveries = await ctx.db
        .query("schoolAnnouncementDeliveries")
        .withIndex("by_announcement", (q) =>
          q.eq("announcementId", announcement._id),
        )
        .collect();
      for (const delivery of deliveries)
        if (delivery.status === "pending" || !delivery.deliveredAt)
          await ctx.db.patch(delivery._id, {
            status: "delivered",
            deliveredAt: now,
            updatedAt: now,
          });
      await ctx.db.patch(announcement._id, {
        status: "sent",
        sentAt: now,
        updatedAt: now,
      });
    }
    return { processed: rows.length };
  },
});

export const myAnnouncements = query({
  args: { unreadOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx);
    const statuses = args.unreadOnly
      ? (["delivered"] as const)
      : (["delivered", "read"] as const);
    const deliveries = (
      await Promise.all(
        statuses.map((status) =>
          ctx.db
            .query("schoolAnnouncementDeliveries")
            .withIndex("by_account_status", (q) =>
              q.eq("accountId", actor.accountId).eq("status", status),
            )
            .order("desc")
            .take(100),
        ),
      )
    ).flat();
    return Promise.all(
      deliveries
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, 100)
        .map(async (delivery) => {
          const announcement = await ctx.db.get(delivery.announcementId);
          return announcement
            ? {
                deliveryId: delivery._id,
                announcementId: announcement._id,
                title: announcement.title,
                body: announcement.body,
                status: delivery.status,
                sentAt: announcement.sentAt,
                readAt: delivery.readAt,
              }
            : null;
        }),
    ).then((rows) => rows.filter(Boolean));
  },
});

export const markAnnouncementRead = mutation({
  args: { deliveryId: v.id("schoolAnnouncementDeliveries") },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx);
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.accountId !== actor.accountId)
      throw new Error(
        "ANNOUNCEMENT_NOT_FOUND: This announcement is unavailable.",
      );
    const now = Date.now();
    await ctx.db.patch(delivery._id, {
      status: "read",
      readAt: delivery.readAt ?? now,
      updatedAt: now,
    });
    return { deliveryId: delivery._id, readAt: delivery.readAt ?? now };
  },
});

export const submitFeedback = mutation({
  args: {
    category: v.union(
      v.literal("feature_request"),
      v.literal("improvement"),
      v.literal("issue"),
      v.literal("content_accuracy"),
      v.literal("performance"),
      v.literal("integration"),
      v.literal("other"),
    ),
    sentiment: v.union(
      v.literal("positive"),
      v.literal("neutral"),
      v.literal("negative"),
    ),
    subject: v.string(),
    message: v.string(),
    screenshotStorageId: v.optional(v.id("_storage")),
    pagePath: v.optional(v.string()),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id("_storage"),
          name: v.string(),
          mediaType: v.string(),
          bytes: v.number(),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx);
    const subject = clean(args.subject, 240);
    const message = args.message.trim().slice(0, 50_000);
    if (subject.length < 2 || message.length < 3)
      throw new Error("FEEDBACK_CONTENT_REQUIRED: Add a subject and detail.");
    const now = Date.now();
    const feedbackId = await ctx.db.insert("feedbackReports", {
      schoolId: actor.membershipSchool?._id,
      reporterAccountId: actor.accountId,
      category: args.category,
      sentiment: args.sentiment,
      subject,
      message,
      ...(args.screenshotStorageId ? { screenshotStorageId: args.screenshotStorageId } : {}),
      ...(args.pagePath ? { pagePath: clean(args.pagePath, 300) } : {}),
      ...(args.attachments?.length
        ? {
            attachments: args.attachments.slice(0, FEEDBACK_ATTACHMENT_LIMIT).map((file) => ({
              storageId: file.storageId,
              name: clean(file.name, 200) || "Attachment",
              mediaType: clean(file.mediaType, 120) || "application/octet-stream",
              bytes: Math.max(0, Math.floor(file.bytes)),
            })),
          }
        : {}),
      status: "new",
      visibility: "reporter_and_responders",
      createdAt: now,
      updatedAt: now,
    });
    return { feedbackId, status: "new" as const };
  },
});

const FEEDBACK_ATTACHMENT_LIMIT = 6;

/** Where the feedback form uploads its screenshot and attachments. */
export const feedbackUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await resolveActorContext(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const myFeedback = query({
  args: {},
  handler: async (ctx) => {
    const actor = await resolveActorContext(ctx);
    const rows = await ctx.db
      .query("feedbackReports")
      .withIndex("by_reporter_created", (q) =>
        q.eq("reporterAccountId", actor.accountId),
      )
      .order("desc")
      .take(100);
    return rows.map((item) => ({
      feedbackId: item._id,
      category: item.category,
      sentiment: item.sentiment,
      subject: item.subject,
      message: item.message,
      status: item.status,
      responderScope: item.responderScope,
      response: item.response,
      respondedAt: item.respondedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      visibility: item.visibility,
    }));
  },
});

export const feedbackInbox = mutation({
  args: {
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    status: v.optional(
      v.union(
        v.literal("new"),
        v.literal("triaged"),
        v.literal("in_progress"),
        v.literal("resolved"),
        v.literal("closed"),
      ),
    ),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor, school, operatorSessionId } = await schoolScope(
      ctx,
      args.operatorSessionId,
    );
    const statuses = args.status
      ? [args.status]
      : (["new", "triaged", "in_progress", "resolved"] as const);
    const rows = (
      await Promise.all(
        statuses.map((status) =>
          ctx.db
            .query("feedbackReports")
            .withIndex("by_school_status", (q) =>
              q.eq("schoolId", school._id).eq("status", status),
            )
            .order("desc")
            .take(250),
        ),
      )
    )
      .flat()
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 500);
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: school._id,
      operatorSessionId,
      action: "feedback.inbox.viewed",
      targetType: "feedback_inbox",
      targetId: school._id,
      metadata: { resultCount: rows.length },
      requestId: args.requestId,
      retentionClass: "operational",
    });
    return Promise.all(
      rows.map(async (item) => {
        const reporter = await ctx.db.get(item.reporterAccountId);
        return {
          feedbackId: item._id,
          reporter: reporter
            ? { name: reporter.name, email: reporter.email }
            : null,
          category: item.category,
          sentiment: item.sentiment,
          subject: item.subject,
          message: item.message,
          status: item.status,
          response: item.response,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      }),
    );
  },
});

/** Resolve evidence only when one report is opened, after checking its school. */
export const feedbackEvidence = query({
  args: {
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    feedbackId: v.id("feedbackReports"),
  },
  handler: async (ctx, args) => {
    const { school } = await schoolScope(ctx, args.operatorSessionId);
    const report = await ctx.db.get(args.feedbackId);
    if (!report || report.schoolId !== school._id)
      throw new Error("FEEDBACK_NOT_FOUND: This feedback is not available in this school.");
    const [screenshotUrl, attachments] = await Promise.all([
      report.screenshotStorageId ? ctx.storage.getUrl(report.screenshotStorageId) : null,
      Promise.all((report.attachments ?? []).map(async (file) => ({
        name: file.name, mediaType: file.mediaType, bytes: file.bytes,
        url: await ctx.storage.getUrl(file.storageId),
      }))),
    ]);
    return { feedbackId: report._id, pagePath: report.pagePath ?? null, screenshotUrl, attachments };
  },
});

export const respondFeedback = mutation({
  args: {
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    feedbackId: v.id("feedbackReports"),
    status: v.union(
      v.literal("triaged"),
      v.literal("in_progress"),
      v.literal("resolved"),
      v.literal("closed"),
    ),
    response: v.optional(v.string()),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor, school, operatorSessionId } = await schoolScope(
      ctx,
      args.operatorSessionId,
      true,
    );
    const feedback = await ctx.db.get(args.feedbackId);
    if (!feedback || feedback.schoolId !== school._id)
      throw new Error("FEEDBACK_NOT_FOUND: This report is unavailable.");
    const now = Date.now();
    await ctx.db.patch(feedback._id, {
      status: args.status,
      assignedAccountId: actor.accountId,
      responderScope: "school",
      response: args.response?.trim().slice(0, 20_000),
      respondedAt: args.response ? now : feedback.respondedAt,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: school._id,
      operatorSessionId,
      action: "feedback.responded",
      targetType: "feedback",
      targetId: feedback._id,
      metadata: { status: args.status, responseAdded: Boolean(args.response) },
      requestId: args.requestId,
      retentionClass: "operational",
    });
    return { feedbackId: feedback._id, status: args.status, updatedAt: now };
  },
});

export const createSchoolRequest = mutation({
  args: {
    type: v.union(
      v.literal("seat_change"),
      v.literal("integration"),
      v.literal("export"),
      v.literal("support"),
      v.literal("offboarding"),
      v.literal("other"),
    ),
    subject: v.string(),
    detail: v.string(),
    priority: v.union(
      v.literal("low"),
      v.literal("normal"),
      v.literal("high"),
      v.literal("urgent"),
    ),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx);
    const subject = clean(args.subject, 240);
    const detail = args.detail.trim().slice(0, 50_000);
    if (subject.length < 3 || detail.length < 8)
      throw new Error(
        "REQUEST_CONTENT_REQUIRED: Add a clear subject and enough detail.",
      );
    if (
      ["seat_change", "integration", "export", "offboarding"].includes(
        args.type,
      ) &&
      actor.membership?.role !== "school_admin"
    )
      throw new Error(
        "REQUEST_ADMIN_REQUIRED: A school administrator must submit this request.",
      );
    const recent = await ctx.db
      .query("schoolRequests")
      .withIndex("by_school_status", (q) =>
        q.eq("schoolId", actor.membershipSchool?._id).eq("status", "open"),
      )
      .collect();
    if (
      recent.filter(
        (item) =>
          item.requestedByAccountId === actor.accountId &&
          item.createdAt >= Date.now() - 60 * 60_000,
      ).length >= 10
    )
      throw new Error(
        "REQUEST_RATE_LIMIT: Wait before creating another support request.",
      );
    const now = Date.now();
    const requestRecordId = await ctx.db.insert("schoolRequests", {
      schoolId: actor.membershipSchool?._id,
      requestedByAccountId: actor.accountId,
      type: args.type,
      subject,
      detail,
      priority: args.priority,
      status: "open",
      responseDueAt:
        now +
        (args.priority === "urgent"
          ? 4 * 60 * 60_000
          : args.priority === "high"
            ? 24 * 60 * 60_000
            : 3 * 24 * 60 * 60_000),
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.membershipSchool?._id,
      action: "school.request.created",
      targetType: "school_request",
      targetId: requestRecordId,
      metadata: { type: args.type, priority: args.priority },
      requestId: args.requestId,
      retentionClass: "operational",
    });
    return { requestId: requestRecordId, status: "open" as const };
  },
});

export const mySchoolRequests = query({
  args: {},
  handler: async (ctx) => {
    const actor = await resolveActorContext(ctx);
    const rows = actor.membershipSchool
      ? (
          await Promise.all(
            (
              [
                "open",
                "acknowledged",
                "in_progress",
                "resolved",
                "closed",
              ] as const
            ).map((status) =>
              ctx.db
                .query("schoolRequests")
                .withIndex("by_school_status", (q) =>
                  q
                    .eq("schoolId", actor.membershipSchool?._id)
                    .eq("status", status),
                )
                .order("desc")
                .take(100),
            ),
          )
        ).flat()
      : [];
    const visible =
      actor.membership?.role === "school_admin"
        ? rows
        : rows.filter((item) => item.requestedByAccountId === actor.accountId);
    return visible
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 200)
      .map((item) => ({
        requestId: item._id,
        type: item.type,
        subject: item.subject,
        detail: item.detail,
        priority: item.priority,
        status: item.status,
        responseDueAt: item.responseDueAt,
        response: item.response,
        respondedAt: item.respondedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        mine: item.requestedByAccountId === actor.accountId,
      }));
  },
});

export const platformRequestInbox = mutation({
  args: {
    status: v.optional(
      v.union(
        v.literal("open"),
        v.literal("acknowledged"),
        v.literal("in_progress"),
        v.literal("resolved"),
        v.literal("closed"),
      ),
    ),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await platformOperator(ctx);
    const statuses = args.status
      ? [args.status]
      : (["open", "acknowledged", "in_progress", "resolved"] as const);
    const rows = (
      await Promise.all(
        statuses.map((status) =>
          ctx.db
            .query("schoolRequests")
            .withIndex("by_status_priority", (q) => q.eq("status", status))
            .order("desc")
            .take(250),
        ),
      )
    )
      .flat()
      .sort((left, right) => {
        const weight = { urgent: 4, high: 3, normal: 2, low: 1 };
        return (
          weight[right.priority] - weight[left.priority] ||
          right.createdAt - left.createdAt
        );
      })
      .slice(0, 500);
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      action: "platform.requests.viewed",
      targetType: "school_request_inbox",
      metadata: { resultCount: rows.length },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return Promise.all(
      rows.map(async (item) => {
        const [school, requester] = await Promise.all([
          item.schoolId ? ctx.db.get(item.schoolId) : null,
          ctx.db.get(item.requestedByAccountId),
        ]);
        return {
          requestId: item._id,
          school: school
            ? { schoolId: school._id, name: school.name, slug: school.slug }
            : null,
          requester: requester
            ? { name: requester.name, email: requester.email }
            : null,
          type: item.type,
          subject: item.subject,
          detail: item.detail,
          priority: item.priority,
          status: item.status,
          responseDueAt: item.responseDueAt,
          response: item.response,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      }),
    );
  },
});

export const respondSchoolRequest = mutation({
  args: {
    requestRecordId: v.id("schoolRequests"),
    status: v.union(
      v.literal("acknowledged"),
      v.literal("in_progress"),
      v.literal("resolved"),
      v.literal("closed"),
    ),
    response: v.optional(v.string()),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await platformOperator(ctx);
    const requestRecord = await ctx.db.get(args.requestRecordId);
    if (!requestRecord)
      throw new Error("REQUEST_NOT_FOUND: This request is unavailable.");
    const now = Date.now();
    const response = args.response?.trim().slice(0, 30_000);
    await ctx.db.patch(requestRecord._id, {
      status: args.status,
      assignedAccountId: actor.accountId,
      response: response ?? requestRecord.response,
      respondedAt: response ? now : requestRecord.respondedAt,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: requestRecord.schoolId,
      action: "school.request.responded",
      targetType: "school_request",
      targetId: requestRecord._id,
      metadata: { status: args.status, responseAdded: Boolean(response) },
      requestId: args.requestId,
      retentionClass: "operational",
    });
    return {
      requestId: requestRecord._id,
      status: args.status,
      updatedAt: now,
    };
  },
});

export const auditLog = mutation({
  args: {
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    actionPrefix: v.optional(v.string()),
    limit: v.optional(v.number()),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor, school, operatorSessionId } = await schoolScope(
      ctx,
      args.operatorSessionId,
    );
    const rows = await ctx.db
      .query("auditEvents")
      .withIndex("by_school_created", (q) => q.eq("schoolId", school._id))
      .order("desc")
      .take(Math.max(1, Math.min(args.limit ?? 100, 500)));
    const filtered = args.actionPrefix
      ? rows.filter((item) => item.action.startsWith(args.actionPrefix!))
      : rows;
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: school._id,
      operatorSessionId,
      action: "audit.log.viewed",
      targetType: "audit_log",
      targetId: school._id,
      metadata: { resultCount: filtered.length },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return filtered.map((event) => ({
      eventId: event._id,
      actorAccountId: event.actorAccountId,
      operatorSessionId: event.operatorSessionId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      metadata: event.metadata,
      requestId: event.requestId,
      retentionClass: event.retentionClass,
      createdAt: event.createdAt,
    }));
  },
});

export const platformOverview = mutation({
  args: {
    fromDay: v.string(),
    toDay: v.string(),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await platformOperator(ctx);
    const now = Date.now();
    const integrationStatuses = [
      "disconnected",
      "validating",
      "connected",
      "degraded",
      "blocked",
      "revoked",
    ] as const;
    const [
      schools,
      accounts,
      activeAccounts30d,
      integrationGroups,
      feedback,
      incidentGroups,
      requestGroups,
      selectedMeters,
      selectedCounters,
      failedRunCounters,
    ] = await Promise.all([
      ctx.db.query("schools").withIndex("by_status", (q) => q.eq("status", "active")).collect(),
      ctx.db.query("accounts").withIndex("by_status", (q) => q.eq("status", "active")).collect(),
      ctx.db
        .query("accounts")
        .withIndex("by_status_last_seen", (q) =>
          q.eq("status", "active").gte("lastSeenAt", now - 30 * 24 * 60 * 60_000),
        )
        .collect(),
      Promise.all(
        integrationStatuses.map((status) =>
          ctx.db
            .query("schoolIntegrations")
            .withIndex("by_status_next_sync", (q) => q.eq("status", status))
            .collect(),
        ),
      ),
      ctx.db
        .query("feedbackReports")
        .withIndex("by_created", (q) =>
          q
            .gte("createdAt", Date.parse(`${args.fromDay}T00:00:00.000Z`))
            .lte("createdAt", Date.parse(`${args.toDay}T23:59:59.999Z`)),
        )
        .collect(),
      Promise.all(
        (["investigating", "identified", "monitoring"] as const).map((status) =>
          ctx.db
            .query("platformIncidents")
            .withIndex("by_status_updated", (q) => q.eq("status", status))
            .collect(),
        ),
      ),
      Promise.all(
        (["open", "acknowledged", "in_progress"] as const).map((status) =>
          ctx.db
            .query("schoolRequests")
            .withIndex("by_status_priority", (q) => q.eq("status", status))
            .collect(),
        ),
      ),
      ctx.db
        .query("usageMeters")
        .withIndex("by_day", (q) => q.gte("day", args.fromDay).lte("day", args.toDay))
        .collect(),
      ctx.db
        .query("operationalCounters")
        .withIndex("by_day", (q) => q.gte("day", args.fromDay).lte("day", args.toDay))
        .collect(),
      ctx.db
        .query("operationalCounters")
        .withIndex("by_day", (q) => q.gte("day", day(now - 24 * 60 * 60_000)).lte("day", day(now)))
        .collect(),
    ]);
    const integrations = integrationGroups.flat();
    const incidents = incidentGroups.flat();
    const requests = requestGroups.flat();
    const counterTotal = (category: Doc<"operationalCounters">["category"]) =>
      selectedCounters
        .filter((counter) => counter.category === category)
        .reduce((sum, counter) => sum + counter.quantity, 0);
    const totals: Record<string, number> = {
      storage_bytes: 0,
      bandwidth_bytes: 0,
      model_input_tokens: 0,
      model_output_tokens: 0,
      render_milliseconds: 0,
      collaboration_bytes: 0,
    };
    const usageByDay: Record<string, Record<string, number>> = {};
    const usageBySchool = new Map<string, number>();
    for (const meter of selectedMeters) {
      totals[meter.category] = (totals[meter.category] ?? 0) + meter.quantity;
      usageByDay[meter.day] ??= {};
      usageByDay[meter.day]![meter.category] =
        (usageByDay[meter.day]![meter.category] ?? 0) + meter.quantity;
      if (meter.schoolId)
        usageBySchool.set(
          meter.schoolId,
          (usageBySchool.get(meter.schoolId) ?? 0) + meter.quantity,
        );
    }
    const schoolMap = new Map(
      schools.map((school) => [String(school._id), school]),
    );
    const activeAccounts = activeAccounts30d;
    const computedAt = Date.now();
    const directMetricState = { kind: "available" as const, updatedAt: computedAt };
    const counterMetricState = selectedCounters.length
      ? directMetricState
      : ({
          kind: "partial" as const,
          details:
            "No operational counters exist in this range, so uninstrumented activity is not shown as zero.",
        });
    const meterMetricState = selectedMeters.length
      ? directMetricState
      : ({
          kind: "partial" as const,
          details:
            "No usage meters exist in this range, so disabled metering is not shown as zero.",
        });
    const serviceHealth = [
      {
        service: "Model metering",
        status:
          (totals.model_input_tokens ?? 0) + (totals.model_output_tokens ?? 0) >
          0
            ? "operational"
            : "unknown",
      },
      {
        service: "ManageBac",
        status: integrations.some((item) =>
          ["blocked", "degraded"].includes(item.status),
        )
          ? "degraded"
          : "operational",
      },
      {
        service: "Storage metering",
        status: selectedMeters.length ? "operational" : "unknown",
      },
      {
        service: "Collaboration",
        status: selectedMeters.some((meter) => meter.category === "collaboration_bytes")
          ? "operational"
          : "unknown",
      },
    ];
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      action: "platform.overview.viewed",
      targetType: "platform",
      metadata: { fromDay: args.fromDay, toDay: args.toDay },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return {
      metrics: {
        activeSchools: schools.length,
        totalUsers: accounts.length,
        activeUsers30d: activeAccounts.length,
        artifactsCreated: selectedCounters.length
          ? counterTotal("artifact_created")
          : null,
        messages: selectedCounters.length
          ? counterTotal("thread_message")
          : null,
        retentionPercent: accounts.length
          ? Math.round((activeAccounts.length / accounts.length) * 100)
          : 0,
      },
      metricStates: {
        activeSchools: directMetricState,
        totalUsers: directMetricState,
        activeUsers30d: directMetricState,
        artifactsCreated: counterMetricState,
        messages: counterMetricState,
        retentionPercent: directMetricState,
        storageBytes: meterMetricState,
        integrationHealth: directMetricState,
        feedback: directMetricState,
        failedRuns24h: failedRunCounters.length
          ? directMetricState
          : counterMetricState,
        openRequests: directMetricState,
      },
      computedAt,
      usage: {
        totals,
        series: Object.entries(usageByDay)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([date, values]) => ({ day: date, values })),
        completeThrough: args.toDay,
      },
      storageBytes: totals.storage_bytes ?? 0,
      serviceHealth,
      integrations: {
        total: integrations.length,
        degraded: integrations.filter((item) =>
          ["blocked", "degraded"].includes(item.status),
        ).length,
      },
      feedback: {
        total: feedback.length,
        positive: feedback.filter((item) => item.sentiment === "positive")
          .length,
        neutral: feedback.filter((item) => item.sentiment === "neutral").length,
        negative: feedback.filter((item) => item.sentiment === "negative")
          .length,
        themes: Object.entries(
          feedback.reduce<Record<string, number>>((result, item) => {
            result[item.category] = (result[item.category] ?? 0) + 1;
            return result;
          }, {}),
        )
          .sort((left, right) => right[1] - left[1])
          .slice(0, 8),
      },
      topSchools: [...usageBySchool.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 10)
        .map(([schoolId, usage]) => ({
          schoolId,
          name: schoolMap.get(schoolId)?.name ?? "Unavailable school",
          usage,
        })),
      incidents: incidents.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 20),
      requests: requests.sort((left, right) => right.createdAt - left.createdAt).slice(0, 20),
      queues: {
        failedRuns24h: failedRunCounters.length
          ? failedRunCounters
              .filter(
                (counter) =>
                  counter.category === "ai_run_failed" &&
                  counter.day >= day(now - 24 * 60 * 60_000),
              )
              .reduce((sum, counter) => sum + counter.quantity, 0)
          : null,
        integrationErrors: integrations.filter((item) =>
          ["blocked", "degraded"].includes(item.status),
        ).length,
        openFeedback: feedback.filter((item) =>
          ["new", "triaged", "in_progress"].includes(item.status),
        ).length,
        openRequests: requests.filter((item) =>
          ["open", "acknowledged", "in_progress"].includes(item.status),
        ).length,
      },
      privacy:
        "Platform aggregates exclude private prompt text, thread content, memory claims, and artifact content. Uninstrumented historical counters are reported as unknown, never inferred by reading private records.",
    };
  },
});

export const platformSecurityLog = mutation({
  args: {
    limit: v.optional(v.number()),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await platformOperator(ctx);
    const limit = Math.max(20, Math.min(300, Math.floor(args.limit ?? 120)));
    const [events, sessions] = await Promise.all([
      ctx.db.query("auditEvents").order("desc").take(limit),
      ctx.db.query("operatorSchoolSessions").order("desc").take(limit),
    ]);
    const accountIds = new Set([
      ...events.map((event) => event.actorAccountId),
      ...sessions.map((session) => session.operatorAccountId),
    ]);
    const schoolIds = new Set([
      ...events.flatMap((event) => (event.schoolId ? [event.schoolId] : [])),
      ...sessions.map((session) => session.schoolId),
    ]);
    const [accounts, schools] = await Promise.all([
      Promise.all([...accountIds].map((id) => ctx.db.get(id))),
      Promise.all([...schoolIds].map((id) => ctx.db.get(id))),
    ]);
    const accountMap = new Map(
      accounts.filter(Boolean).map((account) => [account!._id, account!]),
    );
    const schoolMap = new Map(
      schools.filter(Boolean).map((school) => [school!._id, school!]),
    );
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      action: "platform.security_log.viewed",
      targetType: "audit_log",
      metadata: { limit },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return {
      events: events.map((event) => ({
        eventId: event._id,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        actor: accountMap.get(event.actorAccountId)
          ? {
              name: accountMap.get(event.actorAccountId)!.name,
              email: accountMap.get(event.actorAccountId)!.email,
            }
          : null,
        school: event.schoolId
          ? {
              schoolId: event.schoolId,
              name: schoolMap.get(event.schoolId)?.name ?? "Unavailable school",
            }
          : null,
        metadata: event.metadata,
        createdAt: event.createdAt,
      })),
      sessions: sessions.map((session) => ({
        sessionId: session._id,
        operator: accountMap.get(session.operatorAccountId)
          ? {
              name: accountMap.get(session.operatorAccountId)!.name,
              email: accountMap.get(session.operatorAccountId)!.email,
            }
          : null,
        school: {
          schoolId: session.schoolId,
          name: schoolMap.get(session.schoolId)?.name ?? "Unavailable school",
        },
        label: session.label,
        reason: session.reason,
        mode: session.mode,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt,
      })),
    };
  },
});

export const schoolDirectory = query({
  args: {
    includeInactive: v.optional(v.boolean()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await platformOperator(ctx);
    const schools = args.includeInactive
      ? await ctx.db.query("schools").collect()
      : await ctx.db
          .query("schools")
          .withIndex("by_status", (q) => q.eq("status", "active"))
          .collect();
    const needle = clean(args.search ?? "", 200).toLowerCase();
    return Promise.all(
      schools
        .filter(
          (school) =>
            !needle ||
            `${school.name}\n${school.slug}\n${school.verifiedDomains.join(" ")}`
              .toLowerCase()
              .includes(needle),
        )
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(async (school) => {
          const [members, integration, policy] = await Promise.all([
            ctx.db
              .query("schoolMemberships")
              .withIndex("by_school_status", (q) =>
                q.eq("schoolId", school._id).eq("status", "active"),
              )
              .collect(),
            ctx.db
              .query("schoolIntegrations")
              .withIndex("by_school_provider", (q) =>
                q.eq("schoolId", school._id).eq("provider", "managebac"),
              )
              .unique(),
            ctx.db
              .query("limitPolicies")
              .withIndex("by_scope_school", (q) =>
                q.eq("scope", "school").eq("schoolId", school._id),
              )
              .unique(),
          ]);
          return {
            schoolId: school._id,
            name: school.name,
            slug: school.slug,
            status: school.status,
            timezone: school.timezone,
            domains: school.verifiedDomains,
            members: members.length,
            integrationStatus: integration?.status ?? "not_configured",
            limitEnforcement: policy?.enforcement ?? "disabled",
            limitRules: policy?.rules ?? [],
            updatedAt: school.updatedAt,
          };
        }),
    );
  },
});

export const onboardingSagas = query({
  args: {},
  handler: async (ctx) => {
    await platformOperator(ctx);
    const sagas = await ctx.db
      .query("schoolOnboardingSagas")
      .order("desc")
      .take(200);
    return Promise.all(
      sagas.map(async (saga) => {
        const school = await ctx.db.get(saga.schoolId);
        return {
          sagaId: saga._id,
          schoolId: saga.schoolId,
          schoolName: school?.name ?? "Unavailable school",
          schoolSlug: school?.slug ?? "",
          initialAdminEmail: saga.initialAdminEmail,
          status: saga.status,
          completedSteps: saga.completedSteps,
          errorSummary: saga.errorSummary,
          createdAt: saga.createdAt,
          updatedAt: saga.updatedAt,
        };
      }),
    );
  },
});

const vLimitRule = v.object({
  category: v.union(
    v.literal("storage_bytes"),
    v.literal("bandwidth_bytes"),
    v.literal("model_tokens"),
    v.literal("render_milliseconds"),
    v.literal("collaboration_bytes"),
  ),
  period: v.union(v.literal("day"), v.literal("month"), v.literal("total")),
  warningAt: v.optional(v.number()),
  maximum: v.number(),
});

export const simulateLimitPolicy = query({
  args: {
    schoolId: v.id("schools"),
    rules: v.array(vLimitRule),
  },
  handler: async (ctx, args) => {
    await platformOperator(ctx);
    const meters = await ctx.db
      .query("usageMeters")
      .withIndex("by_school_day", (q) => q.eq("schoolId", args.schoolId))
      .collect();
    const today = day(Date.now());
    const monthStart = `${today.slice(0, 7)}-01`;
    return {
      schoolId: args.schoolId,
      evaluatedAt: Date.now(),
      evaluations: args.rules.map((rule) => {
        const value = meters
          .filter((meter) => {
            if (rule.period === "day") return meter.day === today;
            if (rule.period === "month") return meter.day >= monthStart;
            return true;
          })
          .filter((meter) =>
            rule.category === "model_tokens"
              ? ["model_input_tokens", "model_output_tokens"].includes(
                  meter.category,
                )
              : meter.category === rule.category,
          )
          .reduce((sum, meter) => sum + meter.quantity, 0);
        return {
          ...rule,
          current: value,
          warning: rule.warningAt !== undefined && value >= rule.warningAt,
          wouldBlock: value >= rule.maximum,
          remaining: Math.max(0, rule.maximum - value),
        };
      }),
    };
  },
});

export const createIncident = mutation({
  args: {
    title: v.string(),
    summary: v.string(),
    affectedServices: v.array(v.string()),
    severity: v.union(
      v.literal("minor"),
      v.literal("major"),
      v.literal("critical"),
    ),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await platformOperator(ctx);
    const title = clean(args.title, 240);
    const summary = args.summary.trim().slice(0, 20_000);
    if (title.length < 3 || summary.length < 3)
      throw new Error("INCIDENT_CONTENT_REQUIRED: Add a title and summary.");
    const now = Date.now();
    const incidentId = await ctx.db.insert("platformIncidents", {
      title,
      summary,
      affectedServices: args.affectedServices
        .map((item) => clean(item, 100))
        .filter(Boolean)
        .slice(0, 30),
      severity: args.severity,
      status: "investigating",
      createdByAccountId: actor.accountId,
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      action: "platform.incident.created",
      targetType: "incident",
      targetId: incidentId,
      metadata: { severity: args.severity },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return { incidentId };
  },
});

export const updateIncident = mutation({
  args: {
    incidentId: v.id("platformIncidents"),
    status: v.union(
      v.literal("investigating"),
      v.literal("identified"),
      v.literal("monitoring"),
      v.literal("resolved"),
    ),
    summary: v.optional(v.string()),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await platformOperator(ctx);
    const incident = await ctx.db.get(args.incidentId);
    if (!incident)
      throw new Error("INCIDENT_NOT_FOUND: This incident is unavailable.");
    const now = Date.now();
    await ctx.db.patch(incident._id, {
      status: args.status,
      summary: args.summary?.trim().slice(0, 20_000) ?? incident.summary,
      resolvedAt: args.status === "resolved" ? now : undefined,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      action: "platform.incident.updated",
      targetType: "incident",
      targetId: incident._id,
      metadata: { previousStatus: incident.status, status: args.status },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return { incidentId: incident._id, status: args.status };
  },
});

async function lifecycleImpact(ctx: Ctx, schoolId: Id<"schools">) {
  const [members, artifacts, workspaces, integrations] = await Promise.all([
    ctx.db
      .query("schoolMemberships")
      .withIndex("by_school_status", (q) =>
        q.eq("schoolId", schoolId).eq("status", "active"),
      )
      .collect(),
    // Every lifecycle request (including an urgent suspend) reads this, so it
    // must stay inside the school: a table scan read every tenant's artifact
    // content and failed once the platform passed Convex's read limits.
    // Collecting the school's own artifacts failed the same way for a large
    // school, so the count stops at a read budget and is marked as a floor.
    ctx.db
      .query("spectraArtifacts")
      .withIndex("by_school_status", (q) => q.eq("schoolId", schoolId))
      .paginate({
        cursor: null,
        numItems: 10_000,
        maximumRowsRead: 10_000,
        maximumBytesRead: 4_000_000,
      }),
    ctx.db
      .query("spectraWorkspaces")
      .withIndex("by_school_status", (q) =>
        q.eq("schoolId", schoolId).eq("status", "active"),
      )
      .collect(),
    ctx.db
      .query("schoolIntegrations")
      .withIndex("by_school_provider", (q) => q.eq("schoolId", schoolId))
      .collect(),
  ]);
  return {
    activeMembers: members.length,
    artifacts: artifacts.page.length,
    ...(artifacts.isDone ? {} : { artifactsAtLeast: true }),
    workspaces: workspaces.length,
    integrations: integrations.length,
  };
}

/* A school export is written as a series of parts. Each section streams one
   kind of row through index ranges scoped to the school, and a nested section
   streams each parent's children. The old export read the whole school in one
   query. That broke Convex's per-query read limits, so a real school could not
   be exported, and therefore could not be purged either.
   Now a page read stays well inside those limits: one `.paginate()` per query,
   with bounded rows and bytes. The action commits each part together with the
   position it covers, so a killed action resumes from its last committed part
   instead of starting over. */
type ExportRow = { _id: string } & Record<string, unknown>;
type ExportStream = {
  paginate(options: PaginationOptions): Promise<PaginationResult<ExportRow>>;
  take(count: number): Promise<ExportRow[]>;
};
type ExportRange = (
  db: QueryCtx["db"],
  schoolId: Id<"schools">,
) => ExportStream;
type ExportSection = {
  name: string;
  ranges: ExportRange[];
  map?: (ctx: QueryCtx, row: ExportRow) => Promise<unknown> | unknown;
  children?: (db: QueryCtx["db"], parentId: string) => ExportStream;
};
type ExportPosition = {
  section: number;
  range: number;
  cursor: string | null;
  parentCursor?: string | null;
  parentsDone?: boolean;
  pendingParents?: string[];
};

const exportStream = (query: unknown) => query as ExportStream;
// Each query reads at most this many bytes through `.paginate()`. The small
// parents read after the first add at most EXPORT_SMALL_PARENT + 1 documents
// each, so a page stays far below the 16 MiB read and return limits.
const EXPORT_PAGE_BYTES = 2_000_000;
const EXPORT_PAGE_ROWS = 2_000;
const EXPORT_PARENT_PAGE = 64;
const EXPORT_SMALL_PARENT = 4;
const EXPORT_PART_BYTES = 4_000_000;
const EXPORT_LEASE_MS = 6 * 60_000;
const EXPORT_ACTION_BUDGET_MS = 4 * 60_000;
const EXPORT_MAX_TAKEOVERS = 5;
const EXPORT_START: ExportPosition = { section: 0, range: 0, cursor: null };

const memberships: ExportRange = (db, schoolId) =>
  exportStream(
    db
      .query("schoolMemberships")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId)),
  );
const workspaceRanges: ExportRange[] = (["active", "archived"] as const).map(
  (status) => (db, schoolId) =>
    exportStream(
      db
        .query("spectraWorkspaces")
        .withIndex("by_school_status", (q) =>
          q.eq("schoolId", schoolId).eq("status", status),
        ),
    ),
);
const artifactRanges: ExportRange[] = (
  ["active", "draft", "archived", "deleted"] as const
).map(
  (status) => (db, schoolId) =>
    exportStream(
      db
        .query("spectraArtifacts")
        .withIndex("by_school_status", (q) =>
          q.eq("schoolId", schoolId).eq("status", status),
        ),
    ),
);
const threadRanges: ExportRange[] = (
  ["active", "archived", "deleted"] as const
).map(
  (status) => (db, schoolId) =>
    exportStream(
      db
        .query("spectraThreads")
        .withIndex("by_school_status", (q) =>
          q.eq("schoolId", schoolId).eq("status", status),
        ),
    ),
);

/** Exactly the rows of the version 1 export, in the same groups. */
const EXPORT_SECTIONS: ExportSection[] = [
  { name: "identity.memberships", ranges: [memberships] },
  {
    name: "identity.accounts",
    ranges: [memberships],
    map: (ctx, row) => ctx.db.get(row.accountId as Id<"accounts">),
  },
  {
    name: "identity.invitations",
    ranges: [
      (db, schoolId) =>
        exportStream(
          db
            .query("membershipInvitations")
            .withIndex("by_school_status", (q) =>
              q.eq("schoolId", schoolId).eq("status", "pending"),
            ),
        ),
    ],
    map: (_ctx, { tokenHash: _tokenHash, ...invitation }) => invitation,
  },
  {
    name: "identity.groups",
    ranges: [
      (db, schoolId) =>
        exportStream(
          db
            .query("schoolGroups")
            .withIndex("by_school_status", (q) =>
              q.eq("schoolId", schoolId).eq("status", "active"),
            ),
        ),
    ],
  },
  {
    name: "identity.groupMembers",
    ranges: [
      (db, schoolId) =>
        exportStream(
          db
            .query("schoolGroupMembers")
            .withIndex("by_school", (q) => q.eq("schoolId", schoolId)),
        ),
    ],
  },
  {
    name: "administration.announcements",
    ranges: [
      (db, schoolId) =>
        exportStream(
          db
            .query("schoolAnnouncements")
            .withIndex("by_school_created", (q) => q.eq("schoolId", schoolId)),
        ),
    ],
  },
  {
    name: "administration.deliveries",
    ranges: [
      (db, schoolId) =>
        exportStream(
          db
            .query("schoolAnnouncementDeliveries")
            .withIndex("by_school_created", (q) => q.eq("schoolId", schoolId)),
        ),
    ],
  },
  {
    name: "administration.feedback",
    ranges: [
      (db, schoolId) =>
        exportStream(
          db
            .query("feedbackReports")
            .withIndex("by_school_status", (q) => q.eq("schoolId", schoolId)),
        ),
    ],
  },
  {
    name: "administration.requests",
    ranges: [
      (db, schoolId) =>
        exportStream(
          db
            .query("schoolRequests")
            .withIndex("by_school_status", (q) => q.eq("schoolId", schoolId)),
        ),
    ],
  },
  {
    name: "administration.limits",
    ranges: [
      (db, schoolId) =>
        exportStream(
          db
            .query("limitPolicies")
            .withIndex("by_scope_school", (q) =>
              q.eq("scope", "school").eq("schoolId", schoolId),
            ),
        ),
    ],
  },
  {
    name: "administration.auditEvents",
    ranges: [
      (db, schoolId) =>
        exportStream(
          db
            .query("auditEvents")
            .withIndex("by_school_created", (q) => q.eq("schoolId", schoolId)),
        ),
    ],
  },
  { name: "product.workspaces", ranges: workspaceRanges },
  {
    name: "product.orgNodes",
    ranges: workspaceRanges,
    children: (db, workspaceId) =>
      exportStream(
        db
          .query("orgNodes")
          .withIndex("by_workspace_context", (q) =>
            q.eq("workspaceContextId", workspaceId as Id<"spectraWorkspaces">),
          ),
      ),
  },
  { name: "product.artifacts", ranges: artifactRanges },
  {
    name: "product.artifactVersions",
    ranges: artifactRanges,
    children: (db, artifactId) =>
      exportStream(
        db
          .query("spectraArtifactVersions")
          .withIndex("by_artifact_created", (q) =>
            q.eq("artifactId", artifactId as Id<"spectraArtifacts">),
          ),
      ),
  },
  { name: "product.threads", ranges: threadRanges },
  {
    name: "product.messages",
    ranges: threadRanges,
    children: (db, threadId) =>
      exportStream(
        db
          .query("spectraMessages")
          .withIndex("by_thread", (q) =>
            q.eq("threadId", threadId as Id<"spectraThreads">),
          ),
      ),
  },
  {
    name: "product.memoryClaims",
    ranges: [
      (db, schoolId) =>
        exportStream(
          db
            .query("memoryClaims")
            .withIndex("by_school_status", (q) => q.eq("schoolId", schoolId)),
        ),
    ],
  },
  {
    name: "integrations.integrations",
    ranges: [
      (db, schoolId) =>
        exportStream(
          db
            .query("schoolIntegrations")
            .withIndex("by_school_provider", (q) => q.eq("schoolId", schoolId)),
        ),
    ],
  },
  {
    name: "integrations.capabilities",
    ranges: [
      (db, schoolId) =>
        exportStream(
          db
            .query("integrationCapabilities")
            .withIndex("by_school_status", (q) => q.eq("schoolId", schoolId)),
        ),
    ],
  },
  {
    name: "integrations.externalRecords",
    ranges: [
      (db, schoolId) =>
        exportStream(
          db
            .query("externalRecords")
            .withIndex("by_school_updated", (q) => q.eq("schoolId", schoolId)),
        ),
    ],
  },
  {
    name: "integrations.overlays",
    ranges: [
      (db, schoolId) =>
        exportStream(
          db
            .query("externalRecordOverlays")
            .withIndex("by_school", (q) => q.eq("schoolId", schoolId)),
        ),
    ],
  },
  {
    name: "usage",
    ranges: [
      (db, schoolId) =>
        exportStream(
          db
            .query("usageMeters")
            .withIndex("by_school_day", (q) => q.eq("schoolId", schoolId)),
        ),
    ],
  },
];

const exportPositionValidator = v.object({
  section: v.number(),
  range: v.number(),
  cursor: v.union(v.string(), v.null()),
  parentCursor: v.optional(v.union(v.string(), v.null())),
  parentsDone: v.optional(v.boolean()),
  pendingParents: v.optional(v.array(v.string())),
});

function nextRange(position: ExportPosition): ExportPosition | null {
  const section = EXPORT_SECTIONS[position.section]!;
  if (position.range + 1 < section.ranges.length)
    return { section: position.section, range: position.range + 1, cursor: null };
  return position.section + 1 < EXPORT_SECTIONS.length
    ? { section: position.section + 1, range: 0, cursor: null }
    : null;
}

const pageOptions = (cursor: string | null, numItems: number) => ({
  cursor,
  numItems,
  maximumRowsRead: numItems,
  maximumBytesRead: EXPORT_PAGE_BYTES,
});

/** One bounded page of one section, and the position after it. */
export const exportPage = internalQuery({
  args: { schoolId: v.id("schools"), position: exportPositionValidator },
  handler: async (ctx, args) => {
    const position = args.position;
    const section = EXPORT_SECTIONS[position.section];
    const range = section?.ranges[position.range];
    if (!section || !range)
      throw new Error("LIFECYCLE_EXPORT_POSITION: The export position is invalid.");
    if (!section.children) {
      const page = await range(ctx.db, args.schoolId).paginate(
        pageOptions(position.cursor, EXPORT_PAGE_ROWS),
      );
      const rows = section.map
        ? (await Promise.all(page.page.map((row) => section.map!(ctx, row)))).filter(
            (row) => row !== null && row !== undefined,
          )
        : page.page;
      return {
        section: section.name,
        rows,
        next: page.isDone
          ? nextRange(position)
          : { ...position, cursor: page.continueCursor },
      };
    }
    const pending = position.pendingParents ?? [];
    if (pending.length === 0) {
      if (position.parentsDone)
        return { section: section.name, rows: [], next: nextRange(position) };
      const parents = await range(ctx.db, args.schoolId).paginate(
        pageOptions(position.parentCursor ?? null, EXPORT_PARENT_PAGE),
      );
      return {
        section: section.name,
        rows: [],
        next: {
          section: position.section,
          range: position.range,
          cursor: null,
          parentCursor: parents.continueCursor,
          parentsDone: parents.isDone,
          pendingParents: parents.page.map((parent) => parent._id),
        },
      };
    }
    // The first pending parent pages through its rows; a large one spans
    // several pages. Later parents join this page only when they are small.
    const first = await section
      .children(ctx.db, pending[0]!)
      .paginate(pageOptions(position.cursor, EXPORT_PAGE_ROWS));
    const rows: ExportRow[] = [...first.page];
    if (!first.isDone)
      return {
        section: section.name,
        rows,
        next: { ...position, cursor: first.continueCursor },
      };
    let bytes = JSON.stringify(rows).length;
    let consumed = 1;
    while (
      consumed < pending.length &&
      bytes < EXPORT_PAGE_BYTES &&
      rows.length < EXPORT_PAGE_ROWS
    ) {
      const children = await section
        .children(ctx.db, pending[consumed]!)
        .take(EXPORT_SMALL_PARENT + 1);
      if (children.length > EXPORT_SMALL_PARENT) break;
      rows.push(...children);
      bytes += JSON.stringify(children).length;
      consumed += 1;
    }
    return {
      section: section.name,
      rows,
      next: {
        ...position,
        cursor: null,
        pendingParents: pending.slice(consumed),
      },
    };
  },
});

/** Claims an export: continues its own lease, takes over an expired lease,
 * or starts the oldest queued export. */
export const claimLifecycleExport = internalMutation({
  args: {
    jobId: v.optional(v.id("schoolLifecycleJobs")),
    leaseId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const claim = async (job: Doc<"schoolLifecycleJobs">, takeover: boolean) => {
      const school = await ctx.db.get(job.schoolId);
      const previous = job.exportProgress;
      const takeovers = (previous?.takeovers ?? 0) + (takeover ? 1 : 0);
      if (!school || takeovers > EXPORT_MAX_TAKEOVERS) {
        await ctx.db.patch(job._id, {
          status: "failed",
          errorSummary: school
            ? "The export stopped repeatedly before it finished."
            : "School no longer exists.",
          completedAt: now,
          updatedAt: now,
        });
        await ctx.scheduler.runAfter(
          0,
          internal.administration.deleteLifecycleExportParts,
          { jobId: job._id },
        );
        await writeAuditEvent(ctx, {
          actorAccountId: job.requestedByAccountId,
          schoolId: job.schoolId,
          action: "school.export.failed",
          targetType: "lifecycle_job",
          targetId: job._id,
          metadata: { storageObjectCreated: false, takeovers },
          retentionClass: "legal",
        });
        return null;
      }
      const leaseId = crypto.randomUUID();
      const progress = {
        position: previous ? previous.position : EXPORT_START,
        parts: previous?.parts ?? 0,
        rows: previous?.rows ?? 0,
        bytes: previous?.bytes ?? 0,
        leaseId,
        leaseExpiresAt: now + EXPORT_LEASE_MS,
        takeovers,
      };
      await ctx.db.patch(job._id, {
        status: "running",
        startedAt: job.startedAt ?? now,
        exportProgress: progress,
        updatedAt: now,
      });
      return {
        jobId: job._id,
        leaseId,
        school,
        startedAt: job.startedAt ?? now,
        position: progress.position,
        parts: progress.parts,
      };
    };
    if (args.jobId) {
      const job = await ctx.db.get(args.jobId);
      if (
        !job ||
        job.type !== "export" ||
        job.status !== "running" ||
        job.exportProgress?.leaseId !== args.leaseId
      )
        return null;
      return claim(job, false);
    }
    // Running exports are few, so this reads a small index prefix.
    const running = await ctx.db
      .query("schoolLifecycleJobs")
      .withIndex("by_status_created", (q) => q.eq("status", "running"))
      .filter((q) => q.eq(q.field("type"), "export"))
      .take(20);
    const stalled = running.find(
      (job) => (job.exportProgress?.leaseExpiresAt ?? 0) <= now,
    );
    if (stalled) return claim(stalled, true);
    const queued = await ctx.db
      .query("schoolLifecycleJobs")
      .withIndex("by_status_created", (q) => q.eq("status", "queued"))
      .filter((q) => q.eq(q.field("type"), "export"))
      .first();
    return queued ? claim(queued, false) : null;
  },
});

/** Records one written part and the position it covers, only for the lease
 * holder, and optionally schedules the next action. */
export const commitLifecycleExportPart = internalMutation({
  args: {
    jobId: v.id("schoolLifecycleJobs"),
    leaseId: v.string(),
    expectedParts: v.number(),
    part: v.optional(
      v.object({
        storageId: v.id("_storage"),
        section: v.string(),
        rows: v.number(),
        bytes: v.number(),
      }),
    ),
    position: v.union(exportPositionValidator, v.null()),
    continueAfter: v.boolean(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    const progress = job?.exportProgress;
    if (
      !job ||
      job.type !== "export" ||
      job.status !== "running" ||
      !progress ||
      progress.leaseId !== args.leaseId ||
      progress.parts !== args.expectedParts
    )
      return false;
    const now = Date.now();
    if (args.part)
      await ctx.db.insert("schoolExportParts", {
        jobId: job._id,
        schoolId: job.schoolId,
        index: progress.parts,
        section: args.part.section,
        rows: args.part.rows,
        bytes: args.part.bytes,
        storageId: args.part.storageId,
        createdAt: now,
      });
    await ctx.db.patch(job._id, {
      exportProgress: {
        ...progress,
        position: args.position,
        parts: progress.parts + (args.part ? 1 : 0),
        rows: progress.rows + (args.part?.rows ?? 0),
        bytes: progress.bytes + (args.part?.bytes ?? 0),
        leaseExpiresAt: now + EXPORT_LEASE_MS,
      },
      updatedAt: now,
    });
    if (args.continueAfter)
      await ctx.scheduler.runAfter(
        0,
        internal.administration.processLifecycleExports,
        { jobId: job._id, leaseId: args.leaseId },
      );
    return true;
  },
});

export const lifecycleExportPartsPage = internalQuery({
  args: {
    jobId: v.id("schoolLifecycleJobs"),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("schoolExportParts")
      .withIndex("by_job_index", (q) => q.eq("jobId", args.jobId))
      .paginate({ cursor: args.cursor, numItems: 500 });
    return {
      parts: page.page.map(({ index, section, rows, bytes, storageId }) => ({
        index,
        section,
        rows,
        bytes,
        storageId,
      })),
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

/** Removes the part objects of an export that failed or was cancelled. */
export const deleteLifecycleExportParts = internalMutation({
  args: { jobId: v.id("schoolLifecycleJobs") },
  handler: async (ctx, args) => {
    const parts = await ctx.db
      .query("schoolExportParts")
      .withIndex("by_job_index", (q) => q.eq("jobId", args.jobId))
      .take(100);
    for (const part of parts) {
      if (await ctx.db.system.get(part.storageId))
        await ctx.storage.delete(part.storageId);
      await ctx.db.delete(part._id);
    }
    if (parts.length === 100)
      await ctx.scheduler.runAfter(
        0,
        internal.administration.deleteLifecycleExportParts,
        args,
      );
    return parts.length;
  },
});

export const settleLifecycleExport = internalMutation({
  args: {
    jobId: v.id("schoolLifecycleJobs"),
    leaseId: v.string(),
    storageId: v.optional(v.id("_storage")),
    errorSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.type !== "export" ||
      job.status !== "running" ||
      job.exportProgress?.leaseId !== args.leaseId
    )
      return false;
    const now = Date.now();
    const succeeded = Boolean(args.storageId);
    await ctx.db.patch(job._id, {
      status: succeeded ? "completed" : "failed",
      exportStorageId: args.storageId,
      errorSummary: succeeded
        ? undefined
        : clean(args.errorSummary ?? "Export failed.", 500),
      completedAt: now,
      updatedAt: now,
    });
    if (!succeeded)
      await ctx.scheduler.runAfter(
        0,
        internal.administration.deleteLifecycleExportParts,
        { jobId: job._id },
      );
    await writeAuditEvent(ctx, {
      actorAccountId: job.requestedByAccountId,
      schoolId: job.schoolId,
      action: succeeded ? "school.export.completed" : "school.export.failed",
      targetType: "lifecycle_job",
      targetId: job._id,
      metadata: {
        storageObjectCreated: succeeded,
        parts: job.exportProgress?.parts ?? 0,
        rows: job.exportProgress?.rows ?? 0,
      },
      retentionClass: "legal",
    });
    return true;
  },
});

export const processLifecycleExports = internalAction({
  args: {
    jobId: v.optional(v.id("schoolLifecycleJobs")),
    leaseId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const claimed = await ctx.runMutation(
      internal.administration.claimLifecycleExport,
      { jobId: args.jobId, leaseId: args.leaseId },
    );
    if (!claimed) return { processed: 0 };
    const { jobId, leaseId, school } = claimed;
    const deadline = Date.now() + EXPORT_ACTION_BUDGET_MS;
    let parts = claimed.parts;
    let buffer: { section: string; rows: string[]; bytes: number } | null =
      null;
    // Writes the buffered rows as one part and records the position after
    // them. False means another action now holds this export.
    const commit = async (
      position: ExportPosition | null,
      continueAfter: boolean,
    ) => {
      const pending = buffer;
      const storageId = pending
        ? await ctx.storage.store(
            new Blob(
              [
                `{"format":"spectra-school-export-part","version":2,"jobId":${JSON.stringify(jobId)},"schoolId":${JSON.stringify(school._id)},"index":${parts},"section":${JSON.stringify(pending.section)},"rows":[${pending.rows.join(",")}]}`,
              ],
              { type: "application/json" },
            ),
          )
        : undefined;
      const committed = await ctx.runMutation(
        internal.administration.commitLifecycleExportPart,
        {
          jobId,
          leaseId,
          expectedParts: parts,
          part:
            pending && storageId
              ? {
                  storageId,
                  section: pending.section,
                  rows: pending.rows.length,
                  bytes: pending.bytes,
                }
              : undefined,
          position,
          continueAfter,
        },
      );
      if (!committed) {
        if (storageId) await ctx.storage.delete(storageId);
        return false;
      }
      if (storageId) parts += 1;
      buffer = null;
      return true;
    };
    try {
      let position: ExportPosition | null = claimed.position;
      while (position) {
        if (Date.now() > deadline) {
          await commit(position, true);
          return { processed: 1 };
        }
        const page: {
          section: string;
          rows: unknown[];
          next: ExportPosition | null;
        } = await ctx.runQuery(internal.administration.exportPage, {
          schoolId: school._id,
          position,
        });
        if (page.rows.length > 0) {
          if (buffer && buffer.section !== page.section)
            if (!(await commit(position, false))) return { processed: 0 };
          const target: { section: string; rows: string[]; bytes: number } =
            buffer ?? { section: page.section, rows: [], bytes: 0 };
          for (const row of page.rows) {
            const json = JSON.stringify(row);
            target.rows.push(json);
            target.bytes += json.length;
          }
          buffer = target;
        }
        position = page.next;
        if (buffer && buffer.bytes >= EXPORT_PART_BYTES)
          if (!(await commit(position, false))) return { processed: 0 };
      }
      if (!(await commit(null, false))) return { processed: 0 };
      const written: {
        index: number;
        section: string;
        rows: number;
        bytes: number;
        storageId: Id<"_storage">;
      }[] = [];
      for (let cursor: string | null = null, done = false; !done; ) {
        const page: {
          parts: typeof written;
          continueCursor: string;
          isDone: boolean;
        } = await ctx.runQuery(
          internal.administration.lifecycleExportPartsPage,
          { jobId, cursor },
        );
        written.push(...page.parts);
        cursor = page.continueCursor;
        done = page.isDone;
      }
      const manifest = {
        format: "spectra-school-export",
        version: 2,
        generatedAt: Date.now(),
        startedAt: claimed.startedAt,
        school,
        sections: EXPORT_SECTIONS.map(({ name }) => {
          const sectionParts = written.filter((part) => part.section === name);
          return {
            name,
            rows: sectionParts.reduce((sum, part) => sum + part.rows, 0),
            parts: sectionParts.map((part) => part.index),
          };
        }),
        parts: written.map(({ index, section, rows, bytes }) => ({
          index,
          section,
          rows,
          bytes,
        })),
        consistency:
          "Rows were read in pages between startedAt and generatedAt. Suspend the school first for a point-in-time copy.",
        exclusions: [
          "Secret ciphertext and credential material",
          "Platform-operator configuration",
          "Other schools' records",
        ],
      };
      const storageId = await ctx.storage.store(
        new Blob([JSON.stringify(manifest)], { type: "application/json" }),
      );
      if (
        !(await ctx.runMutation(internal.administration.settleLifecycleExport, {
          jobId,
          leaseId,
          storageId,
        }))
      )
        await ctx.storage.delete(storageId);
      return { processed: 1 };
    } catch (error) {
      await ctx.runMutation(internal.administration.settleLifecycleExport, {
        jobId,
        leaseId,
        errorSummary:
          error instanceof Error ? error.message : "School export failed.",
      });
      return { processed: 1 };
    }
  },
});

export const lifecycleExportUrl = mutation({
  args: {
    jobId: v.id("schoolLifecycleJobs"),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await platformOperator(ctx);
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.type !== "export" ||
      job.status !== "completed" ||
      !job.exportStorageId
    )
      throw new Error(
        "LIFECYCLE_EXPORT_UNAVAILABLE: This export is not ready.",
      );
    const url = await ctx.storage.getUrl(job.exportStorageId);
    if (!url)
      throw new Error(
        "LIFECYCLE_EXPORT_UNAVAILABLE: The export object expired or was removed.",
      );
    // A version 2 export is a manifest plus its parts. A part row holds only
    // metadata; the exported rows stay in storage.
    const partRows = await ctx.db
      .query("schoolExportParts")
      .withIndex("by_job_index", (q) => q.eq("jobId", job._id))
      .collect();
    const parts = await Promise.all(
      partRows.map(async (part) => {
        const partUrl = await ctx.storage.getUrl(part.storageId);
        if (!partUrl)
          throw new Error(
            "LIFECYCLE_EXPORT_UNAVAILABLE: An export part expired or was removed.",
          );
        return { index: part.index, section: part.section, url: partUrl };
      }),
    );
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: job.schoolId,
      action: "school.export.downloaded",
      targetType: "lifecycle_job",
      targetId: job._id,
      requestId: args.requestId,
      retentionClass: "legal",
    });
    return { url, parts };
  },
});

export const requestLifecycleJob = mutation({
  args: {
    schoolId: v.id("schools"),
    type: v.union(
      v.literal("activate"),
      v.literal("suspend"),
      v.literal("export"),
      v.literal("offboard"),
      v.literal("purge"),
    ),
    reason: v.string(),
    typedConfirmation: v.optional(v.string()),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await platformOperator(ctx);
    const school = await ctx.db.get(args.schoolId);
    if (!school)
      throw new Error("SCHOOL_NOT_FOUND: This school is unavailable.");
    const reason = clean(args.reason, 1_000);
    if (reason.length < 12)
      throw new Error(
        "LIFECYCLE_REASON_REQUIRED: Add a clear operational reason.",
      );
    if (
      ["offboard", "purge"].includes(args.type) &&
      args.typedConfirmation !== school.slug
    )
      throw new Error(
        `LIFECYCLE_CONFIRMATION_REQUIRED: Type ${school.slug} exactly.`,
      );
    const destructive = ["offboard", "purge"].includes(args.type);
    const now = Date.now();
    const impact = await lifecycleImpact(ctx, school._id);
    const prerequisiteExportJobId =
      args.type === "purge"
        ? await ctx.db.insert("schoolLifecycleJobs", {
            schoolId: school._id,
            type: "export",
            status: "queued",
            requestedByAccountId: actor.accountId,
            approvedByAccountIds: [actor.accountId],
            reason: `Automatic legal export before purge: ${reason}`,
            impact,
            createdAt: now,
            updatedAt: now,
          })
        : undefined;
    const jobId = await ctx.db.insert("schoolLifecycleJobs", {
      schoolId: school._id,
      type: args.type,
      status: destructive ? "awaiting_approval" : "queued",
      requestedByAccountId: actor.accountId,
      approvedByAccountIds: [actor.accountId],
      reason,
      typedConfirmation: destructive ? args.typedConfirmation : undefined,
      impact,
      prerequisiteExportJobId,
      reversibleUntil:
        args.type === "offboard" || args.type === "purge"
          ? now + 30 * 24 * 60 * 60_000
          : undefined,
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: school._id,
      action: "school.lifecycle.requested",
      targetType: "lifecycle_job",
      targetId: jobId,
      metadata: { type: args.type, destructive },
      requestId: args.requestId,
      retentionClass: "legal",
    });
    return {
      jobId,
      prerequisiteExportJobId,
      status: destructive ? "awaiting_approval" : "queued",
    };
  },
});

export const approveLifecycleJob = mutation({
  args: {
    jobId: v.id("schoolLifecycleJobs"),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await platformOperator(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "awaiting_approval")
      throw new Error(
        "LIFECYCLE_JOB_UNAVAILABLE: This job is not awaiting approval.",
      );
    if (job.requestedByAccountId === actor.accountId)
      throw new Error(
        "LIFECYCLE_DUAL_APPROVAL: A different platform operator must approve.",
      );
    const approvals = [
      ...new Set([...job.approvedByAccountIds, actor.accountId]),
    ];
    const now = Date.now();
    await ctx.db.patch(job._id, {
      approvedByAccountIds: approvals,
      status: approvals.length >= 2 ? "queued" : "awaiting_approval",
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: job.schoolId,
      action: "school.lifecycle.approved",
      targetType: "lifecycle_job",
      targetId: job._id,
      metadata: { type: job.type, approvalCount: approvals.length },
      requestId: args.requestId,
      retentionClass: "legal",
    });
    return {
      jobId: job._id,
      status: approvals.length >= 2 ? "queued" : "awaiting_approval",
      approvalCount: approvals.length,
    };
  },
});

export const cancelLifecycleJob = mutation({
  args: {
    jobId: v.id("schoolLifecycleJobs"),
    reason: v.string(),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await platformOperator(ctx);
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      !["awaiting_approval", "queued"].includes(job.status) ||
      !["offboard", "purge"].includes(job.type)
    )
      throw new Error(
        "LIFECYCLE_CANCEL_UNAVAILABLE: This destructive job has crossed its cancellation boundary.",
      );
    const reason = clean(args.reason, 1_000);
    if (reason.length < 12)
      throw new Error(
        "LIFECYCLE_REASON_REQUIRED: Explain why this operation is being cancelled.",
      );
    const now = Date.now();
    const school = await ctx.db.get(job.schoolId);
    if (school && school.status === "suspended") {
      await ctx.db.patch(school._id, {
        status: "active",
        policyVersion: school.policyVersion + 1,
        updatedAt: now,
      });
      const memberships = await ctx.db
        .query("schoolMemberships")
        .withIndex("by_school_status", (q) =>
          q.eq("schoolId", school._id).eq("status", "suspended"),
        )
        .collect();
      for (const membership of memberships)
        await ctx.db.patch(membership._id, {
          status: "active",
          updatedAt: now,
        });
      const integrations = await ctx.db
        .query("schoolIntegrations")
        .withIndex("by_school_provider", (q) => q.eq("schoolId", school._id))
        .collect();
      for (const integration of integrations.filter(
        (item) =>
          item.status === "revoked" &&
          item.blockedReason?.includes("purge hold"),
      ))
        await ctx.db.patch(integration._id, {
          status:
            integration.capabilityCoverage.verifiedReadable > 0
              ? "connected"
              : "degraded",
          blockedReason: undefined,
          nextSyncAt: now + integration.syncPolicy.frequencyMinutes * 60_000,
          updatedAt: now,
        });
    }
    if (job.prerequisiteExportJobId) {
      const exportJob = await ctx.db.get(job.prerequisiteExportJobId);
      if (exportJob?.exportStorageId)
        await ctx.storage.delete(exportJob.exportStorageId);
      if (exportJob)
        await ctx.scheduler.runAfter(
          0,
          internal.administration.deleteLifecycleExportParts,
          { jobId: exportJob._id },
        );
      if (
        exportJob &&
        ["queued", "running", "completed", "failed"].includes(exportJob.status)
      )
        await ctx.db.patch(exportJob._id, {
          status: "cancelled",
          exportStorageId: undefined,
          errorSummary: "Cancelled with the associated purge request.",
          completedAt: now,
          updatedAt: now,
        });
    }
    await ctx.db.patch(job._id, {
      status: "cancelled",
      errorSummary: reason,
      completedAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: job.schoolId,
      action: "school.lifecycle.cancelled",
      targetType: "lifecycle_job",
      targetId: job._id,
      metadata: { type: job.type, reason },
      requestId: args.requestId,
      retentionClass: "legal",
    });
    return { jobId: job._id, status: "cancelled" as const };
  },
});

const PURGE_DEPENDENT_TABLES = [
  "externalSyncCapabilityRuns",
  "quizPracticeResponses",
  "artifactCommentPreferences",
  "artifactCommentNotifications",
  "orgNodes",
  "spectraRunAttachments",
  "spectraOperations",
  "spectraResultCards",
  "spectraRunEvents",
  "spectraFocusSpaces",
  "secretBridgeNonces",
  // Native Office replicas and their sync/Bridge state hold payload
  // references to a student's file bytes. They are keyed by the work, which
  // still exists during this stage, so ownership resolves through it.
  "workReplicas",
  "syncConflicts",
  "bridgeWriteRequests",
  "bridgeFsRequests",
  "syncOperations",
  "storageStrategyTransitions",
  "artifactIntakeReleaseReceipts",
  "collaborationReceipts",
] as const;

const PURGE_WORK_DEPENDENT_TABLES = new Set<string>([
  "workReplicas",
  "syncConflicts",
  "bridgeWriteRequests",
  "bridgeFsRequests",
  "syncOperations",
  "storageStrategyTransitions",
  "artifactIntakeReleaseReceipts",
]);

/** Payload-reference fields a purged row can hold. Each reference is released
 * after its row is gone, exactly as single-work deletion does, so native file
 * bytes do not outlive the school. */
function purgedPayloadRefs(table: string, row: Record<string, unknown>) {
  const fields =
    table === "workReplicas"
      ? ["payloadRef", "pendingPayloadRef", "projectionBasePayloadRef"]
      : table === "syncConflicts"
        ? ["localPayloadRef", "spectraPayloadRef"]
        : table === "bridgeWriteRequests"
          ? ["payloadRef"]
          : [];
  return [
    ...new Set(
      fields
        .map((field) => row[field])
        .filter((ref): ref is string => typeof ref === "string" && ref.length > 0),
    ),
  ];
}

export const PURGE_SCHOOL_TABLES = [
  "membershipInvitations",
  "schoolGroups",
  "schoolGroupMembers",
  "schoolAnnouncements",
  "schoolAnnouncementDeliveries",
  "feedbackReports",
  "schoolRequests",
  "schoolOnboardingSagas",
  "accessGrants",
  "shareInvitations",
  "artifactAccessOverrides",
  "resourcePolicies",
  "publicLinks",
  "limitPolicies",
  "secretRecords",
  "schoolIntegrations",
  "integrationCapabilities",
  "externalIdentityMappings",
  // School data each student keeps beside the records (files hold storage).
  "schoolFiles",
  "casReflections",
  "casOutcomeTags",
  "schoolSyncStates",
  "schoolSyncClassOverrides",
  "schoolSyncPreferences",
  "externalRecordRelations",
  "externalRecordOverlays",
  "externalSyncConflicts",
  "externalQuarantineRecords",
  "externalProjections",
  "externalRecords",
  "externalSyncSeenKeys",
  "externalSyncRuns",
  "spectraRuntimeBuilds",
  "artifactUserStates",
  "memoryPreferences",
  "memoryEvidence",
  "memoryRelations",
  "memoryCapsules",
  "memoryRetrievalEvents",
  "memoryJobs",
  "memoryEvaluationRuns",
  "memoryClaims",
  "flashcardStudyStates",
  "flashcardStudyReviews",
  "quizPracticeAttempts",
  "spectraArtifactVersions",
  "agentReleases",
  "agentEvalRuns",
  "agentFeedback",
  "agentUsageAggregates",
  "agentImprovementProposals",
  "agentBenchCases",
  "agentBenchRuns",
  "agentFollows",
  "artifactSnapshotObjects",
  "collaborationUpdates",
  "collaborationSnapshots",
  "collaborationRooms",
  "regionClaims",
  "artifactComments",
  "plannerReminderDeliveries",
  "timetableReminderDeliveries",
  "changeGroups",
  "artifactEmbeds",
  "artifactAccessRequests",
  "spectraArtifactLinks",
  "spectraRunTabs",
  "spectraRunJobs",
  "spectraMessages",
  "spectraAiRuns",
  "spectraThreads",
  "orgNodes",
  "workspaceImportJobs",
  "spectraArtifacts",
  "spectraWorkspaces",
  // Personal calendars, ManageBac selections/imports and read-model/job rows
  // all carry the school partition but were missing from the purge.
  "calendarItems",
  "calendarMigrations",
  "calendarPeriodMaps",
  "calendarItemReadModels",
  "calendarMigrationReadModels",
  "calendarPlanTaskReadModels",
  "managebacClassSelections",
  "managebacResourceImports",
  "externalRecordIdentityMigrations",
  "agentCompilerJobs",
  "artifactDeletionJobs",
  "workspaceDeletionJobs",
  "spectraArtifactRevisionFacts",
  // Derived search rows last: deleting their sources above queues purges that land here.
  "semanticIndexQueue",
  "semanticChunks",
  "semanticItems",
  "semanticRelatedCache",
] as const;

/** School-leading index for each purge table that has one. A table left out
 * has no index that starts with schoolId and is walked once with a cursor. */
export const PURGE_SCHOOL_INDEXES: Partial<
  Record<(typeof PURGE_SCHOOL_TABLES)[number], string>
> = {
  membershipInvitations: "by_school_status",
  schoolGroups: "by_school_status",
  schoolGroupMembers: "by_school",
  schoolAnnouncements: "by_school_created",
  schoolAnnouncementDeliveries: "by_school_created",
  feedbackReports: "by_school_status",
  schoolRequests: "by_school_status",
  schoolOnboardingSagas: "by_school",
  accessGrants: "by_school",
  resourcePolicies: "by_school",
  secretRecords: "by_school_purpose",
  schoolIntegrations: "by_school_provider",
  integrationCapabilities: "by_school_status",
  externalIdentityMappings: "by_school_status",
  schoolFiles: "by_school",
  casReflections: "by_school",
  casOutcomeTags: "by_school",
  schoolSyncStates: "by_school",
  schoolSyncClassOverrides: "by_school",
  schoolSyncPreferences: "by_school",
  externalRecordOverlays: "by_school",
  externalRecords: "by_school_updated",
  externalSyncRuns: "by_school_created",
  externalSyncSeenKeys: "by_school",
  memoryPreferences: "by_school_updated",
  memoryCapsules: "by_school_updated",
  memoryRetrievalEvents: "by_school_created",
  memoryEvaluationRuns: "by_school_created",
  memoryClaims: "by_school_status",
  agentReleases: "by_school_published",
  agentEvalRuns: "by_school_created",
  agentFeedback: "by_school_created",
  agentUsageAggregates: "by_school_day",
  agentImprovementProposals: "by_school_created",
  agentBenchCases: "by_school_created",
  agentBenchRuns: "by_school_created",
  agentFollows: "by_school_status",
  artifactSnapshotObjects: "by_school_hash",
  collaborationRooms: "by_school_status",
  spectraMessages: "by_school_created",
  spectraThreads: "by_school_status",
  spectraArtifacts: "by_school_status",
  spectraWorkspaces: "by_school_status",
  calendarPeriodMaps: "by_school_updated",
  managebacResourceImports: "by_school_updated",
  semanticIndexQueue: "by_school",
  semanticChunks: "by_school",
  semanticItems: "by_school",
  semanticRelatedCache: "by_school",
};

async function rowBelongsToPurgedSchool(
  ctx: MutationCtx,
  table: (typeof PURGE_DEPENDENT_TABLES)[number],
  row: Record<string, unknown>,
  schoolId: Id<"schools">,
) {
  if (table === "externalSyncCapabilityRuns") {
    const parent = await ctx.db.get(row.syncRunId as Id<"externalSyncRuns">);
    return parent?.schoolId === schoolId;
  }
  if (table === "quizPracticeResponses") {
    const parent = await ctx.db.get(
      row.attemptId as Id<"quizPracticeAttempts">,
    );
    return parent?.schoolId === schoolId;
  }
  if (
    table === "artifactCommentPreferences" ||
    table === "artifactCommentNotifications"
  ) {
    const artifact = await ctx.db.get(row.artifactId as Id<"spectraArtifacts">);
    return artifact?.schoolId === schoolId;
  }
  if (table === "orgNodes") {
    /* A node carries its school directly when it was created with one. Older
       rows fall back to the workspace holding them, so a purge cannot leave a
       school's tree behind. */
    if (row.schoolId) return row.schoolId === schoolId;
    if (!row.workspaceContextId) return false;
    const workspace = await ctx.db.get(
      row.workspaceContextId as Id<"spectraWorkspaces">,
    );
    return workspace?.schoolId === schoolId;
  }
  if (
    table === "spectraRunAttachments" ||
    table === "spectraResultCards" ||
    table === "spectraRunEvents"
  ) {
    const run = await ctx.db.get(row.runId as Id<"spectraAiRuns">);
    return run?.schoolId === schoolId;
  }
  if (table === "spectraOperations") {
    if (!row.runId) return false;
    const run = await ctx.db.get(row.runId as Id<"spectraAiRuns">);
    return run?.schoolId === schoolId;
  }
  if (table === "spectraFocusSpaces") {
    if (!row.workspaceId) return false;
    const workspace = await ctx.db.get(
      row.workspaceId as Id<"spectraWorkspaces">,
    );
    return workspace?.schoolId === schoolId;
  }
  if (PURGE_WORK_DEPENDENT_TABLES.has(table)) {
    const workId = (row.workId ?? row.artifactId) as Id<"spectraArtifacts">;
    const work = await ctx.db.get(workId);
    return work?.schoolId === schoolId;
  }
  if (table === "collaborationReceipts") {
    const room = await ctx.db.get(row.roomId as Id<"collaborationRooms">);
    return room?.schoolId === schoolId;
  }
  if (table === "secretBridgeNonces") {
    const membership = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_account", (q) =>
        q.eq("accountId", row.accountId as Id<"accounts">),
      )
      .first();
    return membership?.schoolId === schoolId;
  }
  return false;
}

async function purgeDependentPage(
  ctx: MutationCtx,
  progress: Doc<"schoolPurgeProgress">,
) {
  const table = PURGE_DEPENDENT_TABLES[progress.tableIndex];
  if (!table)
    return {
      stage: "school_rows" as const,
      tableIndex: 0,
      cursor: undefined,
      deletedRows: 0,
      deletedStorageObjects: 0,
    };
  // Each dependent table lacks a school partition key in its historical
  // schema, so a bounded cursor scan resolves ownership through its parent.
  const page = await ctx.db
    .query(table)
    .paginate({ cursor: progress.cursor ?? null, numItems: 75 });
  let deletedRows = 0;
  let deletedStorageObjects = 0;
  for (const row of page.page) {
    if (
      !(await rowBelongsToPurgedSchool(
        ctx,
        table,
        row as unknown as Record<string, unknown>,
        progress.schoolId,
      ))
    )
      continue;
    const storedRow = row as unknown as {
      storageId?: Id<"_storage">;
    };
    if (table === "spectraRunAttachments" && storedRow.storageId) {
      await ctx.storage.delete(storedRow.storageId);
      deletedStorageObjects += 1;
    }
    await ctx.db.delete(row._id);
    deletedRows += 1;
    for (const ref of purgedPayloadRefs(
      table,
      row as unknown as Record<string, unknown>,
    ))
      if (
        (await releasePayloadIfUnreferenced(ctx, ref, {
          schoolId: progress.schoolId,
          sourceId: String(row._id),
        })) > 0
      )
        deletedStorageObjects += 1;
  }
  return {
    stage: page.isDone ? ("dependent_rows" as const) : progress.stage,
    tableIndex: page.isDone ? progress.tableIndex + 1 : progress.tableIndex,
    cursor: page.isDone ? undefined : page.continueCursor,
    deletedRows,
    deletedStorageObjects,
  };
}

async function purgeSchoolRows(
  ctx: MutationCtx,
  progress: Doc<"schoolPurgeProgress">,
) {
  const table = PURGE_SCHOOL_TABLES[progress.tableIndex];
  if (!table)
    return {
      stage: "finalize" as const,
      tableIndex: 0,
      cursor: undefined,
      deletedRows: 0,
      deletedStorageObjects: 0,
    };
  if (table === "orgNodes") {
    // Tree nodes were already removed through the parent-aware pass.
    return {
      stage: progress.stage,
      tableIndex: progress.tableIndex + 1,
      cursor: undefined,
      deletedRows: 0,
      deletedStorageObjects: 0,
    };
  }
  // Every table in this list has a schoolId field. A filter scan read every
  // tenant's rows on each batch and, once the school's rows were gone, the
  // whole table, which exceeds the read limit on a large table. A table with a
  // school index now reads only this school's rows. A table without one is
  // walked once with a bounded cursor.
  const index = PURGE_SCHOOL_INDEXES[table];
  const schoolRows = ctx.db.query(table as "accessGrants") as unknown as {
    withIndex(
      name: string,
      range: (q: { eq(field: "schoolId", value: Id<"schools">): unknown }) => unknown,
    ): { take(count: number): Promise<Doc<"accessGrants">[]> };
    paginate(options: {
      cursor: string | null;
      numItems: number;
      maximumRowsRead: number;
      maximumBytesRead: number;
    }): Promise<PaginationResult<Doc<"accessGrants">>>;
  };
  const walked = index
    ? null
    : await schoolRows.paginate({
        cursor: progress.cursor ?? null,
        numItems: 200,
        maximumRowsRead: 200,
        maximumBytesRead: 4_000_000,
      });
  const rows = walked
    ? walked.page.filter((row) => row.schoolId === progress.schoolId)
    : await schoolRows
        .withIndex(index!, (q) => q.eq("schoolId", progress.schoolId))
        .take(75);
  const tableDone = walked ? walked.isDone : rows.length === 0;
  let deletedStorageObjects = 0;
  for (const row of rows) {
    // Published runtime bundles are stored blobs; deleting only the row
    // would orphan the student's built code in storage.
    const storageId = (row as unknown as { storageId?: Id<"_storage"> })
      .storageId;
    if (
      (table === "spectraRuntimeBuilds" || table === "schoolFiles") &&
      storageId &&
      (await deleteStorageIfNoOtherBinding(ctx, storageId, {
        table,
        id: String(row._id),
      }))
    )
      deletedStorageObjects += 1;
    await ctx.db.delete(row._id);
  }
  return {
    stage: progress.stage,
    tableIndex: tableDone ? progress.tableIndex + 1 : progress.tableIndex,
    cursor: walked && !walked.isDone ? walked.continueCursor : undefined,
    deletedRows: rows.length,
    deletedStorageObjects,
  };
}

async function purgeStoredSchoolObjects(
  ctx: MutationCtx,
  schoolId: Id<"schools">,
) {
  const [assets, imports] = await Promise.all([
    // School indexes: a filter scan read every tenant's rows, and the whole
    // table once this school's rows were gone.
    ctx.db
      .query("artifactAssets")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .take(40),
    ctx.db
      .query("artifactImportJobs")
      .withIndex("by_school_created", (q) => q.eq("schoolId", schoolId))
      .take(40),
  ]);
  let deletedStorageObjects = 0;
  // Unpromoted candidate bytes are as much a student's upload as the
  // accepted original; delete both before dropping the row.
  for (const row of assets) {
    for (const storageId of new Set([row.storageId, row.candidateStorageId])) {
      if (!storageId || !(await ctx.db.system.get(storageId))) continue;
      await ctx.storage.delete(storageId);
      deletedStorageObjects += 1;
    }
    await ctx.db.delete(row._id);
  }
  for (const row of imports) {
    for (const storageId of new Set([
      row.originalStorageId,
      row.candidateStorageId,
    ])) {
      if (!storageId || !(await ctx.db.system.get(storageId))) continue;
      await ctx.storage.delete(storageId);
      deletedStorageObjects += 1;
    }
    await ctx.db.delete(row._id);
  }
  return {
    deletedRows: assets.length + imports.length,
    deletedStorageObjects,
    complete: assets.length === 0 && imports.length === 0,
  };
}

async function processPurgeBatch(
  ctx: MutationCtx,
  job: Doc<"schoolLifecycleJobs">,
) {
  const progress = await ctx.db
    .query("schoolPurgeProgress")
    .withIndex("by_job", (q) => q.eq("jobId", job._id))
    .unique();
  if (!progress) return false;
  const now = Date.now();
  if (progress.stage === "dependent_rows") {
    const result = await purgeDependentPage(ctx, progress);
    await ctx.db.patch(progress._id, {
      stage: result.stage,
      tableIndex: result.tableIndex,
      cursor: result.cursor,
      deletedRows: progress.deletedRows + result.deletedRows,
      deletedStorageObjects:
        progress.deletedStorageObjects + result.deletedStorageObjects,
      irreversibleAt: progress.irreversibleAt ?? now,
      updatedAt: now,
    });
    return true;
  }
  if (progress.stage === "school_rows") {
    const stored = await purgeStoredSchoolObjects(ctx, progress.schoolId);
    if (!stored.complete || stored.deletedRows > 0) {
      await ctx.db.patch(progress._id, {
        deletedRows: progress.deletedRows + stored.deletedRows,
        deletedStorageObjects:
          progress.deletedStorageObjects + stored.deletedStorageObjects,
        irreversibleAt: progress.irreversibleAt ?? now,
        updatedAt: now,
      });
      return true;
    }
    const result = await purgeSchoolRows(ctx, progress);
    await ctx.db.patch(progress._id, {
      stage: result.stage,
      tableIndex: result.tableIndex,
      cursor: result.cursor,
      deletedRows: progress.deletedRows + result.deletedRows,
      deletedStorageObjects:
        progress.deletedStorageObjects + result.deletedStorageObjects,
      irreversibleAt: progress.irreversibleAt ?? now,
      updatedAt: now,
    });
    return true;
  }
  if (progress.stage !== "finalize") return false;
  const [memberships, operatorSessions] = await Promise.all([
    ctx.db
      .query("schoolMemberships")
      .withIndex("by_school", (q) => q.eq("schoolId", progress.schoolId))
      .collect(),
    ctx.db
      .query("operatorSchoolSessions")
      .withIndex("by_school", (q) => q.eq("schoolId", progress.schoolId))
      .collect(),
  ]);
  for (const membership of memberships) await ctx.db.delete(membership._id);
  for (const session of operatorSessions.filter((item) => !item.revokedAt))
    await ctx.db.patch(session._id, { revokedAt: now });
  const school = await ctx.db.get(progress.schoolId);
  if (school)
    await ctx.db.patch(school._id, {
      name: `Purged school ${school._id.slice(-8)}`,
      slug: `purged-${school._id}`,
      verifiedDomains: [],
      status: "archived",
      locale: undefined,
      accentColor: undefined,
      logoUrl: undefined,
      academicYearStart: undefined,
      academicYearEnd: undefined,
      accessibilityDefaults: undefined,
      policyVersion: school.policyVersion + 1,
      updatedAt: now,
    });
  await ctx.db.patch(progress._id, {
    stage: "completed",
    deletedRows: progress.deletedRows + memberships.length,
    irreversibleAt: progress.irreversibleAt ?? now,
    updatedAt: now,
  });
  await ctx.db.patch(job._id, {
    status: "completed",
    completedAt: now,
    updatedAt: now,
  });
  await writeAuditEvent(ctx, {
    actorAccountId: job.requestedByAccountId,
    schoolId: job.schoolId,
    action: "school.purge.completed",
    targetType: "lifecycle_job",
    targetId: job._id,
    metadata: {
      deletedRows: progress.deletedRows + memberships.length,
      deletedStorageObjects: progress.deletedStorageObjects,
      prerequisiteExportJobId: job.prerequisiteExportJobId ?? null,
      retained:
        "legal audit receipt; aggregate usage records; encrypted school export; scrubbed school tombstone",
    },
    retentionClass: "legal",
  });
  return true;
}

/** Runs one purge batch and schedules the next while the purge is running.
 * The cron still runs a batch every tick, so a chain that stops on an error
 * falls back to the cron's pace. */
export const advanceSchoolPurge = internalMutation({
  args: { jobId: v.id("schoolLifecycleJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.type !== "purge" || job.status !== "running") return false;
    if (!(await processPurgeBatch(ctx, job))) return false;
    if ((await ctx.db.get(job._id))?.status === "running")
      await ctx.scheduler.runAfter(
        0,
        internal.administration.advanceSchoolPurge,
        args,
      );
    return true;
  },
});

export const processLifecycleJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Exports stay "running" across several actions now, so a purge is looked
    // up by type: twenty running exports must not hide it.
    const runningPurge = await ctx.db
      .query("schoolLifecycleJobs")
      .withIndex("by_status_created", (q) => q.eq("status", "running"))
      .filter((q) => q.eq(q.field("type"), "purge"))
      .first();
    if (runningPurge) {
      await processPurgeBatch(ctx, runningPurge);
      return { completed: 0, purging: true };
    }
    // Queued exports belong to processLifecycleExports. Skipping them here
    // after taking twenty let twenty queued exports stall every suspend.
    const jobs = await ctx.db
      .query("schoolLifecycleJobs")
      .withIndex("by_status_created", (q) => q.eq("status", "queued"))
      .filter((q) => q.neq(q.field("type"), "export"))
      .take(20);
    const now = Date.now();
    let completed = 0;
    for (const job of jobs) {
      const school = await ctx.db.get(job.schoolId);
      if (!school) {
        await ctx.db.patch(job._id, {
          status: "failed",
          errorSummary: "School no longer exists.",
          completedAt: now,
          updatedAt: now,
        });
        continue;
      }
      if (job.type === "purge") {
        const exportJob = job.prerequisiteExportJobId
          ? await ctx.db.get(job.prerequisiteExportJobId)
          : null;
        if (!exportJob || exportJob.status === "failed") {
          await ctx.db.patch(job._id, {
            status: "failed",
            errorSummary:
              "The required pre-purge school export did not complete.",
            completedAt: now,
            updatedAt: now,
          });
          continue;
        }
        const memberships = await ctx.db
          .query("schoolMemberships")
          .withIndex("by_school_status", (q) =>
            q.eq("schoolId", school._id).eq("status", "active"),
          )
          .collect();
        for (const membership of memberships)
          await ctx.db.patch(membership._id, {
            status: "suspended",
            updatedAt: now,
          });
        const integrations = await ctx.db
          .query("schoolIntegrations")
          .withIndex("by_school_provider", (q) =>
            q.eq("schoolId", school._id),
          )
          .collect();
        for (const integration of integrations)
          await ctx.db.patch(integration._id, {
            status: "revoked",
            blockedReason: "School purge hold is active.",
            nextSyncAt: undefined,
            updatedAt: now,
          });
        if (school.status !== "suspended")
          await ctx.db.patch(school._id, {
            status: "suspended",
            policyVersion: school.policyVersion + 1,
            updatedAt: now,
          });
        if (
          exportJob.status !== "completed" ||
          !job.reversibleUntil ||
          job.reversibleUntil > now
        )
          continue;
        await ctx.db.patch(job._id, {
          status: "running",
          startedAt: now,
          updatedAt: now,
        });
        const existingProgress = await ctx.db
          .query("schoolPurgeProgress")
          .withIndex("by_job", (q) => q.eq("jobId", job._id))
          .unique();
        if (!existingProgress)
          await ctx.db.insert("schoolPurgeProgress", {
            jobId: job._id,
            schoolId: school._id,
            stage: "dependent_rows",
            tableIndex: 0,
            deletedRows: 0,
            deletedStorageObjects: 0,
            irreversibleAt: now,
            createdAt: now,
            updatedAt: now,
          });
        // One batch per two-minute cron could not purge a real school; the
        // purge now continues batch after batch until it completes.
        await ctx.scheduler.runAfter(
          0,
          internal.administration.advanceSchoolPurge,
          { jobId: job._id },
        );
        continue;
      }
      await ctx.db.patch(job._id, {
        status: "running",
        startedAt: now,
        updatedAt: now,
      });
      const status =
        job.type === "activate"
          ? ("active" as const)
          : job.type === "suspend" || job.type === "offboard"
            ? ("suspended" as const)
            : school.status;
      await ctx.db.patch(school._id, {
        status,
        policyVersion: school.policyVersion + 1,
        updatedAt: now,
      });
      if (job.type === "offboard") {
        const memberships = await ctx.db
          .query("schoolMemberships")
          .withIndex("by_school_status", (q) =>
            q.eq("schoolId", school._id).eq("status", "active"),
          )
          .collect();
        for (const membership of memberships)
          await ctx.db.patch(membership._id, {
            status: "suspended",
            updatedAt: now,
          });
        // Only this school's integrations. A whole-table read grew with
        // every tenant on the platform.
        const integrations = await ctx.db
          .query("schoolIntegrations")
          .withIndex("by_school_provider", (q) =>
            q.eq("schoolId", school._id),
          )
          .collect();
        for (const integration of integrations)
          await ctx.db.patch(integration._id, {
            status: "revoked",
            blockedReason: "School offboarding is in progress.",
            nextSyncAt: undefined,
            updatedAt: now,
          });
      }
      await ctx.db.patch(job._id, {
        status: "completed",
        completedAt: now,
        updatedAt: now,
      });
      completed += 1;
    }
    return { completed };
  },
});

export const lifecycleJobs = query({
  args: { schoolId: v.optional(v.id("schools")) },
  handler: async (ctx, args) => {
    await platformOperator(ctx);
    const rows = args.schoolId
      ? await ctx.db
          .query("schoolLifecycleJobs")
          .withIndex("by_school_created", (q) =>
            q.eq("schoolId", args.schoolId!),
          )
          .order("desc")
          .take(100)
      : await ctx.db.query("schoolLifecycleJobs").order("desc").take(200);
    return Promise.all(
      rows.map(async (job) => {
        const purge =
          job.type === "purge"
            ? await ctx.db
                .query("schoolPurgeProgress")
                .withIndex("by_job", (q) => q.eq("jobId", job._id))
                .unique()
            : null;
        return {
          jobId: job._id,
          schoolId: job.schoolId,
          type: job.type,
          status: job.status,
          reason: job.reason,
          impact: job.impact,
          approvalCount: job.approvedByAccountIds.length,
          reversibleUntil: job.reversibleUntil,
          prerequisiteExportJobId: job.prerequisiteExportJobId,
          purge: purge
            ? {
                stage: purge.stage,
                deletedRows: purge.deletedRows,
                deletedStorageObjects: purge.deletedStorageObjects,
                irreversibleAt: purge.irreversibleAt,
              }
            : null,
          errorSummary: job.errorSummary,
          createdAt: job.createdAt,
          completedAt: job.completedAt,
        };
      }),
    );
  },
});
