import { v } from "convex/values";
import { mutation, query } from "./functions";
import { resolveActorContext } from "./identityShared";
import { writeAuditEvent } from "./auditShared";
import type { QueryCtx } from "./_generated/server";

/**
 * Walkthrough requests from the landing page's close. Only the site's own
 * server writes them (the contact route, after its guards, with the bridge
 * key), one per email address: a second request from the same address is
 * not stored again. The platform team reads them in the superadmin.
 */
const status = v.union(v.literal("new"), v.literal("answered"), v.literal("closed"));

async function operator(ctx: QueryCtx) {
  const actor = await resolveActorContext(ctx);
  if (!actor.platformOperator)
    throw new Error("AUTH_OPERATOR_REQUIRED: Platform operator access is required.");
  return actor;
}

/** The same length and every character equal, read in full whatever the answer. */
function sameKey(given: string, expected: string) {
  let difference = given.length ^ expected.length;
  for (let index = 0; index < expected.length; index += 1)
    difference |= (given.charCodeAt(index % Math.max(1, given.length)) || 0) ^ expected.charCodeAt(index);
  return difference === 0;
}

export const submit = mutation({
  args: {
    key: v.string(),
    email: v.string(),
    name: v.string(),
    school: v.string(),
    role: v.string(),
    message: v.string(),
    usesManageBac: v.boolean(),
  },
  handler: async (ctx, args) => {
    const expected = process.env.SPECTRA_SECRET_BRIDGE_KEY;
    if (!expected || expected.length < 32)
      throw new Error("LANDING_REQUESTS_CONFIG_MISSING: The site's server key is not configured.");
    if (!sameKey(args.key, expected))
      throw new Error("AUTH_SERVER_REQUIRED: Only the site's server can send requests.");
    const email = args.email.trim().toLowerCase().slice(0, 320);
    const earlier = await ctx.db
      .query("landingRequests")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (earlier) return { status: "already" as const };
    const now = Date.now();
    await ctx.db.insert("landingRequests", {
      email,
      name: args.name.slice(0, 200),
      school: args.school.slice(0, 300),
      role: args.role.slice(0, 100),
      message: args.message.slice(0, 2000),
      usesManageBac: args.usesManageBac,
      status: "new",
      createdAt: now,
      updatedAt: now,
    });
    return { status: "sent" as const };
  },
});

export const list = query({
  args: { open: v.boolean() },
  handler: async (ctx, args) => {
    await operator(ctx);
    const statuses = args.open ? (["new"] as const) : (["answered", "closed"] as const);
    const rows = (
      await Promise.all(
        statuses.map((which) =>
          ctx.db
            .query("landingRequests")
            .withIndex("by_status_created", (q) => q.eq("status", which))
            .order("desc")
            .take(150),
        ),
      )
    )
      .flat()
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 150);
    return rows.map((row) => ({
      requestId: row._id,
      email: row.email,
      name: row.name,
      school: row.school,
      role: row.role,
      message: row.message,
      usesManageBac: row.usesManageBac,
      status: row.status,
      createdAt: row.createdAt,
    }));
  },
});

export const setStatus = mutation({
  args: { requestId: v.id("landingRequests"), status },
  handler: async (ctx, args) => {
    const actor = await operator(ctx);
    const row = await ctx.db.get(args.requestId);
    if (!row) throw new Error("LANDING_REQUEST_NOT_FOUND: This request no longer exists.");
    await ctx.db.patch(row._id, { status: args.status, updatedAt: Date.now() });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      action: "landing_request.status.changed",
      targetType: "landing_request",
      targetId: row._id,
      metadata: { status: args.status },
    });
    return { requestId: row._id, status: args.status };
  },
});
