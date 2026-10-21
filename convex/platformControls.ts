import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { query } from "./functions";
import { mutation } from "./orgNodeMutation";
import { resolveActorContext } from "./identityShared";
import { writeAuditEvent } from "./auditShared";

/**
 * The platform emergency stop. "ai" refuses new model work and ends running
 * turns at their next heartbeat; "background" pauses scheduled maintenance
 * (indexing, memory, snapshots, briefs, sync sweeps). Both are reversible and
 * neither touches sign-in, data, or the operator console.
 */
export type PlatformScope = "ai" | "background";

const scope = v.union(v.literal("ai"), v.literal("background"));

const STOPPED_MESSAGES: Record<PlatformScope, string> = {
  ai: "PLATFORM_STOPPED: Spectra's AI is paused by the Spectra team for a moment. Your work is safe; try again shortly.",
  background:
    "PLATFORM_STOPPED: Spectra's background work is paused by the Spectra team. Your work is safe.",
};

async function control(ctx: QueryCtx | MutationCtx, which: PlatformScope) {
  return ctx.db
    .query("platformControls")
    .withIndex("by_scope", (q) => q.eq("scope", which))
    .unique();
}

export async function platformStopped(ctx: QueryCtx | MutationCtx, which: PlatformScope) {
  return (await control(ctx, which))?.stopped === true;
}

export async function assertPlatformRunning(ctx: QueryCtx | MutationCtx, which: PlatformScope) {
  if (await platformStopped(ctx, which)) throw new Error(STOPPED_MESSAGES[which]);
}

/** What every signed-in surface needs to explain a pause. The reason is the
 * operator's note and is shown only in the console. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const [ai, background] = await Promise.all([control(ctx, "ai"), control(ctx, "background")]);
    const actor = await resolveActorContext(ctx).catch(() => null);
    const view = (row: typeof ai) => ({
      stopped: row?.stopped === true,
      since: row?.stopped ? row.updatedAt : null,
      ...(actor?.platformOperator ? { reason: row?.reason ?? null } : {}),
    });
    return { ai: view(ai), background: view(background) };
  },
});

export const setStopped = mutation({
  args: { scope, stopped: v.boolean(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx);
    if (!actor.platformOperator)
      throw new Error("AUTH_OPERATOR_REQUIRED: Platform operator access is required.");
    const now = Date.now();
    const reason = args.reason?.trim().slice(0, 500) || undefined;
    const existing = await control(ctx, args.scope);
    const next = {
      stopped: args.stopped,
      reason: args.stopped ? reason : undefined,
      updatedByAccountId: actor.accountId,
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, next);
    else await ctx.db.insert("platformControls", { scope: args.scope, ...next });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      action: args.stopped ? "platform.emergency.stopped" : "platform.emergency.resumed",
      targetType: "platform",
      targetId: args.scope,
      ...(reason ? { metadata: { reason } } : {}),
      retentionClass: "security",
    });
    return { scope: args.scope, stopped: args.stopped };
  },
});
