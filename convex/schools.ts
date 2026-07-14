import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { resolveActorContext } from "./identityShared";
import { writeAuditEvent } from "./auditShared";

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function domains(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim().toLowerCase().replace(/^@/, "")).filter((value) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)))).slice(0, 20);
}

export const create = mutation({
  args: { name: v.string(), slug: v.optional(v.string()), timezone: v.string(), verifiedDomains: v.optional(v.array(v.string())), requestId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx);
    if (!actor.platformOperator) throw new Error("AUTH_OPERATOR_REQUIRED: Platform operator access is required.");
    const name = args.name.trim().replace(/\s+/g, " ").slice(0, 140);
    const slug = slugify(args.slug ?? name);
    if (name.length < 2 || slug.length < 2) throw new Error("SCHOOL_IDENTITY_INVALID: Add a valid school name and slug.");
    try { new Intl.DateTimeFormat("en", { timeZone: args.timezone }); } catch { throw new Error("SCHOOL_TIMEZONE_INVALID: Choose a valid IANA timezone."); }
    const duplicate = await ctx.db.query("schools").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (duplicate) throw new Error("SCHOOL_SLUG_IN_USE: Choose another school slug.");
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name, slug, verifiedDomains: domains(args.verifiedDomains ?? []), status: "active", timezone: args.timezone, policyVersion: 1, createdAt: now, updatedAt: now });
    await writeAuditEvent(ctx, { actorAccountId: actor.accountId, schoolId, action: "school.created", targetType: "school", targetId: schoolId, metadata: { name, slug, timezone: args.timezone }, requestId: args.requestId, retentionClass: "security" });
    return { schoolId };
  },
});

export const getOperational = query({
  args: { operatorSessionId: v.id("operatorSchoolSessions") },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx, args.operatorSessionId);
    const school = actor.operationalSchool!;
    return { schoolId: school._id, name: school.name, slug: school.slug, status: school.status, timezone: school.timezone, verifiedDomains: school.verifiedDomains, policyVersion: school.policyVersion, operatorMode: actor.operatorSession!.mode };
  },
});

export const updateOperational = mutation({
  args: { operatorSessionId: v.id("operatorSchoolSessions"), name: v.optional(v.string()), timezone: v.optional(v.string()), verifiedDomains: v.optional(v.array(v.string())), status: v.optional(v.union(v.literal("active"), v.literal("suspended"), v.literal("archived"))), requestId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx, args.operatorSessionId);
    if (actor.operatorSession!.mode !== "manage") throw new Error("AUTH_OPERATOR_MANAGE_REQUIRED: Re-enter the school with manage access.");
    const school = actor.operationalSchool!;
    if (args.timezone) {
      try { new Intl.DateTimeFormat("en", { timeZone: args.timezone }); } catch { throw new Error("SCHOOL_TIMEZONE_INVALID: Choose a valid IANA timezone."); }
    }
    const now = Date.now();
    await ctx.db.patch(school._id, {
      name: args.name?.trim().replace(/\s+/g, " ").slice(0, 140) || school.name,
      timezone: args.timezone ?? school.timezone,
      verifiedDomains: args.verifiedDomains ? domains(args.verifiedDomains) : school.verifiedDomains,
      status: args.status ?? school.status,
      policyVersion: school.policyVersion + 1,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, { actorAccountId: actor.accountId, schoolId: school._id, operatorSessionId: actor.operatorSession!._id, action: "school.updated", targetType: "school", targetId: school._id, metadata: { status: args.status ?? school.status, policyVersion: school.policyVersion + 1 }, requestId: args.requestId, retentionClass: "security" });
    return { schoolId: school._id, policyVersion: school.policyVersion + 1, updatedAt: now };
  },
});
