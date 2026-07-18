import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { resolveActorContext } from "./identityShared";
import { writeAuditEvent } from "./auditShared";

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function domains(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim().toLowerCase().replace(/^@/, ""))
        .filter((value) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)),
    ),
  ).slice(0, 20);
}

function email(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized))
    throw new Error(
      "SCHOOL_ADMIN_EMAIL_INVALID: Enter a valid initial administrator email.",
    );
  return normalized;
}

export const create = mutation({
  args: {
    name: v.string(),
    slug: v.optional(v.string()),
    timezone: v.string(),
    verifiedDomains: v.optional(v.array(v.string())),
    initialAdminEmail: v.string(),
    tokenHash: v.string(),
    idempotencyKey: v.string(),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx);
    if (!actor.platformOperator)
      throw new Error(
        "AUTH_OPERATOR_REQUIRED: Platform operator access is required.",
      );
    const idempotencyKey = args.idempotencyKey.trim().slice(0, 240);
    if (idempotencyKey.length < 12)
      throw new Error(
        "SCHOOL_IDEMPOTENCY_REQUIRED: School onboarding requires a stable request key.",
      );
    const existingSaga = await ctx.db
      .query("schoolOnboardingSagas")
      .withIndex("by_idempotency", (q) =>
        q.eq("idempotencyKey", idempotencyKey),
      )
      .unique();
    if (existingSaga) {
      const school = await ctx.db.get(existingSaga.schoolId);
      if (!school)
        throw new Error(
          "SCHOOL_ONBOARDING_CORRUPT: The onboarding record lost its school.",
        );
      return {
        schoolId: school._id,
        sagaId: existingSaga._id,
        invitationId: existingSaga.invitationId,
        status: existingSaga.status,
        duplicate: true,
      };
    }
    const name = args.name.trim().replace(/\s+/g, " ").slice(0, 140);
    const slug = slugify(args.slug ?? name);
    if (name.length < 2 || slug.length < 2)
      throw new Error(
        "SCHOOL_IDENTITY_INVALID: Add a valid school name and slug.",
      );
    try {
      new Intl.DateTimeFormat("en", { timeZone: args.timezone });
    } catch {
      throw new Error("SCHOOL_TIMEZONE_INVALID: Choose a valid IANA timezone.");
    }
    const verifiedDomains = domains(args.verifiedDomains ?? []);
    const initialAdminEmail = email(args.initialAdminEmail);
    const initialDomain = initialAdminEmail.split("@")[1]!;
    if (
      verifiedDomains.length &&
      !verifiedDomains.some(
        (domain) =>
          initialDomain === domain || initialDomain.endsWith(`.${domain}`),
      )
    )
      throw new Error(
        "SCHOOL_ADMIN_DOMAIN_MISMATCH: The initial admin email must use a verified school domain.",
      );
    const duplicate = await ctx.db
      .query("schools")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (duplicate)
      throw new Error("SCHOOL_SLUG_IN_USE: Choose another school slug.");
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name,
      slug,
      verifiedDomains,
      status: "active",
      timezone: args.timezone,
      policyVersion: 1,
      locale: "en",
      accessibilityDefaults: {
        reducedMotion: false,
        increasedContrast: false,
        largerText: false,
      },
      createdAt: now,
      updatedAt: now,
    });
    const governancePolicyId = await ctx.db.insert("governancePolicies", {
      schoolId,
      scope: "school",
      publicSharing: "approval_required",
      defaultWorkspaceAccess: "private",
      allowedModels: [],
      allowedCodeRuntimes: ["javascript", "typescript", "react", "python"],
      codeNetworkAccess: false,
      exportEnabled: true,
      updatedByAccountId: actor.accountId,
      createdAt: now,
      updatedAt: now,
    });
    const limitPolicyId = await ctx.db.insert("limitPolicies", {
      schoolId,
      scope: "school",
      rules: [],
      enforcement: "disabled",
      updatedByAccountId: actor.accountId,
      createdAt: now,
      updatedAt: now,
    });
    const invitationId = await ctx.db.insert("membershipInvitations", {
      schoolId,
      email: initialAdminEmail,
      role: "school_admin",
      tokenHash: args.tokenHash.slice(0, 180),
      status: "pending",
      invitedByAccountId: actor.accountId,
      expiresAt: now + 14 * 24 * 60 * 60_000,
      createdAt: now,
      updatedAt: now,
    });
    const sagaId = await ctx.db.insert("schoolOnboardingSagas", {
      idempotencyKey,
      schoolId,
      initialAdminEmail,
      status: "invited",
      completedSteps: [
        "identity_reserved",
        "policy_created",
        "limits_created",
        "admin_invited",
      ],
      invitationId,
      createdByAccountId: actor.accountId,
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId,
      action: "school.onboarding.started",
      targetType: "school_onboarding",
      targetId: sagaId,
      metadata: {
        name,
        slug,
        timezone: args.timezone,
        governancePolicyId,
        limitPolicyId,
        invitationId,
      },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return {
      schoolId,
      sagaId,
      invitationId,
      status: "invited" as const,
      duplicate: false,
    };
  },
});

export const cancelOnboarding = mutation({
  args: {
    sagaId: v.id("schoolOnboardingSagas"),
    reason: v.string(),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx);
    if (!actor.platformOperator)
      throw new Error(
        "AUTH_OPERATOR_REQUIRED: Platform operator access is required.",
      );
    const saga = await ctx.db.get(args.sagaId);
    if (!saga || !["reserved", "invited"].includes(saga.status))
      throw new Error(
        "SCHOOL_ONBOARDING_NOT_REVERSIBLE: This onboarding has already completed.",
      );
    const memberships = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_school", (q) => q.eq("schoolId", saga.schoolId))
      .collect();
    if (memberships.some((membership) => membership.status === "active"))
      throw new Error(
        "SCHOOL_ONBOARDING_NOT_REVERSIBLE: An administrator has already joined.",
      );
    const now = Date.now();
    if (saga.invitationId) {
      const invitation = await ctx.db.get(saga.invitationId);
      if (invitation?.status === "pending")
        await ctx.db.patch(invitation._id, {
          status: "revoked",
          revokedAt: now,
          updatedAt: now,
        });
    }
    const school = await ctx.db.get(saga.schoolId);
    if (school)
      await ctx.db.patch(school._id, {
        status: "archived",
        policyVersion: school.policyVersion + 1,
        updatedAt: now,
      });
    await ctx.db.patch(saga._id, {
      status: "cancelled",
      errorSummary: args.reason.trim().slice(0, 500),
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: saga.schoolId,
      action: "school.onboarding.cancelled",
      targetType: "school_onboarding",
      targetId: saga._id,
      metadata: { reason: args.reason.trim().slice(0, 240) },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return { sagaId: saga._id, status: "cancelled" as const };
  },
});

export const getOperational = query({
  args: { operatorSessionId: v.id("operatorSchoolSessions") },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx, args.operatorSessionId);
    const school = actor.operationalSchool!;
    return {
      schoolId: school._id,
      name: school.name,
      slug: school.slug,
      status: school.status,
      timezone: school.timezone,
      verifiedDomains: school.verifiedDomains,
      policyVersion: school.policyVersion,
      operatorMode: actor.operatorSession!.mode,
    };
  },
});

export const updateOperational = mutation({
  args: {
    operatorSessionId: v.id("operatorSchoolSessions"),
    name: v.optional(v.string()),
    timezone: v.optional(v.string()),
    verifiedDomains: v.optional(v.array(v.string())),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("suspended"),
        v.literal("archived"),
      ),
    ),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx, args.operatorSessionId);
    if (actor.operatorSession!.mode !== "manage")
      throw new Error(
        "AUTH_OPERATOR_MANAGE_REQUIRED: Re-enter the school with manage access.",
      );
    const school = actor.operationalSchool!;
    if (args.timezone) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: args.timezone });
      } catch {
        throw new Error(
          "SCHOOL_TIMEZONE_INVALID: Choose a valid IANA timezone.",
        );
      }
    }
    const now = Date.now();
    await ctx.db.patch(school._id, {
      name: args.name?.trim().replace(/\s+/g, " ").slice(0, 140) || school.name,
      timezone: args.timezone ?? school.timezone,
      verifiedDomains: args.verifiedDomains
        ? domains(args.verifiedDomains)
        : school.verifiedDomains,
      status: args.status ?? school.status,
      policyVersion: school.policyVersion + 1,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: school._id,
      operatorSessionId: actor.operatorSession!._id,
      action: "school.updated",
      targetType: "school",
      targetId: school._id,
      metadata: {
        status: args.status ?? school.status,
        policyVersion: school.policyVersion + 1,
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
