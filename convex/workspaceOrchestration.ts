import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  recordWorkspaceMutation,
  requireWorkspaceActor,
  summarizeWorkspaceContent,
} from "./workspaceHelpers";

const vWorkstreamType = v.union(
  v.literal("subject"),
  v.literal("project"),
  v.literal("general"),
);

const vWorkspaceMutationSource = v.union(
  v.literal("user"),
  v.literal("ai"),
  v.literal("system"),
);

function normalizeTopic(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function scoreTopicMatch(topic: string, parts: Array<string | undefined>) {
  const normalizedTopic = topic.toLowerCase();
  const haystack = parts.filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(normalizedTopic);
}

function resolveWorkstreamTypeForTopic(topic: string) {
  const normalized = topic.toLowerCase();
  if (
    normalized.includes("essay")
    || normalized.includes("application")
    || normalized.includes("cas")
    || normalized.includes("project")
    || normalized.includes("portfolio")
  ) {
    return "project" as const;
  }
  return "general" as const;
}

export const createWorkstream = mutation({
  args: {
    actorClerkId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    emoji: v.optional(v.string()),
    color: v.optional(v.string()),
    type: v.optional(vWorkstreamType),
    provenanceSource: v.optional(vWorkspaceMutationSource),
    mutationSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWorkspaceActor(ctx, args.actorClerkId);
    const title = normalizeTopic(args.title);
    if (!title) throw new Error("title is required");

    const now = Date.now();
    const workstreamId = await ctx.db.insert("workstreams", {
      ownerUserId: actor._id,
      orgId: actor.orgId,
      type: args.type ?? resolveWorkstreamTypeForTopic(title),
      title,
      description: args.description?.trim() || undefined,
      emoji: args.emoji?.trim() || undefined,
      color: args.color?.trim() || undefined,
      status: "active",
      artifactCount: 0,
      threadCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    const mutationId = await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId,
      targetWorkstreamId: workstreamId,
      mutationType: "create_workstream",
      source: args.provenanceSource ?? "ai",
      summary: args.mutationSummary ?? `Created workstream ${title}`,
      after: { workstreamId, title },
      revertData: { kind: "archive_workstream", workstreamId },
    });

    return { workstreamId, mutationId };
  },
});

export const suggestWorkspaceFromTopic = query({
  args: {
    actorClerkId: v.string(),
    topic: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWorkspaceActor(ctx, args.actorClerkId);
    const topic = normalizeTopic(args.topic);
    if (!topic) {
      return {
        topic: "",
        score: 0,
        shouldSuggest: false,
        existingMatch: null,
        evidence: [],
        mergeCandidates: [],
      };
    }

    const limit = Math.max(1, Math.min(args.limit ?? 8, 20));
    const orgId = actor.orgId;
    const [workstreams, chats, artifacts, plannerItems] = await Promise.all([
      ctx.db
        .query("workstreams")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", actor._id))
        .filter((q) => q.eq(q.field("orgId"), orgId))
        .collect(),
      ctx.db
        .query("chats")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", actor._id))
        .filter((q) => q.eq(q.field("orgId"), orgId))
        .collect(),
      ctx.db
        .query("artifacts")
        .withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id))
        .order("desc")
        .take(200),
      ctx.db
        .query("plannerItems")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", actor._id))
        .filter((q) => q.eq(q.field("orgId"), orgId))
        .collect(),
    ]);

    const existingMatch = workstreams.find((workstream) =>
      scoreTopicMatch(topic, [workstream.title, workstream.description]),
    ) ?? null;

    const matchingChats = chats
      .filter((chat) => !chat.deletedAt)
      .filter((chat) => scoreTopicMatch(topic, [
        chat.title,
        chat.latestUserPrompt,
        chat.contextSummary,
      ]));

    const matchingArtifacts = artifacts
      .filter((artifact) => artifact.status === "active" && artifact.orgId === orgId)
      .filter((artifact) => scoreTopicMatch(topic, [
        artifact.title,
        artifact.contentPlaintext,
        artifact.type,
      ]));

    const matchingPlannerItems = plannerItems
      .filter((item) => scoreTopicMatch(topic, [
        item.title,
        item.description,
      ]));

    const timestamps = [
      ...matchingChats.map((chat) => chat.updatedAt),
      ...matchingArtifacts.map((artifact) => artifact.updatedAt),
      ...matchingPlannerItems.map((item) => item.updatedAt),
    ].sort((a, b) => a - b);

    const spansMultipleDays = timestamps.length >= 2
      && timestamps[timestamps.length - 1]! - timestamps[0]! > 3 * 24 * 60 * 60 * 1000;

    const baseScore = (
      matchingChats.length * 3
      + matchingArtifacts.length * 4
      + matchingPlannerItems.length * 2
    );
    const score = spansMultipleDays ? baseScore * 1.5 : baseScore;

    const mergeCandidates = [
      ...matchingChats.map((chat) => ({
        sourceKind: "chat" as const,
        sourceId: chat._id,
        title: chat.title,
        summary: summarizeWorkspaceContent(chat.latestUserPrompt ?? chat.contextSummary ?? undefined),
        updatedAt: chat.updatedAt,
      })),
      ...matchingArtifacts.map((artifact) => ({
        sourceKind: "artifact" as const,
        sourceId: artifact._id,
        title: artifact.title,
        summary: summarizeWorkspaceContent(artifact.contentPlaintext),
        updatedAt: artifact.updatedAt,
      })),
      ...matchingPlannerItems.map((item) => ({
        sourceKind: "plannerItem" as const,
        sourceId: item._id,
        title: item.title,
        summary: summarizeWorkspaceContent(item.description),
        updatedAt: item.updatedAt,
      })),
    ]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);

    const evidence = [
      `${matchingChats.length} matching chat session${matchingChats.length === 1 ? "" : "s"}`,
      `${matchingArtifacts.length} related artifact${matchingArtifacts.length === 1 ? "" : "s"}`,
      `${matchingPlannerItems.length} related planner item${matchingPlannerItems.length === 1 ? "" : "s"}`,
      spansMultipleDays ? "engagement spans multiple days" : "engagement concentrated in a short window",
      existingMatch ? `existing workstream overlap: ${existingMatch.title}` : "no close workstream title match",
    ];

    return {
      topic,
      score,
      shouldSuggest: score >= 15 && !existingMatch,
      suggestedType: resolveWorkstreamTypeForTopic(topic),
      existingMatch: existingMatch
        ? {
            workstreamId: existingMatch._id,
            title: existingMatch.title,
          }
        : null,
      evidence,
      mergeCandidates,
    };
  },
});
