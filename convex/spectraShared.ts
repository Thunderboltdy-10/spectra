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
  if (!actor)
    throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  return actor;
}

export async function requireWorkspaceCapability(
  ctx: SpectraCtx,
  workspaceId: Id<"spectraWorkspaces">,
  capability: Capability = "read",
) {
  const decision = await requireCapability(
    ctx,
    "workspace",
    workspaceId,
    capability,
  );
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
  const resourceType =
    candidate?.blueprintKey === "agent" ? "agent" : "artifact";
  const decision = await requireCapability(
    ctx,
    resourceType,
    artifactId,
    capability,
  );
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
            prompt: "",
            type: "multiple_choice",
            options: ["", "", "", ""],
            optionIds: [
              "question-1:option:1",
              "question-1:option:2",
              "question-1:option:3",
              "question-1:option:4",
            ],
            correctAnswer: "",
            explanation: "",
            difficulty: "medium",
            points: 1,
            timeLimitSeconds: 90,
          },
        ],
        settings: {
          instructions: "",
          showAnswersImmediately: false,
          feedbackRelease: "after_submission",
          timed: false,
          shuffleQuestions: false,
          shuffleOptions: false,
          allowResume: true,
          defaultTimeMultiplier: 1,
          targetScore: 70,
        },
        published: false,
      };
    case "planner_task":
      return {
        id: "task-root",
        taskTitle: "",
        description: "",
        status: "todo",
        priority: "medium",
        timezone: "UTC",
        allDay: false,
        recurrence: {
          frequency: "none",
          interval: 1,
          weekdays: [],
          exceptions: [],
        },
        subtasks: [],
        attachments: [],
        reminders: [],
        sourceRefs: [],
        assignees: [],
        watchers: [],
        linkedArtifactIds: [],
        linkedThreadIds: [],
      };
    case "agent":
      return {
        profile: {
          purpose: "",
          outcomes: [],
          audienceIntent: "Anyone in my school who needs this specialist",
          inScope: [],
          outOfScope: [],
        },
        instructions: { regionId: "agent-instructions", text: "" },
        skills: [],
        tools: [],
        resources: [],
        routing: {
          enabled: true,
          description: "",
          examples: [],
          negativeExamples: [],
        },
        behavior: {
          clarification: "ask_when_needed",
          tone: "warm",
          responseLength: "balanced",
          boundaries: [],
        },
        modelPolicy: { mode: "spectra_default", allowFallback: true },
        evals: [],
        releaseNotes: "",
      };
    case "timetable":
      return {
        timezone: "UTC",
        layers: [
          {
            id: "classes",
            name: "Classes",
            kind: "class",
            visible: true,
            color: "#26a879",
            authority: "school",
            locked: true,
          },
          {
            id: "tasks",
            name: "Tasks & deadlines",
            kind: "tasks",
            visible: true,
            color: "#f2ad2e",
            authority: "workspace",
            locked: true,
          },
        ],
        events: [],
      };
    case "presentation":
      return {
        theme: {
          id: "spectra-botanical",
          name: "Botanical",
          tokens: {
            background: "#fbfaf5",
            heading: "#173f35",
            body: "#324b43",
            accent: "#2f9a72",
            soft: "#dfeee4",
          },
          fonts: { heading: "Georgia", body: "Arial" },
        },
        slides: [
          {
            id: "slide-1",
            title: "Opening slide",
            layoutId: "title-content",
            transition: { kind: "fade", durationMs: 350 },
            speakerNotes: "",
            accessibility: {
              label: "Opening slide",
              readingOrder: ["object-title"],
            },
            objects: [
              {
                id: "object-title",
                type: "text",
                x: 110,
                y: 155,
                width: 780,
                height: 150,
                rotation: 0,
                readingOrder: 1,
                content: { text: "Add a clear idea" },
                style: {
                  fontSize: 54,
                  fontWeight: 650,
                  color: "#173f35",
                  align: "left",
                },
              },
            ],
          },
        ],
        sections: [],
        components: [],
        settings: {
          aspectRatio: "16:9",
          defaultTransition: "fade",
          autoAdvanceSeconds: 0,
          showSlideNumbers: true,
        },
      };
    case "sheets":
      return {
        workbook: {
          calculationMode: "automatic",
          locale: "en-US",
          timezone: "UTC",
          namedRanges: {},
          calculationVersion: 1,
        },
        sheets: [
          {
            id: "sheet-1",
            name: "Sheet 1",
            cells: {},
            tables: [],
            charts: [],
            rowCount: 100,
            columnCount: 26,
            frozenRows: 0,
            frozenColumns: 0,
            hiddenRows: [],
            hiddenColumns: [],
            columnWidths: {},
            rowHeights: {},
            mergedRanges: [],
            conditionalFormats: [],
            rowIdentities: {},
            columnIdentities: {},
          },
        ],
        activeSheetId: "sheet-1",
      };
    case "code":
      return {
        runtime: "browser",
        runtimeVersion: "spectra-browser-es2022-v2",
        entryFileId: "file-main",
        files: [
          {
            id: "file-main",
            path: "index.html",
            language: "html",
            source:
              '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>Interactive visualisation</title>\n  <style>\n    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; background: #fbfaf7; color: #25241f; }\n    * { box-sizing: border-box; }\n    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px; }\n    main { width: min(680px, 100%); border: 1px solid #dedbd3; border-radius: 18px; background: white; padding: 32px; box-shadow: 0 18px 50px rgb(36 31 24 / 7%); }\n    h1 { margin: 0; font: 600 clamp(1.8rem, 5vw, 3rem) Georgia, serif; letter-spacing: -.035em; }\n    p { margin: 12px 0 0; color: #6f6d66; line-height: 1.65; }\n    .stage { margin-top: 28px; min-height: 220px; display: grid; place-items: center; border: 1px dashed #c9c5bc; border-radius: 14px; color: #77736b; background: #f8f7f3; text-align: center; padding: 24px; }\n  </style>\n</head>\n<body>\n  <main>\n    <h1>Interactive visualisation</h1>\n    <p>Build a focused learning experience here, or ask Spectra to turn an idea, dataset, or explanation into an interactive model.</p>\n    <section class="stage" aria-label="Visualisation canvas">Your visualisation will appear here.</section>\n  </main>\n</body>\n</html>',
            lineIds: [
              "file-main:line:1",
              "file-main:line:2",
              "file-main:line:3",
              "file-main:line:4",
              "file-main:line:5",
              "file-main:line:6",
              "file-main:line:7",
              "file-main:line:8",
              "file-main:line:9",
              "file-main:line:10",
              "file-main:line:11",
              "file-main:line:12",
              "file-main:line:13",
              "file-main:line:14",
              "file-main:line:15",
              "file-main:line:16",
              "file-main:line:17",
              "file-main:line:18",
              "file-main:line:19",
              "file-main:line:20",
              "file-main:line:21",
              "file-main:line:22",
              "file-main:line:23",
              "file-main:line:24",
            ],
          },
        ],
        visualisation: {
          enabled: true,
          title: "Interactive visualisation",
          description:
            "A safe, responsive Spectra-native interactive learning experience.",
          openMode: "source",
          aspectRatio: 1.6,
        },
        dependencies: {},
        preview: { orientation: "horizontal", autoRun: true, height: 640 },
        networkPolicy: { mode: "none", allowlist: [] },
        environmentSchema: [],
        tests: [],
        parameters: [],
        assets: [],
        resourceBindings: [],
        accessibility: {
          title: "Interactive visualisation",
          description:
            "A starter canvas ready for an accessible interactive model.",
          reducedMotion: true,
        },
      };
    case "whiteboard":
      return {
        viewport: { x: 0, y: 0, zoom: 1, pageId: "page-1" },
        pages: [{ id: "page-1", name: "Canvas", background: "#fbfaf7" }],
        nodes: [],
        edges: [],
        layers: [
          {
            id: "layer-1",
            pageId: "page-1",
            name: "Ideas",
            visible: true,
            locked: false,
          },
        ],
        sources: [],
        settings: {
          gridSize: 20,
          snapToGrid: false,
          showGrid: true,
          canvasColor: "#fbfaf7",
        },
      };
  }
}

export function defaultArtifactSchemaVersion(blueprintKey: BlueprintKey) {
  if (blueprintKey === "document") return 2;
  if (
    blueprintKey === "flashcard_deck" ||
    blueprintKey === "quiz" ||
    blueprintKey === "planner_task"
  )
    return 3;
  return 1;
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
    .withIndex("by_workspace_source", (q) =>
      q
        .eq("workspaceId", params.workspaceId!)
        .eq("sourceType", "thread")
        .eq("sourceId", params.threadId),
    )
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
  const contentText = JSON.stringify(params.content ?? "", (_key, value) =>
    typeof value === "string" ? value : value,
  )
    .replace(/[{}\[\]",:]/g, " ")
    .replace(/\s+/g, " ");
  return [params.title, params.summary, ...(params.tags ?? []), contentText]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4000);
}
