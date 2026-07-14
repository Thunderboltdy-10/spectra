import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getUserByClerkId } from "./helpers";

export const vBlueprintKey = v.union(
  v.literal("document"),
  v.literal("flashcard_deck"),
  v.literal("quiz"),
  v.literal("planner_task"),
);

export const vArtifactStatus = v.union(
  v.literal("active"),
  v.literal("draft"),
  v.literal("archived"),
  v.literal("deleted"),
);

export const vCreatedFromSource = v.union(
  v.literal("chat"),
  v.literal("workspace"),
  v.literal("artifact"),
  v.literal("manual"),
  v.literal("ai"),
);

export type SpectraCtx = QueryCtx | MutationCtx;
export type BlueprintKey = "document" | "flashcard_deck" | "quiz" | "planner_task";

export async function requireSpectraActor(ctx: SpectraCtx, actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

export async function requireOwnedWorkspace(
  ctx: SpectraCtx,
  actorClerkId: string,
  workspaceId: Id<"spectraWorkspaces">,
) {
  const actor = await requireSpectraActor(ctx, actorClerkId);
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace || workspace.ownerUserId !== actor._id || workspace.orgId !== actor.orgId) {
    throw new Error("Workspace not found");
  }
  return { actor, workspace };
}

export async function requireOwnedArtifact(
  ctx: SpectraCtx,
  actorClerkId: string,
  artifactId: Id<"spectraArtifacts">,
) {
  const actor = await requireSpectraActor(ctx, actorClerkId);
  const artifact = await ctx.db.get(artifactId);
  if (!artifact || artifact.ownerUserId !== actor._id || artifact.orgId !== actor.orgId) {
    throw new Error("Artifact not found");
  }
  return { actor, artifact };
}

export function normalizeArtifactId(ctx: SpectraCtx, sourceId: string) {
  return ctx.db.normalizeId("spectraArtifacts", sourceId);
}

export function defaultArtifactContent(blueprintKey: BlueprintKey) {
  switch (blueprintKey) {
    case "document":
      return {
        blocks: [
          {
            id: "intro",
            type: "paragraph",
            text: "Start writing here.",
          },
        ],
        outline: [],
      };
    case "flashcard_deck":
      return {
        cards: [
          {
            id: "card-1",
            front: "Key idea",
            back: "Explain it in your own words.",
            confidence: "unknown",
          },
        ],
        settings: { shuffle: true, revealMode: "click" },
      };
    case "quiz":
      return {
        questions: [
          {
            id: "question-1",
            prompt: "What should this quiz check?",
            type: "short_answer",
            difficulty: "medium",
          },
        ],
        settings: { showAnswersImmediately: false, timed: false },
      };
    case "planner_task":
      return {
        description: "",
        status: "todo",
        priority: "medium",
        linkedArtifactIds: [],
        linkedThreadIds: [],
      };
  }
}

export function fallbackArtifactSummary(blueprintKey: BlueprintKey) {
  switch (blueprintKey) {
    case "document":
      return "Structured document artifact.";
    case "flashcard_deck":
      return "A single deck artifact for spaced review.";
    case "quiz":
      return "Quiz artifact with questions and review metadata.";
    case "planner_task":
      return "Planner task artifact with status and links.";
  }
}

export async function ensureThreadWorkspacePlacement(
  ctx: Pick<MutationCtx, "db">,
  params: {
    threadId: Id<"spectraThreads">;
    workspaceId?: Id<"spectraWorkspaces">;
    summary?: string;
    pinned?: boolean;
  },
) {
  if (!params.workspaceId) return undefined;
  const now = Date.now();
  const existing = await ctx.db
    .query("spectraWorkspaceItems")
    .withIndex("by_workspace_source", (q) => q
      .eq("workspaceId", params.workspaceId!)
      .eq("sourceType", "thread")
      .eq("sourceId", params.threadId))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, {
      viewData: {
        ...existing.viewData,
        compactSummary: params.summary ?? existing.viewData.compactSummary,
        pinned: params.pinned ?? existing.viewData.pinned,
        hidden: false,
      },
      updatedAt: now,
    });
    return existing._id;
  }
  return ctx.db.insert("spectraWorkspaceItems", {
    workspaceId: params.workspaceId,
    sourceType: "thread",
    sourceId: params.threadId,
    viewData: {
      compactSummary: params.summary,
      // Importance is an explicit user choice. Every creation path, including
      // direct thread creation and run-backed creation, starts unpinned unless
      // the caller deliberately promotes the item.
      pinned: params.pinned ?? false,
      hidden: false,
    },
    layout: { view: "cards" },
    createdAt: now,
    updatedAt: now,
  });
}

export function buildArtifactTextIndex(params: {
  title: string;
  summary?: string;
  tags?: string[];
  content?: unknown;
}) {
  const contentText = JSON.stringify(params.content ?? "", (_key, value) => typeof value === "string" ? value : value)
    .replace(/[{}\[\]",:]/g, " ")
    .replace(/\s+/g, " ");
  return [params.title, params.summary, ...(params.tags ?? []), contentText]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4000);
}
