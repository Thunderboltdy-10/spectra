import { mutation, query } from "./functions";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireArtifactCapability, requireWorkspaceCapability, requireSpectraActor } from "./spectraShared";

const vRelationType = v.union(
  v.literal("related"),
  v.literal("supports"),
  v.literal("contradicts"),
  v.literal("source_for"),
  v.literal("generated_from"),
  v.literal("follow_up"),
  v.literal("belongs_with"),
);

async function hydrate(ctx: Parameters<typeof requireSpectraActor>[0], artifactId: Id<"spectraArtifacts">) {
  const { artifact } = await requireArtifactCapability(ctx, artifactId).catch(() => ({ artifact: null }));
  return artifact && artifact.status === "active"
    ? { id: artifact._id, title: artifact.title, summary: artifact.summary, blueprintKey: artifact.blueprintKey, updatedAt: artifact.updatedAt }
    : null;
}

export const listForArtifact = query({
  args: { artifactId: v.id("spectraArtifacts"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireArtifactCapability(ctx, args.artifactId);
    const limit = Math.max(1, Math.min(args.limit ?? 20, 50));
    const [outgoing, incoming] = await Promise.all([
      ctx.db.query("spectraArtifactLinks").withIndex("by_source", (q) => q.eq("sourceArtifactId", args.artifactId)).order("desc").take(limit),
      ctx.db.query("spectraArtifactLinks").withIndex("by_target", (q) => q.eq("targetArtifactId", args.artifactId)).order("desc").take(limit),
    ]);
    const rows = [...outgoing.map((link) => ({ link, direction: "outgoing" as const, peerId: link.targetArtifactId })), ...incoming.map((link) => ({ link, direction: "incoming" as const, peerId: link.sourceArtifactId }))]
      .sort((a, b) => b.link.updatedAt - a.link.updatedAt)
      .slice(0, limit);
    return Promise.all(rows.map(async (row) => ({ ...row.link, direction: row.direction, artifact: await hydrate(ctx, row.peerId) })));
  },
});

export const create = mutation({
  args: {
    sourceArtifactId: v.id("spectraArtifacts"),
    targetArtifactId: v.id("spectraArtifacts"),
    relationType: vRelationType,
    label: v.optional(v.string()),
    explanation: v.optional(v.string()),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    createdBy: v.optional(v.union(v.literal("user"), v.literal("ai"), v.literal("system"))),
    runId: v.optional(v.id("spectraAiRuns")),
  },
  handler: async (ctx, args) => {
    const { actor } = await requireArtifactCapability(ctx, args.sourceArtifactId, "modify");
    await requireArtifactCapability(ctx, args.targetArtifactId);
    if (args.sourceArtifactId === args.targetArtifactId) throw new Error("An artifact cannot link to itself");
    if (args.workspaceId) await requireWorkspaceCapability(ctx, args.workspaceId, "modify");
    const existing = await ctx.db.query("spectraArtifactLinks")
      .withIndex("by_pair", (q) => q.eq("sourceArtifactId", args.sourceArtifactId).eq("targetArtifactId", args.targetArtifactId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        relationType: args.relationType,
        label: args.label?.trim().slice(0, 80) || undefined,
        explanation: args.explanation?.trim().slice(0, 280) || undefined,
        workspaceId: args.workspaceId,
        updatedAt: now,
      });
      return { linkId: existing._id, created: false };
    }
    const createdBy = args.createdBy ?? "user";
    const linkId = await ctx.db.insert("spectraArtifactLinks", {
      ownerAccountId: actor._id,
      schoolId: actor.schoolId,
      sourceArtifactId: args.sourceArtifactId,
      targetArtifactId: args.targetArtifactId,
      relationType: args.relationType,
      label: args.label?.trim().slice(0, 80) || undefined,
      explanation: args.explanation?.trim().slice(0, 280) || undefined,
      provenance: { source: createdBy, runId: args.runId, reason: args.explanation?.trim().slice(0, 280) || undefined },
      createdBy,
      workspaceId: args.workspaceId,
      createdAt: now,
      updatedAt: now,
    });
    return { linkId, created: true };
  },
});

export const remove = mutation({
  args: { linkId: v.id("spectraArtifactLinks") },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId);
    if (!link) throw new Error("Artifact link not found");
    await requireArtifactCapability(ctx, link.sourceArtifactId, "modify");
    await ctx.db.delete(args.linkId);
    return { linkId: args.linkId };
  },
});

