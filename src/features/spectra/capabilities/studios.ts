import { z } from "zod";
import type { WorkCapability, WorkType } from "../work/registry";
import type { CapabilityDefinition } from "./types";
import type { ArtifactEmbedInteraction } from "../../../../shared/artifact-embed";

const none = z.null();

type StudioType =
  | "quiz"
  | "flashcard_deck"
  | "code"
  | "whiteboard"
  | "planner_task";

type StudioSpec = {
  type: StudioType;
  localId: string;
  description: string;
  params?: z.ZodType;
  requires?: WorkCapability;
  embed?: readonly ArtifactEmbedInteraction[];
  exposed?: boolean;
};

const STUDIO_SPECS: readonly StudioSpec[] = [
  { type: "quiz", localId: "preview", description: "Preview this quiz as a learner." },
  { type: "quiz", localId: "build", description: "Return to building this quiz." },
  { type: "quiz", localId: "settings", description: "Open quiz settings." },
  { type: "quiz", localId: "questions", description: "Show or hide the question list." },
  {
    type: "quiz",
    localId: "question-details",
    description: "Show or hide details for the current question.",
  },
  { type: "quiz", localId: "cohort", description: "Show cohort responses." },
  { type: "quiz", localId: "attempts", description: "Show your attempts." },
  {
    type: "quiz",
    localId: "attempt.answer",
    description: "Answer the current quiz question.",
    requires: "attempt",
    embed: ["interact", "edit"],
  },
  {
    type: "quiz",
    localId: "attempt.navigate",
    description: "Move between quiz questions.",
    requires: "attempt",
    embed: ["interact", "edit"],
  },
  {
    type: "quiz",
    localId: "attempt.submit",
    description: "Submit this quiz attempt.",
    requires: "submit",
    embed: ["interact", "edit"],
  },
  { type: "quiz", localId: "import", description: "Import questions.", requires: "edit" },
  { type: "quiz", localId: "unpublish", description: "Stop new attempts on this quiz.", requires: "edit" },

  { type: "flashcard_deck", localId: "add-card", description: "Add a card to this deck.", requires: "edit" },
  { type: "flashcard_deck", localId: "rail", description: "Show or hide the card list." },
  { type: "flashcard_deck", localId: "browse", description: "Read the deck." },
  {
    type: "flashcard_deck",
    localId: "study.reveal",
    description: "Reveal the back of the current card.",
    requires: "interact",
    embed: ["interact", "edit"],
  },
  {
    type: "flashcard_deck",
    localId: "study.navigate",
    description: "Move between flashcards.",
    requires: "interact",
    embed: ["interact", "edit"],
  },
  {
    type: "flashcard_deck",
    localId: "progress",
    description: "Show your study progress.",
    requires: "submit",
  },
  { type: "flashcard_deck", localId: "import", description: "Import cards.", requires: "edit" },
  { type: "flashcard_deck", localId: "add-section", description: "Add a section.", requires: "edit" },
  {
    type: "flashcard_deck",
    localId: "template-concept",
    description: "Add a concept and cloze card.",
    requires: "edit",
  },
  {
    type: "flashcard_deck",
    localId: "template-language",
    description: "Add a vocabulary card.",
    requires: "edit",
  },
  {
    type: "flashcard_deck",
    localId: "template-formula",
    description: "Add a formula card.",
    requires: "edit",
  },
  { type: "flashcard_deck", localId: "export-csv", description: "Export this deck as CSV." },
  { type: "flashcard_deck", localId: "export-tsv", description: "Export this deck as TSV." },
  {
    type: "flashcard_deck",
    localId: "export-package",
    description: "Export a portable deck package.",
  },
  { type: "flashcard_deck", localId: "print", description: "Print or save this deck as PDF." },

  { type: "whiteboard", localId: "undo", description: "Undo the last board change.", requires: "edit" },
  { type: "whiteboard", localId: "redo", description: "Redo the last undone board change.", requires: "edit" },
  { type: "whiteboard", localId: "zoom-out", description: "Zoom the board out." },
  { type: "whiteboard", localId: "zoom-in", description: "Zoom the board in." },
  { type: "whiteboard", localId: "fit", description: "Fit the board to its content." },
  { type: "whiteboard", localId: "pages", description: "Show or hide the page rail." },
  { type: "whiteboard", localId: "tool-select", description: "Select objects.", requires: "edit" },
  { type: "whiteboard", localId: "tool-hand", description: "Pan the board.", requires: "edit" },
  { type: "whiteboard", localId: "tool-note", description: "Add a sticky note.", requires: "edit" },
  { type: "whiteboard", localId: "tool-connector", description: "Draw a connector.", requires: "edit" },
  { type: "whiteboard", localId: "tool-text", description: "Add text.", requires: "edit" },
  { type: "whiteboard", localId: "tool-shape", description: "Add a shape.", requires: "edit" },
  { type: "whiteboard", localId: "tool-frame", description: "Add a frame.", requires: "edit" },
  { type: "whiteboard", localId: "tool-card", description: "Add a card.", requires: "edit" },
  { type: "whiteboard", localId: "tool-table", description: "Add a table.", requires: "edit" },
  { type: "whiteboard", localId: "tool-embed", description: "Embed other work.", requires: "edit" },
  { type: "whiteboard", localId: "add-image", description: "Add an image.", requires: "edit" },
  { type: "whiteboard", localId: "import", description: "Import a board.", requires: "edit" },
  { type: "whiteboard", localId: "snap", description: "Snap moves and resizes to the grid.", requires: "edit" },
  { type: "whiteboard", localId: "panel-layers", description: "Open pages and layers." },
  { type: "whiteboard", localId: "panel-templates", description: "Open board templates.", requires: "edit" },
  { type: "whiteboard", localId: "panel-search", description: "Find on this board." },
  { type: "whiteboard", localId: "panel-outline", description: "Open the accessible outline." },
  { type: "whiteboard", localId: "present", description: "Present this board.", requires: "present" },
  { type: "whiteboard", localId: "export-png", description: "Export a PNG image." },
  { type: "whiteboard", localId: "export-svg", description: "Export an editable SVG." },
  { type: "whiteboard", localId: "export-pdf", description: "Export a PDF." },
  { type: "whiteboard", localId: "export-package", description: "Export a portable board." },

  { type: "planner_task", localId: "find", description: "Find tasks." },
  { type: "planner_task", localId: "filters", description: "Filter the plan." },
  { type: "planner_task", localId: "import", description: "Import tasks.", requires: "edit" },
  { type: "planner_task", localId: "export-csv", description: "Export this plan as a spreadsheet." },
  { type: "planner_task", localId: "export-ics", description: "Export this plan as calendar to-dos." },
  { type: "planner_task", localId: "export-json", description: "Export the full plan." },

];

/** Field format chrome (quiz / cards / planner) resolves these IR ids. They are not workbar actions. */
const FIELD_FORMAT_LOCAL_IDS = [
  "format.bold",
  "format.italic",
  "format.underline",
  "format.strike",
  "format.bulletList",
  "format.orderedList",
  "format.quote",
  "format.code",
  "insert.link",
  "insert.equation",
  "insert.blockEquation",
] as const;

const FIELD_FORMAT_TYPES = ["quiz", "flashcard_deck", "planner_task"] as const;

const FIELD_FORMAT_SPECS: readonly StudioSpec[] = FIELD_FORMAT_TYPES.flatMap((type) =>
  FIELD_FORMAT_LOCAL_IDS.map((localId) => ({
    type,
    localId,
    description: `Apply ${localId.replaceAll(".", " ")} to the focused field.`,
    requires: "edit" as const,
  })),
);

export function stableCapabilityId(type: WorkType | "app", localId: string) {
  if (type === "app") {
    return localId.startsWith("app.") ? localId : `app.${localId}`;
  }
  return localId.startsWith(`${type}.`)
    ? localId
    : `${type}.${localId.replaceAll(/[^a-zA-Z0-9]+/g, ".")}`;
}

export const BASE_STUDIO_CAPABILITIES: readonly CapabilityDefinition[] =
  [...STUDIO_SPECS, ...FIELD_FORMAT_SPECS].map((spec) => {
    const id = stableCapabilityId(spec.type, spec.localId);
    return {
      id: id as CapabilityDefinition["id"],
      params: spec.params ?? none,
      scope: "artifact",
      availability: (ctx) => {
        if (spec.requires && !ctx.can(spec.requires)) return { state: "hidden" as const };
        return { state: "enabled" as const };
      },
      execute: { editor: id },
      ai: {
        exposed: spec.exposed ?? false,
        description: spec.description,
        riskClass: "safe",
      },
      choreography: { target: "workbar-command", region: id },
      ...(spec.embed ? { embed: { levels: spec.embed } } : {}),
      ...(spec.requires ? { requires: spec.requires } : {}),
    } satisfies CapabilityDefinition;
  });
