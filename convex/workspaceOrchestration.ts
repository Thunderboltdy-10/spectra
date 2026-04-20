import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUserByClerkId } from "./helpers";
import { buildWorkspaceSearchText, recordWorkspaceMutation } from "./workspaceHelpers";

type WorkspaceTemplateSuggestion = {
  id: string;
  label: string;
  description: string;
  viewMode: "byType" | "byTopic" | "timeline";
  backgroundMode: "dots" | "blank" | "grid";
  groups: Array<{
    id: string;
    label: string;
    kinds: string[];
  }>;
  starterActions: string[];
};

const TEMPLATE_LIBRARY: Array<{
  id: string;
  keywords: string[];
  subjectCodes: string[];
  template: WorkspaceTemplateSuggestion;
}> = [
  {
    id: "physics-course",
    keywords: ["physics", "waves", "mechanics", "electricity", "ia", "hl", "sl"],
    subjectCodes: ["physics"],
    template: {
      id: "physics-course",
      label: "Physics course",
      description: "Artifacts, threads, and planner scaffolding for a concept-heavy science workspace.",
      viewMode: "byType",
      backgroundMode: "dots",
      groups: [
        { id: "notes", label: "Concept notes", kinds: ["note", "visual", "code"] },
        { id: "practice", label: "Practice + review", kinds: ["quiz", "flashcard_deck", "thread"] },
        { id: "planning", label: "Deadlines + IA", kinds: ["planner", "export"] },
      ],
      starterActions: [
        "Create a note for the current topic",
        "Create a planner item for the next assessment",
        "Generate a quiz from recent notes",
      ],
    },
  },
  {
    id: "essay-project",
    keywords: ["essay", "tok", "english", "history", "paper", "draft"],
    subjectCodes: ["english", "history", "tok"],
    template: {
      id: "essay-project",
      label: "Essay project",
      description: "A writing-focused workspace with research, draft, and submission flow.",
      viewMode: "byType",
      backgroundMode: "blank",
      groups: [
        { id: "research", label: "Research", kinds: ["thread", "note", "visual"] },
        { id: "drafts", label: "Drafts", kinds: ["note", "export"] },
        { id: "submission", label: "Submission plan", kinds: ["planner", "export"] },
      ],
      starterActions: [
        "Create a research note",
        "Create a planner item for the next draft milestone",
        "Open a thread for argument refinement",
      ],
    },
  },
  {
    id: "coding-project",
    keywords: ["code", "coding", "computer", "cs", "programming", "app", "project"],
    subjectCodes: ["computer_science", "cs"],
    template: {
      id: "coding-project",
      label: "Coding project",
      description: "Code-first workspace with implementation, debugging, and output lanes.",
      viewMode: "byType",
      backgroundMode: "grid",
      groups: [
        { id: "implementation", label: "Implementation", kinds: ["code", "note"] },
        { id: "debug", label: "Threads + fixes", kinds: ["thread", "planner"] },
        { id: "output", label: "Output + exports", kinds: ["visual", "export"] },
      ],
      starterActions: [
        "Create a code artifact",
        "Create a debugging thread",
        "Create a planner task for the next milestone",
      ],
    },
  },
];

async function requireActor(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

function normalizeTitle(title: string) {
  return title.trim().toLowerCase();
}

function inferTemplate(title: string): WorkspaceTemplateSuggestion | null {
  const normalized = normalizeTitle(title);
  if (!normalized) return null;

  const best = TEMPLATE_LIBRARY
    .map((entry) => ({
      entry,
      score: entry.keywords.reduce((acc, keyword) => acc + (normalized.includes(keyword) ? 2 : 0), 0)
        + entry.subjectCodes.reduce((acc, code) => acc + (normalized.includes(code) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score)[0];

  return best && best.score > 0 ? best.entry.template : null;
}

export const listTemplates = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.actorClerkId);
    return TEMPLATE_LIBRARY.map((entry) => entry.template);
  },
});

export const suggestTemplate = mutation({
  args: { actorClerkId: v.string(), title: v.string() },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.actorClerkId);
    return {
      title: args.title,
      suggestion: inferTemplate(args.title),
    };
  },
});

function tokenizeTopic(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 2);
}

function keywordScore(source: string, tokens: string[]) {
  const haystack = source.toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

export const suggestWorkspaceFromTopic = query({
  args: {
    actorClerkId: v.string(),
    topic: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const topic = args.topic.trim();
    if (!topic) {
      return { shouldSuggest: false, topic: "", suggestions: [] };
    }

    const tokens = tokenizeTopic(topic);
    const limit = Math.max(1, Math.min(args.limit ?? 8, 20));

    const [workstreams, artifacts, plannerItems, chats] = await Promise.all([
      ctx.db.query("workstreams").withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id)).order("desc").take(100),
      ctx.db.query("artifacts").withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id)).order("desc").take(150),
      ctx.db.query("plannerItems").withIndex("by_owner", (q) => q.eq("ownerUserId", actor._id)).collect(),
      ctx.db.query("chats").withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id)).order("desc").take(120),
    ]);

    const suggestions = workstreams
      .filter((row) => row.orgId === actor.orgId && row.status === "active")
      .map((workstream) => {
        const workspaceArtifacts = artifacts.filter((row) => row.orgId === actor.orgId && row.workstreamId === workstream._id && row.status === "active");
        const workspacePlanner = plannerItems.filter((row) => row.orgId === actor.orgId && row.workstreamId === workstream._id && row.status !== "cancelled");
        const workspaceChats = chats.filter((row) => row.orgId === actor.orgId && row.workstreamId === workstream._id && !row.deletedAt);
        const corpus = buildWorkspaceSearchText(
          workstream.title,
          workstream.description,
          ...workspaceArtifacts.slice(0, 8).flatMap((row) => [row.title, row.contentPlaintext]),
          ...workspacePlanner.slice(0, 8).flatMap((row) => [row.title, row.description]),
          ...workspaceChats.slice(0, 6).flatMap((row) => [row.title, row.latestUserPrompt]),
        );
        const score = keywordScore(corpus, tokens);
        return {
          workstreamId: workstream._id,
          title: workstream.title,
          score,
          supportingArtifacts: workspaceArtifacts.length,
          supportingThreads: workspaceChats.length,
          supportingPlannerItems: workspacePlanner.length,
        };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || b.supportingArtifacts - a.supportingArtifacts)
      .slice(0, limit);

    return {
      shouldSuggest: suggestions.length === 0,
      topic,
      suggestions,
    };
  },
});

export const createWorkstream = mutation({
  args: {
    actorClerkId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    emoji: v.optional(v.string()),
    color: v.optional(v.string()),
    type: v.optional(v.union(v.literal("subject"), v.literal("project"), v.literal("general"))),
    provenanceSource: v.optional(v.union(v.literal("user"), v.literal("ai"), v.literal("system"))),
    mutationSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const title = args.title.trim();
    if (!title) throw new Error("title is required");
    const now = Date.now();
    const workstreamId = await ctx.db.insert("workstreams", {
      ownerUserId: actor._id,
      orgId: actor.orgId,
      type: args.type ?? "general",
      title,
      description: args.description?.trim() || undefined,
      emoji: args.emoji?.trim() || undefined,
      color: args.color?.trim() || undefined,
      status: "active",
      artifactCount: 0,
      threadCount: 0,
      workspaceRevision: now,
      workspaceRevisionKey: `init:${now}`,
      createdAt: now,
      updatedAt: now,
    });

    const mutationId = await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: workstreamId as Id<"workstreams">,
      mutationType: "create_workstream",
      source: args.provenanceSource ?? "user",
      entity: "workspace",
      action: "created",
      summary: args.mutationSummary ?? `Created workspace ${title}`,
      after: { workstreamId, title },
    });

    return { workstreamId, mutationId };
  },
});
