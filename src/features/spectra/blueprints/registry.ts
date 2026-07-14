import type { ArtifactBlueprint } from "../core";
import {
  ARTIFACT_TYPE_MANIFESTS,
  getArtifactTypeManifest,
  loadArtifactSkill,
  requireArtifactTypeManifest,
  validateArtifactContent,
} from "../artifacts/registry";
import type { ArtifactTypeKey } from "../artifacts/types";

const defaultContent: Record<ArtifactTypeKey, unknown> = {
  document: { blocks: [{ id: "intro", type: "paragraph", text: "" }], outline: [] },
  flashcard_deck: { cards: [{ id: "card-1", front: "Key idea", back: "Explain it in your own words.", hint: "", sourceRefs: [], confidence: "unknown", section: "", tags: [] }], settings: { shuffle: true, revealMode: "click", showHints: true } },
  quiz: { questions: [{ id: "question-1", prompt: "What should this quiz check?", type: "short_answer", options: [], correctAnswer: "A clear response", explanation: "", difficulty: "medium", sourceRefs: [], feedback: "" }], settings: { showAnswersImmediately: false, timed: false, shuffleQuestions: false, passingScore: 0 } },
  planner_task: { description: "", dueAt: null, startAt: null, endAt: null, allDay: false, status: "todo", priority: "medium", linkedArtifactIds: [], linkedThreadIds: [], subtasks: [], attachments: [], reminders: [], estimateMinutes: null, progressNote: "", sourceRefs: [] },
  agent: { instructions: { regionId: "agent-instructions", text: "" }, skills: [], tools: [], resources: [], routing: { enabled: true } },
  timetable: { timezone: "UTC", layers: [{ id: "personal", name: "Personal", kind: "personal", visible: true }], events: [] },
  presentation: { theme: { id: "spectra-default" }, slides: [{ id: "slide-1", title: "Untitled presentation", objects: [] }] },
  sheets: { workbook: { calculationMode: "automatic", locale: "en-US" }, sheets: [{ id: "sheet-1", name: "Sheet 1", cells: {}, tables: [], charts: [] }], activeSheetId: "sheet-1" },
  code: { runtime: "browser", entryFileId: "file-main", files: [{ id: "file-main", path: "index.html", language: "html", source: "<main></main>" }], visualisation: { enabled: true } },
  whiteboard: { viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [], layers: [{ id: "layer-1", name: "Canvas", visible: true, locked: false }] },
};

export const BUILT_IN_BLUEPRINTS = ARTIFACT_TYPE_MANIFESTS.map((manifest): ArtifactBlueprint => ({
  key: manifest.identity.typeKey,
  name: manifest.identity.displayName,
  description: manifest.identity.description,
  version: manifest.schemas.currentVersion,
  schema: manifest.schemas.content,
  defaultContent: defaultContent[manifest.identity.typeKey],
  rendererKey: manifest.renderers.full,
  operations: [...manifest.operations],
  searchableFields: ["semanticRegions"],
}));

export type BuiltInBlueprintKey = ArtifactTypeKey;

const blueprintByKey = new Map<string, ArtifactBlueprint>(
  BUILT_IN_BLUEPRINTS.map((blueprint) => [blueprint.key, blueprint]),
);

export function listBlueprints() {
  return BUILT_IN_BLUEPRINTS;
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

export { getArtifactTypeManifest, loadArtifactSkill, requireArtifactTypeManifest };
