import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUserByClerkId } from "./helpers";

const vDefaultLanding = v.union(v.literal("smart"), v.literal("workspace"), v.literal("chat"));
const vEditorMode = v.union(v.literal("agentic"), v.literal("notion"), v.literal("simple"));
const vWorkspaceLayout = v.object({
  x: v.number(),
  y: v.number(),
  z: v.number(),
});

async function requireActor(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

async function listPreferenceRows(ctx: Parameters<typeof getUserByClerkId>[0], userId: Id<"users">) {
  const rows = await ctx.db
    .query("userPreferences")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  return rows;
}

export const get = query({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const rows = await listPreferenceRows(ctx, actor._id);
    const current = rows[0];

    return {
      userId: actor._id,
      orgId: actor.orgId,
      defaultLanding: current?.defaultLanding ?? "smart",
      workspaceLayout: current?.workspaceLayout,
      editorDefaultMode: current?.editorDefaultMode,
      updatedAt: current?.updatedAt,
      preferenceId: current?._id,
    };
  },
});

export const upsert = mutation({
  args: {
    actorClerkId: v.string(),
    defaultLanding: v.optional(vDefaultLanding),
    workspaceLayout: v.optional(v.union(vWorkspaceLayout, v.null())),
    editorDefaultMode: v.optional(v.union(vEditorMode, v.null())),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const rows = await listPreferenceRows(ctx, actor._id);
    const current = rows[0];
    const now = Date.now();

    const patch: Record<string, unknown> = {
      updatedAt: now,
    };

    if (args.defaultLanding !== undefined) patch.defaultLanding = args.defaultLanding;
    if (args.workspaceLayout !== undefined) patch.workspaceLayout = args.workspaceLayout ?? undefined;
    if (args.editorDefaultMode !== undefined) patch.editorDefaultMode = args.editorDefaultMode ?? undefined;

    if (!current) {
      const preferenceId = await ctx.db.insert("userPreferences", {
        userId: actor._id,
        orgId: actor.orgId,
        defaultLanding: args.defaultLanding ?? "smart",
        workspaceLayout: args.workspaceLayout ?? undefined,
        editorDefaultMode: args.editorDefaultMode ?? undefined,
        updatedAt: now,
      });
      return { preferenceId };
    }

    await ctx.db.patch(current._id, patch);

    if (rows.length > 1) {
      for (const duplicate of rows.slice(1)) {
        await ctx.db.delete(duplicate._id);
      }
    }

    return { preferenceId: current._id };
  },
});

export const remove = mutation({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const rows = await listPreferenceRows(ctx, actor._id);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return { success: true, deleted: rows.length };
  },
});
