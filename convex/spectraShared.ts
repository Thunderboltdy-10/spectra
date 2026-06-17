import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getUserByClerkId } from "./helpers";

export const vBlueprintKey = v.union(
  v.literal("document"),
  v.literal("thread_reference"),
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
export type BlueprintKey = "document" | "thread_reference" | "flashcard_deck" | "quiz" | "planner_task";

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
    case "thread_reference":
      return {
        threadId: null,
        linkedArtifactIds: [],
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
    case "thread_reference":
      return "Reference to a useful Spectra thread.";
  }
}

export function buildArtifactTextIndex(params: {
  title: string;
  summary?: string;
  tags?: string[];
}) {
  return [params.title, params.summary, ...(params.tags ?? [])]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4000);
}

