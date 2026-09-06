import type { ArtifactBlueprint } from "../core";
import {
  ARTIFACT_TYPE_MANIFESTS,
  getArtifactTypeManifest,
  loadArtifactSkill,
  requireArtifactTypeManifest,
  validateArtifactContent,
} from "../artifacts/registry";
import type { ArtifactTypeKey } from "../artifacts/types";
import { WORK_TYPE_KEYS } from "../artifacts/types";
import { createDefaultPresentationContent } from "../presentation/model";

const defaultContent: Record<ArtifactTypeKey, unknown> = {
  document: {
    blocks: [{ id: "intro", type: "paragraph", text: "" }],
    outline: [],
  },
  flashcard_deck: {
    cards: [
      {
        id: "card-1",
        front: "Key idea",
        back: "Explain it in your own words.",
        hint: "",
        sourceRefs: [],
        confidence: "unknown",
        section: "",
        tags: [],
      },
    ],
    settings: { shuffle: true, revealMode: "click", showHints: true },
  },
  quiz: {
    questions: [
      {
        id: "question-1",
        prompt: "What should this quiz check?",
        type: "short_answer",
        options: [],
        correctAnswer: "A clear response",
        explanation: "",
        difficulty: "medium",
        sourceRefs: [],
        feedback: "",
      },
    ],
    settings: {
      showAnswersImmediately: false,
      timed: false,
      shuffleQuestions: false,
      passingScore: 0,
      // A new quiz starts as practice; presets change this in one step (§11C).
      experience: {
        persistence: "personal",
        identity: "signed_in",
        timing: "untimed",
        attempts: "unlimited",
        revealAnswers: "immediate",
        resultsVisibility: "learner",
      },
    },
  },
  planner_task: {
    description: "",
    dueAt: null,
    startAt: null,
    endAt: null,
    allDay: false,
    status: "todo",
    priority: "medium",
    linkedArtifactIds: [],
    linkedThreadIds: [],
    subtasks: [],
    attachments: [],
    reminders: [],
    estimateMinutes: null,
    progressNote: "",
    sourceRefs: [],
    // Required by the task schema: a plan without a timezone cannot place a
    // deadline, and a task with no recurrence record cannot be told apart from
    // one whose recurrence was cleared.
    timezone: "UTC",
    recurrence: {
      frequency: "none",
      interval: 1,
      weekdays: [],
      exceptions: [],
    },
    assignees: [],
    watchers: [],
  },
  agent: {
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
  },
  timetable: {
    timezone: "UTC",
    layers: [
      {
        id: "classes",
        name: "Classes",
        kind: "class",
        visible: true,
        color: "var(--accent-mint)",
        authority: "school",
      },
      {
        id: "study",
        name: "Study blocks",
        kind: "study",
        visible: true,
        color: "var(--brand-primary)",
        authority: "user",
      },
      {
        id: "tasks",
        name: "Tasks & deadlines",
        kind: "tasks",
        visible: true,
        color: "var(--accent-gold)",
        authority: "workspace",
      },
    ],
    events: [],
  },
  presentation: createDefaultPresentationContent(),
  sheets: {
    workbook: { calculationMode: "automatic", locale: "en-US" },
    sheets: [
      { id: "sheet-1", name: "Sheet 1", cells: {}, tables: [], charts: [] },
    ],
    activeSheetId: "sheet-1",
  },
  code: {
    runtime: "browser",
    entryFileId: "file-main",
    files: [
      {
        id: "file-main",
        path: "index.html",
        language: "html",
        source: "<main></main>",
      },
    ],
    visualisation: { enabled: true },
  },
  whiteboard: {
    viewport: { pageId: "page-1", x: 0, y: 0, zoom: 1 },
    pages: [{ id: "page-1", name: "Page 1" }],
    nodes: [],
    edges: [],
    layers: [
      {
        id: "layer-1",
        name: "Canvas",
        pageId: "page-1",
        visible: true,
        locked: false,
      },
    ],
    zOrder: [],
  },
};

export const BUILT_IN_BLUEPRINTS = ARTIFACT_TYPE_MANIFESTS.map(
  (manifest): ArtifactBlueprint => ({
    key: manifest.identity.typeKey,
    name: manifest.identity.displayName,
    description: manifest.identity.description,
    version: manifest.schemas.currentVersion,
    schema: manifest.schemas.content,
    defaultContent: defaultContent[manifest.identity.typeKey],
    rendererKey: manifest.renderers.full,
    operations: [...manifest.operations],
    searchableFields: ["semanticRegions"],
  }),
);

// Creation is driven by the canonical work-type list; this catalog only
// supplies schema/default-content details owned by the artifact package.
const creatableBlueprints = BUILT_IN_BLUEPRINTS.filter((blueprint) =>
  (WORK_TYPE_KEYS as readonly string[]).includes(blueprint.key),
);

export type BuiltInBlueprintKey = ArtifactTypeKey;

const blueprintByKey = new Map<string, ArtifactBlueprint>(
  BUILT_IN_BLUEPRINTS.map((blueprint) => [blueprint.key, blueprint]),
);

export function listBlueprints() {
  return creatableBlueprints;
}

export function getBlueprint(key: string) {
  return blueprintByKey.get(key);
}

export function requireBlueprint(key: string) {
  const blueprint = getBlueprint(key);
  if (!blueprint) {
    throw new Error(`Unknown artifact blueprint: ${key}`);
  }
  return blueprint;
}

export function validateBlueprintContent(key: string, content: unknown) {
  return validateArtifactContent(key, content);
}

export {
  getArtifactTypeManifest,
  loadArtifactSkill,
  requireArtifactTypeManifest,
};
