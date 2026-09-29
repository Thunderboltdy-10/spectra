import { type MutationCtx } from "./_generated/server";
import { query } from "./functions";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { resolveActorContext } from "./identityShared";

export type OperationalCounterCategory =
  | "artifact_created"
  | "thread_message"
  | "ai_run_started"
  | "ai_run_failed"
  | "workspace_created"
  | "workspace_imported"
  | "agent_invocation";

function utcDay(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export async function incrementOperationalCounter(
  ctx: MutationCtx,
  input: {
    schoolId?: Id<"schools">;
    category: OperationalCounterCategory;
    dimension?: string;
    quantity?: number;
    occurredAt?: number;
  },
) {
  const quantity = input.quantity ?? 1;
  if (!Number.isFinite(quantity) || quantity <= 0)
    throw new Error("OPERATIONAL_COUNTER_INVALID: Quantity must be positive.");
  const day = utcDay(input.occurredAt ?? Date.now());
  const dimension = (input.dimension?.trim() || "all").slice(0, 100);
  const existing = await ctx.db
    .query("operationalCounters")
    .withIndex("by_counter", (q) =>
      q
        .eq("schoolId", input.schoolId)
        .eq("day", day)
        .eq("category", input.category)
        .eq("dimension", dimension),
    )
    .unique();
  const now = Date.now();
  if (existing)
    await ctx.db.patch(existing._id, {
      quantity: existing.quantity + quantity,
      updatedAt: now,
    });
  else
    await ctx.db.insert("operationalCounters", {
      schoolId: input.schoolId,
      day,
      category: input.category,
      dimension,
      quantity,
      updatedAt: now,
    });
}

export const schoolSummary = query({
  args: {
    schoolId: v.id("schools"),
    fromDay: v.string(),
    toDay: v.string(),
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
  },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx, args.operatorSessionId);
    const localAdmin =
      actor.membership?.schoolId === args.schoolId &&
      actor.membership.role === "school_admin";
    const operator =
      actor.operatorSession?.schoolId === args.schoolId &&
      actor.operationalSchool?._id === args.schoolId;
    if (!localAdmin && !operator)
      throw new Error(
        "AUTH_OPERATIONAL_COUNTER_REQUIRED: School administrator access is required.",
      );
    const rows = await ctx.db
      .query("operationalCounters")
      .withIndex("by_school_day", (q) =>
        q
          .eq("schoolId", args.schoolId)
          .gte("day", args.fromDay)
          .lte("day", args.toDay),
      )
      .collect();
    return rows;
  },
});
