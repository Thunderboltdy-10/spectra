import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireCapability, type Capability } from "./authorityShared";
import { getAuthenticatedActor } from "./identityShared";

export const vBlueprintKey = v.union(
  v.literal("document"),
  v.literal("flashcard_deck"),
  v.literal("quiz"),
  v.literal("planner_task"),
  v.literal("agent"),
  v.literal("timetable"),
  v.literal("presentation"),
  v.literal("sheets"),
  v.literal("code"),
  v.literal("whiteboard"),
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
export type BlueprintKey =
  | "document"
  | "flashcard_deck"
  | "quiz"
  | "planner_task"
  | "agent"
  | "timetable"
  | "presentation"
  | "sheets"
  | "code"
  | "whiteboard";

export async function requireSpectraActor(ctx: SpectraCtx) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor) throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  return actor;
}

export async function requireWorkspaceCapability(
  ctx: SpectraCtx,
  workspaceId: Id<"spectraWorkspaces">,
  capability: Capability = "read",
) {
  const decision = await requireCapability(ctx, "workspace", workspaceId, capability);
  return {
    actor: decision.actor,
    workspace: decision.loaded.resource as Doc<"spectraWorkspaces">,
    decision,
    capabilities: decision.capabilities,
  };
}

export async function requireArtifactCapability(
  ctx: SpectraCtx,
  artifactId: Id<"spectraArtifacts">,
  capability: Capability = "read",
) {
  const candidate = await ctx.db.get(artifactId);
  const resourceType = candidate?.blueprintKey === "agent" ? "agent" : "artifact";
  const decision = await requireCapability(ctx, resourceType, artifactId, capability);
  return {
    actor: decision.actor,
    artifact: decision.loaded.resource as Doc<"spectraArtifacts">,
    decision,
    capabilities: decision.capabilities,
  };
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
        id: "task-root",
        description: "",
        status: "todo",
        priority: "medium",
        linkedArtifactIds: [],
        linkedThreadIds: [],
      };
    case "agent":
      return {
        instructions: { regionId: "agent-instructions", text: "" },
        skills: [],
        tools: [],
        resources: [],
        routing: { enabled: true },
      };
    case "timetable":
      return {
        timezone: "UTC",
        layers: [{ id: "personal", name: "Personal", kind: "personal", visible: true }],
        events: [],
      };
    case "presentation":
      return {
        theme: { id: "spectra-default" },
        slides: [{ id: "slide-1", title: "Untitled presentation", objects: [] }],
      };
    case "sheets":
      return {
        workbook: { calculationMode: "automatic", locale: "en-US" },
        sheets: [{ id: "sheet-1", name: "Sheet 1", cells: {}, tables: [], charts: [] }],
        activeSheetId: "sheet-1",
      };
    case "code":
      return {
        runtime: "browser",
        entryFileId: "file-main",
        files: [{ id: "file-main", path: "index.html", language: "html", source: "<main></main>" }],
        visualisation: { enabled: true },
      };
    case "whiteboard":
      return {
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
        edges: [],
        layers: [{ id: "layer-1", name: "Canvas", visible: true, locked: false }],
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
    case "agent":
      return "A reusable Spectra agent with scoped skills, tools, and resources.";
    case "timetable":
      return "A layered timetable and calendar for school and personal time.";
    case "presentation":
      return "A Spectra-native presentation with responsive slide objects.";
    case "sheets":
      return "A collaborative workbook for formulas, analysis, and charts.";
    case "code":
      return "A multi-file code and interactive visualisation artifact.";
    case "whiteboard":
      return "A collaborative spatial canvas for ideas and relationships.";
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
