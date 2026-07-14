import { z } from "zod";
import { artifactContentSchemas } from "./schemas";
import { ARTIFACT_TYPE_KEYS, type ArtifactSkill, type ArtifactTypeKey, type ArtifactTypeManifest, type SemanticRegion } from "./types";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const rows = (value: unknown) => Array.isArray(value) ? value.map(record) : [];
const stringValue = (value: unknown, fallback: string) => typeof value === "string" && value ? value : fallback;

function region(regionId: string, kind: string, label: string, path: readonly (string | number)[], parentRegionId?: string, readableText?: string): SemanticRegion {
  return { regionId, kind, label, path, parentRegionId, overlapDomain: regionId, readableText };
}

const regionAdapters: Record<ArtifactTypeKey, (content: unknown) => SemanticRegion[]> = {
  document: (content) => rows(record(content).blocks).map((block, index) => region(stringValue(block.id, `block-${index + 1}`), stringValue(block.type, "block"), `Block ${index + 1}`, ["blocks", index], undefined, typeof block.text === "string" ? block.text : undefined)),
  flashcard_deck: (content) => rows(record(content).cards).flatMap((card, index) => {
    const cardId = stringValue(card.id, `card-${index + 1}`);
    return [region(cardId, "card", `Card ${index + 1}`, ["cards", index]), region(`${cardId}:front`, "card_front", `Card ${index + 1} front`, ["cards", index, "front"], cardId, typeof card.front === "string" ? card.front : undefined), region(`${cardId}:back`, "card_back", `Card ${index + 1} back`, ["cards", index, "back"], cardId, typeof card.back === "string" ? card.back : undefined)];
  }),
  quiz: (content) => rows(record(content).questions).flatMap((question, index) => {
    const questionId = stringValue(question.id, `question-${index + 1}`);
    const options = Array.isArray(question.options) ? question.options : [];
    return [region(questionId, "question", `Question ${index + 1}`, ["questions", index]), region(`${questionId}:prompt`, "quiz_prompt", `Question ${index + 1} prompt`, ["questions", index, "prompt"], questionId, typeof question.prompt === "string" ? question.prompt : undefined), ...options.map((option, optionIndex) => region(`${questionId}:option:${optionIndex}`, "answer_option", `Question ${index + 1} option ${optionIndex + 1}`, ["questions", index, "options", optionIndex], questionId, typeof option === "string" ? option : undefined)), region(`${questionId}:answer`, "correct_answer", `Question ${index + 1} answer`, ["questions", index, "correctAnswer"], questionId)];
  }),
  planner_task: (content) => ["description", "status", "priority", "dueAt", "startAt", "endAt", "subtasks", "reminders"].map((field) => region(`task:${field}`, "task_field", field.replaceAll("At", " time"), [field])),
  agent: (content) => {
    const value = record(content);
    return [region("agent-instructions", "agent_instructions", "Instructions", ["instructions", "text"], undefined, typeof record(value.instructions).text === "string" ? record(value.instructions).text as string : undefined), ...rows(value.skills).map((skill, index) => region(stringValue(skill.id, `skill-${index + 1}`), "agent_skill", stringValue(skill.name, `Skill ${index + 1}`), ["skills", index])), ...rows(value.resources).map((resource, index) => region(stringValue(resource.id, `resource-${index + 1}`), "resource_binding", stringValue(resource.label, `Resource ${index + 1}`), ["resources", index]))];
  },
  timetable: (content) => rows(record(content).events).map((event, index) => region(stringValue(event.id, `event-${index + 1}`), "calendar_event", stringValue(event.title, `Event ${index + 1}`), ["events", index])),
  presentation: (content) => rows(record(content).slides).flatMap((slide, slideIndex) => {
    const slideId = stringValue(slide.id, `slide-${slideIndex + 1}`);
    return [region(slideId, "slide", stringValue(slide.title, `Slide ${slideIndex + 1}`), ["slides", slideIndex]), ...rows(slide.objects).map((object, objectIndex) => region(stringValue(object.id, `${slideId}:object-${objectIndex + 1}`), "slide_object", `Slide ${slideIndex + 1} object ${objectIndex + 1}`, ["slides", slideIndex, "objects", objectIndex], slideId))];
  }),
  sheets: (content) => rows(record(content).sheets).flatMap((sheet, sheetIndex) => {
    const sheetId = stringValue(sheet.id, `sheet-${sheetIndex + 1}`);
    const cells = record(sheet.cells);
    return [region(sheetId, "sheet", stringValue(sheet.name, `Sheet ${sheetIndex + 1}`), ["sheets", sheetIndex]), ...Object.keys(cells).sort().map((address) => region(`${sheetId}:${address}`, "sheet_cell", `${stringValue(sheet.name, "Sheet")} ${address}`, ["sheets", sheetIndex, "cells", address], sheetId)), ...rows(sheet.charts).map((chart, chartIndex) => region(stringValue(chart.id, `${sheetId}:chart-${chartIndex + 1}`), "sheet_chart", stringValue(chart.title, `Chart ${chartIndex + 1}`), ["sheets", sheetIndex, "charts", chartIndex], sheetId))];
  }),
  code: (content) => rows(record(content).files).map((file, index) => region(stringValue(file.id, `file-${index + 1}`), "code_file", stringValue(file.path, `File ${index + 1}`), ["files", index], undefined, typeof file.source === "string" ? file.source : undefined)),
  whiteboard: (content) => [...rows(record(content).nodes).map((node, index) => region(stringValue(node.id, `node-${index + 1}`), "canvas_node", `Canvas node ${index + 1}`, ["nodes", index], typeof node.layerId === "string" ? node.layerId : undefined)), ...rows(record(content).edges).map((edge, index) => region(stringValue(edge.id, `edge-${index + 1}`), "canvas_edge", `Connector ${index + 1}`, ["edges", index]))],
};

const identity = {
  document: ["Document", "Structured writing, notes, and authored resources.", "writing", "FileText"],
  flashcard_deck: ["Flashcard deck", "Active-recall cards and spaced practice.", "practice", "GalleryVerticalEnd"],
  quiz: ["Quiz", "Practice and formative question experiences.", "practice", "ListChecks"],
  planner_task: ["Planner task", "Actionable work connected to time and resources.", "planning", "ListTodo"],
  agent: ["Agent", "Reusable instructions, skills, tools, and permissioned knowledge.", "intelligence", "Sparkles"],
  timetable: ["Timetable", "Layered school, class, task, and personal time.", "planning", "CalendarDays"],
  presentation: ["Presentation", "Spectra-native visual storytelling and presenting.", "creative", "Presentation"],
  sheets: ["Sheets", "Workbooks, formulas, structured analysis, and charts.", "data", "Table2"],
  code: ["Code", "Source code and approachable interactive visualisations.", "technical", "Code2"],
  whiteboard: ["Whiteboard", "A collaborative spatial canvas for thinking together.", "creative", "Workflow"],
} as const;

const imports: Record<ArtifactTypeKey, readonly string[]> = {
  document: ["docx", "odt", "rtf", "markdown", "html", "txt", "pdf"],
  flashcard_deck: ["csv", "tsv", "apkg", "quizlet-text"],
  quiz: ["qti", "moodle-xml", "csv", "docx"],
  planner_task: ["ics", "csv", "todoist-csv"],
  agent: ["spectra-agent-json", "markdown-instructions"],
  timetable: ["ics", "csv"],
  presentation: ["pptx", "odp", "pdf", "keynote-export"],
  sheets: ["xlsx", "xls", "ods", "csv", "tsv"],
  code: ["zip", "github-archive", "html", "ipynb", "py"],
  whiteboard: ["svg", "pdf", "png", "excalidraw", "drawio"],
};

const exports: Record<ArtifactTypeKey, readonly string[]> = {
  document: ["docx", "pdf", "markdown", "html"], flashcard_deck: ["csv", "tsv", "pdf"], quiz: ["qti", "pdf", "csv"], planner_task: ["ics", "csv", "pdf"], agent: ["spectra-agent-json", "markdown"], timetable: ["ics", "csv", "pdf"], presentation: ["pdf", "pptx", "png"], sheets: ["xlsx", "ods", "csv", "pdf"], code: ["zip", "html"], whiteboard: ["svg", "pdf", "png"],
};

const operations: Record<ArtifactTypeKey, readonly string[]> = {
  document: ["inspect_outline", "insert_blocks", "rewrite_blocks", "move_blocks", "format_blocks", "validate"],
  flashcard_deck: ["inspect_cards", "add_cards", "rewrite_side", "reorder_cards", "set_study_metadata", "validate"],
  quiz: ["inspect_questions", "add_questions", "rewrite_field", "add_option", "mark_correct", "reorder_questions", "validate_formative"],
  planner_task: ["inspect_task", "update_field", "add_subtask", "link_artifact", "schedule", "validate"],
  agent: ["inspect_configuration", "rewrite_instructions", "bind_skill", "bind_tool", "bind_resource", "evaluate", "propose_version"],
  timetable: ["inspect_range", "add_event", "move_event", "update_event", "manage_layer", "resolve_overlap", "validate"],
  presentation: ["inspect_deck", "add_slide", "rewrite_object", "move_object", "apply_layout", "generate_chart", "check_overflow"],
  sheets: ["inspect_range", "set_cells", "set_formula", "format_range", "create_table", "sort_filter", "create_chart", "analyze", "validate"],
  code: ["inspect_tree", "read_file", "patch_lines", "create_file", "run", "verify_output", "format_visualisation"],
  whiteboard: ["inspect_viewport", "create_node", "rewrite_node", "move_nodes", "connect_nodes", "group", "organize", "validate"],
};

function loadSkill(typeKey: ArtifactTypeKey): Promise<ArtifactSkill> {
  switch (typeKey) {
    case "document": return import("./skills/document").then((module) => module.documentSkill);
    case "flashcard_deck": return import("./skills/flashcard-deck").then((module) => module.flashcardDeckSkill);
    case "quiz": return import("./skills/quiz").then((module) => module.quizSkill);
    case "planner_task": return import("./skills/planner-task").then((module) => module.plannerTaskSkill);
    case "agent": return import("./skills/agent").then((module) => module.agentSkill);
    case "timetable": return import("./skills/timetable").then((module) => module.timetableSkill);
    case "presentation": return import("./skills/presentation").then((module) => module.presentationSkill);
    case "sheets": return import("./skills/sheets").then((module) => module.sheetsSkill);
    case "code": return import("./skills/code").then((module) => module.codeSkill);
    case "whiteboard": return import("./skills/whiteboard").then((module) => module.whiteboardSkill);
  }
}

function manifest(typeKey: ArtifactTypeKey): ArtifactTypeManifest {
  const [displayName, description, category, icon] = identity[typeKey];
  const collaborativePartition = typeKey === "sheets" ? "sheet" : typeKey === "presentation" ? "slide" : typeKey === "code" ? "file" : typeKey === "whiteboard" ? "viewport" : "artifact";
  const large = typeKey === "sheets" || typeKey === "presentation" || typeKey === "code" || typeKey === "whiteboard";
  return {
    identity: { typeKey, displayName, description, category, icon, minimumAppVersion: 1 },
    schemas: { currentVersion: typeKey === "document" ? 2 : 1, content: artifactContentSchemas[typeKey] },
    renderers: { full: `${typeKey}:full`, panel: `${typeKey}:panel`, compact: `${typeKey}:compact`, embedCompact: `${typeKey}:embed-compact`, embedExpanded: `${typeKey}:embed-expanded`, historical: `${typeKey}:historical`, print: typeKey === "agent" || typeKey === "code" ? null : `${typeKey}:print` },
    editor: { routeSegment: typeKey.replaceAll("_", "-"), sync: "yjs", validity: "continuous", minimumPanelWidth: 320 },
    operations: operations[typeKey],
    regions: regionAdapters[typeKey],
    loadSkill: () => loadSkill(typeKey),
    collaboration: { roomPartition: collaborativePartition, commentAnchors: typeKey === "sheets" ? ["cell", "range", "chart"] : typeKey === "whiteboard" ? ["node", "edge", "frame"] : ["region", "selection"], awareness: ["activeRegion", "selection", "viewport", "cursor"] },
    history: { snapshot: large ? "content-addressed" : typeKey === "planner_task" || typeKey === "agent" ? "normalized" : "yjs-snapshot", partialRestore: true },
    capabilities: { canPresent: typeKey === "presentation" || typeKey === "whiteboard", canExecute: typeKey === "code", canAssessFormatively: typeKey === "quiz" || typeKey === "flashcard_deck", canEmbedInteractively: ["flashcard_deck", "quiz", "presentation", "sheets", "code", "whiteboard", "timetable"].includes(typeKey) },
    interoperability: { imports: imports[typeKey], exports: exports[typeKey], quarantinesExecutableContent: typeKey === "code" || typeKey === "sheets" || typeKey === "presentation" },
    quality: { virtualizeAfter: typeKey === "sheets" ? 500 : typeKey === "whiteboard" ? 300 : typeKey === "presentation" ? 80 : 200, primaryAccessibilityModel: typeKey === "sheets" ? "ARIA grid with range narration" : typeKey === "whiteboard" ? "spatial outline and keyboard node traversal" : "semantic regions and ordered navigation" },
  };
}

export const ARTIFACT_TYPE_MANIFESTS = ARTIFACT_TYPE_KEYS.map(manifest);
const manifestsByKey = new Map(ARTIFACT_TYPE_MANIFESTS.map((entry) => [entry.identity.typeKey, entry]));

export function isArtifactTypeKey(value: string): value is ArtifactTypeKey {
  return (ARTIFACT_TYPE_KEYS as readonly string[]).includes(value);
}

export function getArtifactTypeManifest(typeKey: string) {
  return isArtifactTypeKey(typeKey) ? manifestsByKey.get(typeKey) : undefined;
}

export function requireArtifactTypeManifest(typeKey: string) {
  const result = getArtifactTypeManifest(typeKey);
  if (!result) throw new Error(`ARTIFACT_TYPE_UNKNOWN: ${typeKey} is quarantined until a compatible type manifest is installed.`);
  return result;
}

export function validateArtifactContent(typeKey: string, content: unknown) {
  const manifest = requireArtifactTypeManifest(typeKey);
  return manifest.schemas.content.safeParse(content);
}

export function enumerateArtifactRegions(typeKey: string, content: unknown) {
  const manifest = requireArtifactTypeManifest(typeKey);
  const parsed = manifest.schemas.content.parse(content);
  const regions = manifest.regions(parsed);
  const ids = new Set<string>();
  for (const candidate of regions) {
    if (ids.has(candidate.regionId)) throw new Error(`ARTIFACT_REGION_DUPLICATE: ${candidate.regionId}`);
    ids.add(candidate.regionId);
  }
  return regions;
}

export async function loadArtifactSkill(typeKey: string) {
  return requireArtifactTypeManifest(typeKey).loadSkill();
}

export const artifactTypeKeySchema = z.enum(ARTIFACT_TYPE_KEYS);
