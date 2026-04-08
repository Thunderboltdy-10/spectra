import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUserByClerkId } from "./helpers";

async function requireActor(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

async function assertWorkstreamOwnership(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireActor>>,
  workstreamId: Id<"workstreams">,
) {
  const workstream = await ctx.db.get(workstreamId);
  if (!workstream || workstream.ownerUserId !== actor._id || workstream.orgId !== actor.orgId) {
    throw new Error("Workstream not found");
  }
  return workstream;
}

function normalizeText(value: string | undefined, max = 240) {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function buildSessionKey(workstreamId: string) {
  const day = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  return `${workstreamId}:${day}`;
}

function buildGhostPosition(index: number) {
  return { x: 1180 + index * 340, y: 880 };
}

function normalizeGhostText(value: string | undefined, max = 320) {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function hashContext(parts: Array<string | undefined>) {
  const raw = parts
    .map((part) => (part ?? "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) >>> 0;
  }
  return `ctx_${hash.toString(16)}`;
}

async function gatherWorkstreamContext(
  ctx: Parameters<typeof getUserByClerkId>[0],
  workstreamId: Id<"workstreams">,
) {
  const [artifacts, notes, plannerItems, linkedAgent] = await Promise.all([
    ctx.db
      .query("artifacts")
      .withIndex("by_workstream", (q) => q.eq("workstreamId", workstreamId))
      .collect(),
    ctx.db
      .query("notes")
      .withIndex("by_workstream", (q) => q.eq("workstreamId", workstreamId))
      .collect(),
    ctx.db
      .query("plannerItems")
      .withIndex("by_workstream", (q) => q.eq("workstreamId", workstreamId))
      .collect(),
    (async () => {
      const workstream = await ctx.db.get(workstreamId);
      if (!workstream?.linkedAgentId) return null;
      return ctx.db.get(workstream.linkedAgentId);
    })(),
  ]);

  const activeArtifacts = artifacts.filter((artifact) => artifact.status === "active").sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 8);
  const activeNotes = notes.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 6);
  const activePlannerItems = plannerItems.filter((item) => item.status !== "completed").sort((left, right) => (right.dueAt ?? right.updatedAt) - (left.dueAt ?? left.updatedAt)).slice(0, 8);
  const overduePlannerItems = activePlannerItems.filter((item) => typeof item.dueAt === "number" && item.dueAt < Date.now());
  const dueSoonPlannerItems = activePlannerItems.filter((item) => typeof item.dueAt === "number" && item.dueAt >= Date.now() && item.dueAt - Date.now() <= 1000 * 60 * 60 * 24 * 4);
  const hasQuiz = activeArtifacts.some((artifact) => artifact.type === "quiz");
  const hasFlashcards = activeArtifacts.some((artifact) => artifact.type === "flashcard_deck");
  const latestArtifactTitle = activeArtifacts[0]?.title;
  const latestNoteTitle = activeNotes[0]?.title;
  const latestPlannerTitle = activePlannerItems[0]?.title;

  return {
    linkedAgent,
    activeArtifacts,
    activeNotes,
    activePlannerItems,
    overduePlannerItems,
    dueSoonPlannerItems,
    hasQuiz,
    hasFlashcards,
    latestArtifactTitle,
    latestNoteTitle,
    latestPlannerTitle,
  };
}

function buildGhostCandidates(params: {
  workstream: {_id: Id<"workstreams">; title: string; description?: string; subjectCode?: string; linkedAgentId?: Id<"agents">};
  context: Awaited<ReturnType<typeof gatherWorkstreamContext>>;
  confidenceTier: "high" | "medium" | "low";
  confidenceScore: number;
}) {
  const { workstream, context, confidenceTier, confidenceScore } = params;
  const candidates: Array<{
    title: string;
    summary: string;
    content: string;
    suggestionKind: "note" | "planner" | "quiz" | "flashcard_deck" | "visualization" | "code_project";
    renderMode: string;
    category: string;
    similarityKey: string;
    contextSignals: string[];
    resourceContext?: string;
    generationReason: string;
  }> = [];

  if (context.overduePlannerItems.length > 0) {
    const titles = context.overduePlannerItems.slice(0, 3).map((item) => item.title).filter(Boolean);
    candidates.push({
      title: `Catch up on ${titles[0] ?? workstream.title}` ,
      summary: `Turn overdue work into a concrete recovery checklist for ${workstream.title}.`,
      content: `Create a recovery plan for overdue items in ${workstream.title}: ${titles.join(', ')}.`,
      suggestionKind: "planner",
      renderMode: "study_plan",
      category: "planner",
      similarityKey: hashContext([workstream._id, "overdue", ...titles]),
      contextSignals: ["overdue_deadlines", "planner_gap", confidenceTier],
      generationReason: "Detected overdue planner items that need a recovery plan.",
      resourceContext: context.linkedAgent ? `Linked agent: ${context.linkedAgent.name}` : undefined,
    });
  }

  if (!context.hasQuiz && (context.activeNotes.length > 0 || context.activeArtifacts.length > 0)) {
    const anchor = context.latestNoteTitle ?? context.latestArtifactTitle ?? workstream.title;
    candidates.push({
      title: `${anchor} practice quiz`,
      summary: `Generate a quiz so ${workstream.title} has a ready-made retrieval practice artifact.`,
      content: `Create a short quiz based on ${anchor} for ${workstream.title}.`,
      suggestionKind: "quiz",
      renderMode: "quiz",
      category: "visualizations",
      similarityKey: hashContext([workstream._id, "quiz", anchor]),
      contextSignals: ["study_gap", "no_quiz", confidenceTier],
      generationReason: "Workspace has study material but no quiz artifact yet.",
      resourceContext: context.linkedAgent ? `Agent-guided practice using ${context.linkedAgent.name}` : undefined,
    });
  }

  if (!context.hasFlashcards && context.activeNotes.length > 0) {
    const anchor = context.latestNoteTitle ?? workstream.title;
    candidates.push({
      title: `${anchor} flashcards`,
      summary: `Convert the latest notes into spaced-repetition prompts.`,
      content: `Create flashcards covering ${anchor} in ${workstream.title}.`,
      suggestionKind: "flashcard_deck",
      renderMode: "flashcard_deck",
      category: "documents",
      similarityKey: hashContext([workstream._id, "flashcards", anchor]),
      contextSignals: ["spaced_repetition_gap", "notes_present", confidenceTier],
      generationReason: "Recent notes exist without a supporting flashcard deck.",
      resourceContext: context.linkedAgent ? `Resource-aware prompts from ${context.linkedAgent.name}` : undefined,
    });
  }

  if (context.linkedAgent && !context.hasQuiz) {
    const anchor = context.latestArtifactTitle ?? context.latestNoteTitle ?? workstream.title;
    candidates.push({
      title: `${context.linkedAgent.name} checkpoint`,
      summary: `${context.linkedAgent.name} can suggest the next missing concept for ${workstream.title}.`,
      content: `Use ${context.linkedAgent.name} resources to identify the next checkpoint after ${anchor}.`,
      suggestionKind: "note",
      renderMode: "document",
      category: "documents",
      similarityKey: hashContext([workstream._id, "agent", context.linkedAgent._id, anchor]),
      contextSignals: ["linked_agent_resources", "agent_gap_detection", confidenceTier],
      generationReason: "Linked agent resources indicate an uncovered next step.",
      resourceContext: `Agent resource context: ${context.linkedAgent.name}${context.linkedAgent.subjectArea ? ` (${context.linkedAgent.subjectArea})` : ""}`,
    });
  }

  if (candidates.length === 0) {
    const anchor = context.latestArtifactTitle ?? context.latestNoteTitle ?? context.latestPlannerTitle ?? workstream.title;
    candidates.push({
      title: `${workstream.title} next step`,
      summary: `Suggest the next useful artifact to keep ${workstream.title} moving.`,
      content: `Create the next best supporting note for ${anchor}.`,
      suggestionKind: "note",
      renderMode: "document",
      category: "documents",
      similarityKey: hashContext([workstream._id, "next-step", anchor]),
      contextSignals: ["general_gap", confidenceTier],
      generationReason: "General workspace gap detection fallback.",
    });
  }

  return candidates.map((candidate, index) => ({
    ...candidate,
    confidenceTier,
    confidenceScore: Number(confidenceScore.toFixed(2)),
    x: buildGhostPosition(index).x,
    y: buildGhostPosition(index).y,
  }));
}


export const listVisible = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    sessionKey: v.optional(v.string()),
    editingActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await assertWorkstreamOwnership(ctx, actor, args.workstreamId);
    if (args.editingActive) {
      return { sessionKey: args.sessionKey ?? buildSessionKey(String(args.workstreamId)), ghosts: [] };
    }

    const sessionKey = args.sessionKey ?? buildSessionKey(String(args.workstreamId));
    const rows = await ctx.db
      .query("ghostSuggestions")
      .withIndex("by_owner_workstream_status", (q) =>
        q.eq("ownerUserId", actor._id).eq("workstreamId", args.workstreamId).eq("status", "pending"))
      .collect();

    const visible = rows
      .filter((row) => row.unseenSessions < 2)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 2)
      .map((row, index) => ({
        _id: row._id,
        workstreamId: row.workstreamId,
        title: row.title,
        summary: row.summary,
        suggestionKind: row.suggestionKind,
        confidenceTier: row.confidenceTier,
        confidenceScore: row.confidenceScore,
        renderMode: row.renderMode,
        category: row.category,
        x: row.x ?? buildGhostPosition(index).x,
        y: row.y ?? buildGhostPosition(index).y,
        opacityIdle: 0.4,
        opacityHover: 0.6,
        provenanceSource: "ai" as const,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        generationModel: row.generationModel,
        modelLane: row.modelLane,
        contextSignals: row.contextSignals,
        resourceContext: row.resourceContext,
      }));

    return { sessionKey, ghosts: visible };
  },
});

export const markVisible = mutation({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    sessionKey: v.string(),
    visibleGhostIds: v.array(v.id("ghostSuggestions")),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await assertWorkstreamOwnership(ctx, actor, args.workstreamId);

    const rows = await ctx.db
      .query("ghostSuggestions")
      .withIndex("by_owner_workstream_status", (q) =>
        q.eq("ownerUserId", actor._id).eq("workstreamId", args.workstreamId).eq("status", "pending"))
      .collect();

    const visibleSet = new Set(args.visibleGhostIds.map(String));
    for (const row of rows) {
      if (visibleSet.has(String(row._id))) {
        await ctx.db.patch(row._id, {
          unseenSessions: 0,
          lastSeenSessionKey: args.sessionKey,
          updatedAt: Date.now(),
        });
      } else if (row.lastSeenSessionKey !== args.sessionKey) {
        const unseenSessions = row.unseenSessions + 1;
        await ctx.db.patch(row._id, {
          unseenSessions,
          updatedAt: Date.now(),
          ...(unseenSessions >= 2 ? { status: "expired" as const, expiredAt: Date.now() } : {}),
        });
      }
    }

    return { success: true };
  },
});

export const dismiss = mutation({
  args: {
    actorClerkId: v.string(),
    ghostId: v.id("ghostSuggestions"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const ghost = await ctx.db.get(args.ghostId);
    if (!ghost || ghost.ownerUserId !== actor._id || ghost.orgId !== actor.orgId) {
      throw new Error("Ghost not found");
    }
    await ctx.db.patch(args.ghostId, {
      status: "dismissed",
      dismissedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { success: true, similarityKey: ghost.similarityKey };
  },
});

export const accept = mutation({
  args: {
    actorClerkId: v.string(),
    ghostId: v.id("ghostSuggestions"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const ghost = await ctx.db.get(args.ghostId);
    if (!ghost || ghost.ownerUserId !== actor._id || ghost.orgId !== actor.orgId) {
      throw new Error("Ghost not found");
    }
    if (ghost.status !== "pending") {
      throw new Error("Ghost is no longer available");
    }

    const now = Date.now();
    const artifactType = ghost.suggestionKind === "note"
      ? "document"
      : ghost.suggestionKind === "planner"
        ? "study_plan"
        : ghost.suggestionKind;

    const artifactId = await ctx.db.insert("artifacts", {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: ghost.workstreamId,
      type: artifactType,
      title: ghost.title,
      content: ghost.content ?? ghost.summary ?? ghost.title,
      contentPlaintext: ghost.summary ?? ghost.content ?? ghost.title,
      status: "active",
      sourceType: "ai_generated",
      editorMode: "ai_enhanced",
      createdAt: now,
      updatedAt: now,
    });

    const workstream = await ctx.db.get(ghost.workstreamId);
    if (workstream) {
      await ctx.db.patch(ghost.workstreamId, {
        artifactCount: Math.max(0, (workstream.artifactCount ?? 0) + 1),
        updatedAt: now,
      });
    }

    const workspaceItemId = await ctx.db.insert("workspaceItems", {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: ghost.workstreamId,
      type: artifactType === "document" ? "document" : "visualization",
      itemType: "artifact",
      sourceKind: "artifact",
      sourceId: String(artifactId),
      sourceArtifactId: artifactId,
      renderMode: ghost.renderMode ?? artifactType,
      title: ghost.title,
      contentSummary: normalizeText(ghost.summary ?? ghost.content ?? ghost.title, 180),
      x: Math.round(ghost.x ?? 1180),
      y: Math.round(ghost.y ?? 880),
      category: artifactType === "document" ? "documents" : "visualizations",
      status: "active",
      pinned: false,
      provenanceSource: "ai",
      provenanceAction: "ghost_accepted",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("workspaceMutations", {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: ghost.workstreamId,
      mutationType: "create_item",
      source: "ai",
      summary: `Accepted ghost ${ghost.title}`,
      targetItemIds: [workspaceItemId],
      after: { itemId: workspaceItemId, artifactId },
      revertData: { kind: "delete_items", itemIds: [workspaceItemId] },
      status: "applied",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.ghostId, {
      status: "accepted",
      acceptedAt: now,
      acceptedArtifactId: artifactId,
      acceptedWorkspaceItemId: workspaceItemId,
      updatedAt: now,
    });

    return { success: true, artifactId, workspaceItemId };
  },
});

export const regenerateForWorkstream = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    orgId: v.id("orgs"),
    workstreamId: v.id("workstreams"),
    sourceWorkspaceMutationId: v.optional(v.id("workspaceMutations")),
    trigger: v.optional(v.string()),
    confidenceTier: v.optional(v.union(v.literal("high"), v.literal("medium"), v.literal("low"))),
    confidenceScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const workstream = await ctx.db.get(args.workstreamId);
    if (!workstream || workstream.ownerUserId !== args.ownerUserId || workstream.orgId !== args.orgId) {
      return { created: 0, invalidated: 0, reason: "workstream_not_found" as const };
    }

    const pendingRows = await ctx.db
      .query("ghostSuggestions")
      .withIndex("by_owner_workstream_status", (q) =>
        q.eq("ownerUserId", args.ownerUserId).eq("workstreamId", args.workstreamId).eq("status", "pending"))
      .collect();

    const invalidatedAt = Date.now();
    for (const row of pendingRows) {
      await ctx.db.patch(row._id, {
        status: "expired",
        expiredAt: invalidatedAt,
        updatedAt: invalidatedAt,
      });
    }

    const confidenceTier = args.confidenceTier ?? "medium";
    if (confidenceTier !== "medium") {
      return { created: 0, invalidated: pendingRows.length, reason: "non_medium_confidence" as const };
    }

    const context = await gatherWorkstreamContext(ctx, args.workstreamId);
    const candidates = buildGhostCandidates({
      workstream: {
        _id: workstream._id,
        title: workstream.title,
        description: workstream.description,
        subjectCode: workstream.subjectCode,
        linkedAgentId: workstream.linkedAgentId,
      },
      context,
      confidenceTier,
      confidenceScore: args.confidenceScore ?? 0.68,
    });

    const existingSimilarityRows = await ctx.db
      .query("ghostSuggestions")
      .withIndex("by_similarity", (q) => q.eq("ownerUserId", args.ownerUserId))
      .collect();
    const dismissedKeys = new Set(
      existingSimilarityRows
        .filter((row) => row.status === "dismissed")
        .map((row) => row.similarityKey),
    );

    let created = 0;
    for (const candidate of candidates) {
      if (dismissedKeys.has(candidate.similarityKey)) continue;
      await ctx.db.insert("ghostSuggestions", {
        orgId: args.orgId,
        ownerUserId: args.ownerUserId,
        workstreamId: args.workstreamId,
        linkedAgentId: workstream.linkedAgentId,
        sourceWorkspaceMutationId: args.sourceWorkspaceMutationId,
        status: "pending",
        title: candidate.title,
        summary: normalizeGhostText(candidate.summary, 240),
        content: normalizeGhostText(candidate.content, 600),
        suggestionKind: candidate.suggestionKind,
        renderMode: candidate.renderMode,
        confidenceTier: candidate.confidenceTier,
        confidenceScore: candidate.confidenceScore,
        category: candidate.category,
        x: candidate.x,
        y: candidate.y,
        similarityKey: candidate.similarityKey,
        contextHash: hashContext([args.workstreamId, candidate.generationReason, candidate.title]),
        contextSignals: candidate.contextSignals,
        resourceContext: candidate.resourceContext,
        generationModel: "openrouter/auto",
        modelLane: "cheap_background",
        generationReason: `${args.trigger ?? "workspace_mutation"}: ${candidate.generationReason}`,
        unseenSessions: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      created += 1;
    }

    return { created, invalidated: pendingRows.length, reason: "regenerated" as const };
  },
});
