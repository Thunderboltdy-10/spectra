import { v } from "convex/values";
import { isDurableContentRef } from "../shared/durable-content";
import { sheetCellEntries } from "../shared/sheet-cells";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  evaluateAccessForActorWithLoadedResource,
  requireCapability,
  type Capability,
} from "./authorityShared";
import { getAuthenticatedActor } from "./identityShared";
import { placeSourceNode } from "./orgTreeShared";

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
  options?: { allowPermanentDelete?: boolean },
) {
  const decision = await requireCapability(
    ctx,
    "workspace",
    workspaceId,
    capability,
  );
  const workspace = decision.loaded.resource as Doc<"spectraWorkspaces">;
  if (
    workspace.permanentDeleteJobId &&
    capability !== "read" &&
    options?.allowPermanentDelete !== true
  )
    throw new Error(
      "WORKSPACE_DELETE_IN_PROGRESS: This workspace is being removed.",
    );
  return {
    actor: decision.actor,
    workspace,
    decision,
    capabilities: decision.capabilities,
  };
}

export async function requireArtifactCapability(
  ctx: SpectraCtx,
  artifactId: Id<"spectraArtifacts">,
  capability: Capability = "read",
) {
  const actor = await requireSpectraActor(ctx);
  const candidate = await ctx.db.get(artifactId);
  const resourceType =
    candidate?.blueprintKey === "agent" ? "agent" : "artifact";
  // The caller already loaded the authoritative payload row for the selected
  // editor/detail operation. Reuse it for permission evaluation instead of
  // asking the generic authority path to read the same heavy row again.
  const decision = await evaluateAccessForActorWithLoadedResource(
    ctx,
    actor,
    resourceType,
    artifactId,
    candidate
      ? {
          resource: candidate,
          ownerAccountId: candidate.ownerAccountId,
          schoolId: candidate.schoolId,
          lifecycle: candidate.status,
        }
      : null,
  );
  if (!decision.allowed || !decision.capabilities.includes(capability))
    throw new Error(
      "AUTH_RESOURCE_FORBIDDEN: You do not have permission for this action.",
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
      // Keep the empty shell schema-valid. Blank MCQ option strings fail
      // quizContentSchema (choice questions need >=2 non-empty options), which
      // blocked Yjs baseline seeding during AI create and left orphan shells.
      return {
        questions: [
          {
            id: "question-1",
            prompt: "",
            type: "short_answer",
            options: [],
            optionIds: [],
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

function asContentRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Matches createPending / provisional shell summaries that must not finalize. */
export function isPlaceholderBuildingSummary(summary: unknown) {
  const clean = typeof summary === "string" ? summary.trim() : "";
  if (!clean) return true;
  return /^Spectra is building\b/i.test(clean);
}

/** Summaries produced from artifact cardinality may be refreshed after edits. */
export function isGeneratedArtifactSummary(
  summary: unknown,
  blueprintKey: BlueprintKey,
) {
  const clean = typeof summary === "string" ? summary.trim() : "";
  if (!clean) return false;
  const patterns: Partial<Record<BlueprintKey, RegExp>> = {
    document: /^\d+-block document about .+\.$/i,
    flashcard_deck: /^\d+-card deck about .+\.$/i,
    quiz: /^\d+-question quiz about .+\.$/i,
    planner_task: /^(?:Study task|Task) about .+\.$/i,
    presentation: /^\d+-slide presentation about .+\.$/i,
    timetable: /^\d+-event timetable about .+\.$/i,
    code: /^\d+-file code artifact about .+\.$/i,
    whiteboard: /^\d+-node whiteboard about .+\.$/i,
    sheets: /^Workbook with \d+ filled cells? about .+\.$/i,
  };
  return patterns[blueprintKey]?.test(clean) ?? false;
}

/**
 * Default/empty AI create shells that must never be finalized as workspace
 * artifacts. Kept local to Convex (no src/ import) and aligned with
 * src/features/spectra/operations/hollow-content.ts.
 */
export function isHollowDefaultContent(
  blueprintKey: BlueprintKey | string,
  content: unknown,
) {
  // A verified immutable body is hydrated at the server boundary. Its compact
  // manifest must never be mistaken for an empty editor document.
  if (isDurableContentRef(content)) return false;
  const record = asContentRecord(content);
  switch (blueprintKey) {
    case "timetable":
      return !Array.isArray(record.events) || record.events.length === 0;
    case "whiteboard":
      return !Array.isArray(record.nodes) || record.nodes.length === 0;
    case "sheets": {
      const sheets = Array.isArray(record.sheets) ? record.sheets : [];
      if (sheets.length === 0) return true;
      return sheets.every((sheet) => {
        if (!sheet || typeof sheet !== "object" || Array.isArray(sheet))
          return true;
        const cells = sheetCellEntries((sheet as { cells?: unknown }).cells);
        return !cells.some(([, cell]) => {
          if (cell == null) return false;
          if (typeof cell === "string" || typeof cell === "number")
            return String(cell).trim().length > 0;
          if (typeof cell !== "object" || Array.isArray(cell)) return false;
          const row = cell as Record<string, unknown>;
          const value = row.value ?? row.input ?? row.text ?? row.formula;
          return value != null && String(value).trim().length > 0;
        });
      });
    }
    case "code": {
      const files = Array.isArray(record.files) ? record.files : [];
      if (files.length === 0) return true;
      return files.every((file) => {
        if (!file || typeof file !== "object" || Array.isArray(file))
          return true;
        const source =
          typeof (file as { source?: unknown }).source === "string"
            ? String((file as { source: string }).source).trim()
            : "";
        return (
          !source ||
          /^<main>\s*<\/main>$/i.test(source) ||
          /^<(?:html|body|main|div)[^>]*>\s*<\/(?:html|body|main|div)>$/i.test(
            source,
          )
        );
      });
    }
    case "document": {
      const blocks = Array.isArray(record.blocks) ? record.blocks : [];
      return !blocks.some((block) => {
        if (!block || typeof block !== "object" || Array.isArray(block))
          return false;
        const text = (block as Record<string, unknown>).text;
        const latex = (block as Record<string, unknown>).latex;
        return (
          (typeof text === "string" && text.trim().length >= 8) ||
          (typeof latex === "string" && latex.trim().length >= 4)
        );
      });
    }
    case "flashcard_deck": {
      const cards = Array.isArray(record.cards) ? record.cards : [];
      return !cards.some((card) => {
        if (!card || typeof card !== "object" || Array.isArray(card))
          return false;
        const row = card as Record<string, unknown>;
        return (
          typeof row.front === "string" &&
          row.front.trim().length > 0 &&
          typeof row.back === "string" &&
          row.back.trim().length > 0
        );
      });
    }
    case "quiz": {
      const questions = Array.isArray(record.questions) ? record.questions : [];
      return !questions.some((question) => {
        if (
          !question ||
          typeof question !== "object" ||
          Array.isArray(question)
        )
          return false;
        const prompt = (question as Record<string, unknown>).prompt;
        const stem = (question as Record<string, unknown>).stem;
        return (
          (typeof prompt === "string" && prompt.trim().length > 0) ||
          (typeof stem === "string" && stem.trim().length > 0)
        );
      });
    }
    case "planner_task": {
      const description =
        typeof record.description === "string" ? record.description.trim() : "";
      const subtasks = Array.isArray(record.subtasks) ? record.subtasks : [];
      const titled = subtasks.filter(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof (item as { title?: unknown }).title === "string" &&
          String((item as { title: string }).title).trim(),
      );
      return description.length < 8 && titled.length === 0;
    }
    case "presentation": {
      const slides = Array.isArray(record.slides) ? record.slides : [];
      const placeholder =
        /^(?:add a clear idea|click to edit|title|subtitle|new slide)\s*$/i;
      return !slides.some((slide) => {
        if (!slide || typeof slide !== "object" || Array.isArray(slide))
          return false;
        const objects = Array.isArray(
          (slide as Record<string, unknown>).objects,
        )
          ? ((slide as Record<string, unknown>).objects as unknown[])
          : [];
        return objects.some((object) => {
          if (!object || typeof object !== "object" || Array.isArray(object))
            return false;
          const text = (object as Record<string, unknown>).text;
          const contentText = asContentRecord(
            (object as Record<string, unknown>).content,
          ).text;
          const value =
            typeof text === "string"
              ? text.trim()
              : typeof contentText === "string"
                ? contentText.trim()
                : "";
          return value.length >= 8 && !placeholder.test(value);
        });
      });
    }
    case "agent": {
      const instructions = asContentRecord(record.instructions);
      const text =
        typeof instructions.text === "string" ? instructions.text.trim() : "";
      return text.length < 40;
    }
    default:
      return false;
  }
}

export function hollowFinalizeFailureMessage(
  blueprintKey: BlueprintKey | string,
) {
  switch (blueprintKey) {
    case "sheets":
      return "The generated workbook is hollow/incomplete — sheets have no cell values.";
    case "code":
      return "The generated code artifact is hollow/incomplete — files are missing or only contain an empty <main></main> shell with no meaningful SVG or script.";
    case "timetable":
      return "The generated timetable is hollow/incomplete — content.events must include at least one scheduled event.";
    case "presentation":
      return "The generated presentation is hollow/incomplete — slides have no meaningful content.";
    case "document":
      return "The generated document is hollow/incomplete — it has no meaningful blocks.";
    case "flashcard_deck":
      return "The generated flashcard deck is hollow/incomplete — it has no usable cards.";
    case "quiz":
      return "The generated quiz is hollow/incomplete — it has no usable questions.";
    case "planner_task":
      return "The generated planner task is hollow/incomplete — it has no description or subtasks.";
    case "whiteboard":
      return "The generated whiteboard is hollow/incomplete — it has no nodes.";
    case "agent":
      return "The generated agent is hollow/incomplete — instructions are missing or too short.";
    default:
      return "The generated artifact is hollow/incomplete — it has no meaningful content.";
  }
}

export function finalizeArtifactSummary(params: {
  blueprintKey: BlueprintKey;
  title: string;
  summary?: string | null;
  content: unknown;
}) {
  if (params.summary?.trim() && !isPlaceholderBuildingSummary(params.summary))
    return params.summary.trim().slice(0, 320);
  const record = asContentRecord(params.content);
  const topic = params.title.trim() || "this topic";
  switch (params.blueprintKey) {
    case "sheets": {
      const sheets = Array.isArray(record.sheets) ? record.sheets : [];
      const cells = sheets.reduce((total, sheet) => {
        if (!sheet || typeof sheet !== "object" || Array.isArray(sheet))
          return total;
        return (
          total + sheetCellEntries((sheet as { cells?: unknown }).cells).length
        );
      }, 0);
      return cells > 0
        ? `Workbook with ${cells} filled cell${cells === 1 ? "" : "s"} about ${topic}.`
        : fallbackArtifactSummary("sheets");
    }
    case "quiz": {
      const count = Array.isArray(record.questions)
        ? record.questions.length
        : 0;
      return count
        ? `${count}-question quiz about ${topic}.`
        : fallbackArtifactSummary("quiz");
    }
    case "flashcard_deck": {
      const count = Array.isArray(record.cards) ? record.cards.length : 0;
      return count
        ? `${count}-card deck about ${topic}.`
        : fallbackArtifactSummary("flashcard_deck");
    }
    case "presentation": {
      const count = Array.isArray(record.slides) ? record.slides.length : 0;
      return count
        ? `${count}-slide presentation about ${topic}.`
        : fallbackArtifactSummary("presentation");
    }
    case "document": {
      const count = Array.isArray(record.blocks) ? record.blocks.length : 0;
      return count
        ? `${count}-block document about ${topic}.`
        : fallbackArtifactSummary("document");
    }
    case "timetable": {
      const count = Array.isArray(record.events) ? record.events.length : 0;
      return count
        ? `${count}-event timetable about ${topic}.`
        : fallbackArtifactSummary("timetable");
    }
    case "code": {
      const count = Array.isArray(record.files) ? record.files.length : 0;
      return count
        ? `${count}-file code artifact about ${topic}.`
        : fallbackArtifactSummary("code");
    }
    case "whiteboard": {
      const count = Array.isArray(record.nodes) ? record.nodes.length : 0;
      return count
        ? `${count}-node whiteboard about ${topic}.`
        : fallbackArtifactSummary("whiteboard");
    }
    default:
      return fallbackArtifactSummary(params.blueprintKey);
  }
}

export async function resolveThreadWorkspaceId(
  ctx: Pick<MutationCtx, "db">,
  params: {
    ownerAccountId: Id<"accounts">;
    workspaceId?: Id<"spectraWorkspaces">;
  },
) {
  if (params.workspaceId) {
    const workspace = await ctx.db.get(params.workspaceId);
    if (
      workspace &&
      workspace.ownerAccountId === params.ownerAccountId &&
      workspace.status === "active"
    )
      return workspace._id;
  }
  const recent = await ctx.db
    .query("spectraWorkspaces")
    .withIndex("by_account_activity", (q) =>
      q.eq("ownerAccountId", params.ownerAccountId),
    )
    .order("desc")
    .take(12);
  return (
    recent.find((workspace) => workspace.status === "active")?._id ?? undefined
  );
}

/**
 * A thread is placed in the tree the moment it exists (D31). With no workspace
 * named it lands in General, so a conversation is never homeless — the state
 * the old placement table allowed and the Library could not describe.
 */
export async function ensureThreadWorkspacePlacement(
  ctx: MutationCtx,
  params: {
    threadId: Id<"spectraThreads">;
    ownerAccountId?: Id<"accounts">;
    workspaceId?: Id<"spectraWorkspaces">;
    summary?: string;
    pinned?: boolean;
  },
) {
  const thread = await ctx.db.get(params.threadId);
  if (!thread || thread.status === "deleted") return undefined;
  const workspaceId = params.workspaceId ?? thread.workspaceId;
  if (workspaceId && thread.workspaceId !== workspaceId)
    await ctx.db.patch(params.threadId, {
      workspaceId,
      updatedAt: Date.now(),
      readSchemaVersion: 1,
    });
  const node = await placeSourceNode(ctx, {
    accountId: thread.ownerAccountId,
    schoolId: thread.schoolId,
    kind: "thread",
    sourceId: params.threadId,
    name: thread.title,
    target: workspaceId ? { workspaceId } : {},
    placedByAccountId: params.ownerAccountId ?? thread.ownerAccountId,
    // Importance is an explicit user choice; creation paths never promote.
    pinned: params.pinned,
  });
  return node._id;
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
