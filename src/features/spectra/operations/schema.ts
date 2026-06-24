import { z } from "zod";
import { validateBlueprintContent } from "../blueprints/registry";
import { documentContentSchema } from "../blueprints/document";
import { flashcardDeckContentSchema } from "../blueprints/flashcard-deck";
import { plannerTaskContentSchema } from "../blueprints/planner-task";
import { quizContentSchema } from "../blueprints/quiz";
import { threadReferenceContentSchema } from "../blueprints/thread-reference";

export const SPECTRA_BLUEPRINT_KEYS = [
  "document",
  "thread_reference",
  "flashcard_deck",
  "quiz",
  "planner_task",
] as const;

export const OPERATION_TYPES = [
  "artifact.create",
  "artifact.update",
  "workspace.create",
  "workspace.update",
  "artifact.link",
  "workspaceItem.add",
  "workspaceItem.hide",
  "thread.create",
  "resultCard.create",
  "resultCard.update",
  "plannerTask.create",
  "quiz.create",
  "flashcardDeck.create",
  "delete",
] as const;

export const MODEL_OPERATION_TYPES = [
  "artifact.create",
  "artifact.update",
  "workspace.create",
  "workspace.update",
  "artifact.link",
  "workspaceItem.add",
  "workspaceItem.hide",
] as const;

export const PLAN_DECISIONS = ["answer", "operate", "clarify", "refuse"] as const;
export const REQUEST_INTENT_MODES = ["answer", "create", "update", "place", "remove_placement", "create_workspace", "update_workspace", "link", "mixed"] as const;

export type SpectraOperationType = (typeof OPERATION_TYPES)[number];
export type ModelOperationType = (typeof MODEL_OPERATION_TYPES)[number];

const shortText = z.string().trim().min(1).max(240);
const summaryText = z.string().trim().max(2_000);
const idText = z.string().trim().min(1).max(180);
const tagsSchema = z.array(z.string().trim().min(1).max(48)).max(16);

const artifactCreateInputSchema = z.discriminatedUnion("blueprintKey", [
  z.object({ blueprintKey: z.literal("document"), title: shortText, summary: summaryText.nullable(), content: documentContentSchema, tags: tagsSchema, workspaceId: idText.nullable(), placement: z.enum(["context", "inbox"]) }).strict(),
  z.object({ blueprintKey: z.literal("flashcard_deck"), title: shortText, summary: summaryText.nullable(), content: flashcardDeckContentSchema, tags: tagsSchema, workspaceId: idText.nullable(), placement: z.enum(["context", "inbox"]) }).strict(),
  z.object({ blueprintKey: z.literal("quiz"), title: shortText, summary: summaryText.nullable(), content: quizContentSchema, tags: tagsSchema, workspaceId: idText.nullable(), placement: z.enum(["context", "inbox"]) }).strict(),
  z.object({ blueprintKey: z.literal("planner_task"), title: shortText, summary: summaryText.nullable(), content: plannerTaskContentSchema, tags: tagsSchema, workspaceId: idText.nullable(), placement: z.enum(["context", "inbox"]) }).strict(),
  z.object({ blueprintKey: z.literal("thread_reference"), title: shortText, summary: summaryText.nullable(), content: threadReferenceContentSchema, tags: tagsSchema, workspaceId: idText.nullable(), placement: z.enum(["context", "inbox"]) }).strict(),
]);

function updateInput<T extends z.ZodTypeAny>(blueprintKey: (typeof SPECTRA_BLUEPRINT_KEYS)[number], content: T) {
  return z.object({
    artifactId: idText,
    blueprintKey: z.literal(blueprintKey),
    title: shortText.nullable(),
    summary: summaryText.nullable(),
    content: content.nullable(),
    tags: tagsSchema.nullable(),
  }).strict();
}

const artifactUpdateInputSchema = z.union([
  updateInput("document", documentContentSchema),
  updateInput("flashcard_deck", flashcardDeckContentSchema),
  updateInput("quiz", quizContentSchema),
  updateInput("planner_task", plannerTaskContentSchema),
  updateInput("thread_reference", threadReferenceContentSchema),
]);

const workspaceIconSchema = z.enum(["Sparkles", "BookOpen", "Sprout", "BarChart3"]);
const workspaceCreateInputSchema = z.object({ title: shortText, description: summaryText.nullable(), icon: workspaceIconSchema.nullable().optional(), color: z.string().trim().max(48).nullable().optional() }).strict();
const workspaceUpdateInputSchema = z.object({ workspaceId: idText, title: shortText.nullable(), description: summaryText.nullable(), icon: workspaceIconSchema.nullable().optional(), color: z.string().trim().max(48).nullable().optional() }).strict();
const artifactLinkInputSchema = z.object({
  sourceArtifactId: idText,
  targetArtifactId: idText,
  relationType: z.enum(["related", "supports", "contradicts", "source_for", "generated_from", "follow_up", "belongs_with"]),
  label: z.string().trim().max(120).nullable(),
  explanation: z.string().trim().max(600).nullable(),
  workspaceId: idText.nullable(),
}).strict();
const workspaceItemAddInputSchema = z.object({ artifactId: idText, workspaceId: idText }).strict();
const workspaceItemHideInputSchema = z.object({ workspaceItemId: idText }).strict();

export const modelOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("artifact.create"), input: artifactCreateInputSchema }).strict(),
  z.object({ type: z.literal("artifact.update"), input: artifactUpdateInputSchema }).strict(),
  z.object({ type: z.literal("workspace.create"), input: workspaceCreateInputSchema }).strict(),
  z.object({ type: z.literal("workspace.update"), input: workspaceUpdateInputSchema }).strict(),
  z.object({ type: z.literal("artifact.link"), input: artifactLinkInputSchema }).strict(),
  z.object({ type: z.literal("workspaceItem.add"), input: workspaceItemAddInputSchema }).strict(),
  z.object({ type: z.literal("workspaceItem.hide"), input: workspaceItemHideInputSchema }).strict(),
]);

export type ModelOperation = z.infer<typeof modelOperationSchema>;

export const requestIntentSchema = z.object({
  mode: z.enum(REQUEST_INTENT_MODES),
  requestedArtifactTypes: z.array(z.enum(SPECTRA_BLUEPRINT_KEYS)).max(5),
  requestedVisibleArtifactCount: z.number().int().min(0).max(1_000),
  targetArtifactId: idText.nullable(),
  targetWorkspaceId: idText.nullable(),
}).strict();

export type RequestIntent = z.infer<typeof requestIntentSchema>;

export const spectraPlanSchema = z.object({
  decision: z.enum(PLAN_DECISIONS),
  intent: requestIntentSchema,
  conversationTitle: z.string().trim().min(1).max(64).nullable().optional(),
  conversationSummary: z.string().trim().min(1).max(320).nullable().optional(),
  choices: z.object({
    question: z.string().trim().min(1).max(500),
    options: z.array(z.object({
      title: z.string().trim().min(1).max(80),
      description: z.string().trim().max(240).nullable().optional(),
    }).strict()).min(2).max(4),
  }).strict().nullable().optional(),
  finalResponse: z.string().trim().min(1).max(4_000),
  operations: z.array(modelOperationSchema).max(8),
}).strict().superRefine((plan, ctx) => {
  const nonOperational = plan.decision === "answer" || plan.decision === "clarify" || plan.decision === "refuse";
  if (nonOperational && plan.operations.length > 0) ctx.addIssue({ code: "custom", path: ["operations"], message: `${plan.decision} plans cannot contain operations` });
  if (plan.decision === "operate" && plan.operations.length === 0) ctx.addIssue({ code: "custom", path: ["operations"], message: "operate plans require at least one operation" });
});

export type SpectraPlan = z.infer<typeof spectraPlanSchema>;

// Retained for the Wave 0 public policy API and non-model operation tests.
export const operationInputSchema = z.object({
  type: z.enum(OPERATION_TYPES),
  input: z.unknown(),
  affected: z.array(z.object({ type: z.string(), id: z.string() })).default([]),
  bulkCount: z.number().int().nonnegative().optional(),
});

export type OperationInput = z.infer<typeof operationInputSchema>;

export function parseOperationInput(value: unknown) {
  return operationInputSchema.parse(value);
}

export function parseModelOperation(value: unknown) {
  const operation = modelOperationSchema.parse(value);
  const serialized = JSON.stringify(operation.input);
  if (serialized.length > 250_000) throw new Error("Operation input exceeds the Wave 4 size limit.");
  if (operation.type === "artifact.create") {
    const validated = validateBlueprintContent(operation.input.blueprintKey, operation.input.content);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      const path = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
      throw new Error(`Invalid ${operation.input.blueprintKey} content${path}: ${issue?.message ?? "schema mismatch"}`);
    }
    const content = operation.input.content as Record<string, unknown>;
    if (operation.input.blueprintKey === "flashcard_deck" && Array.isArray(content.cards) && content.cards.length > 200) throw new Error("A generated deck may contain at most 200 cards.");
    if (operation.input.blueprintKey === "quiz" && Array.isArray(content.questions) && content.questions.length > 100) throw new Error("A generated quiz may contain at most 100 questions.");
    if (operation.input.blueprintKey === "document" && Array.isArray(content.blocks) && content.blocks.length > 300) throw new Error("A generated document may contain at most 300 blocks.");
  }
  if (operation.type === "artifact.update" && operation.input.title === null && operation.input.summary === null && operation.input.content === null && operation.input.tags === null) {
    throw new Error("artifact.update requires at least one changed field");
  }
  return operation;
}

function normalizePlanIntentMode(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const plan = value as Record<string, unknown>;
  if (!plan.intent || typeof plan.intent !== "object") return value;
  const intent = plan.intent as Record<string, unknown>;
  if (typeof intent.mode === "string" && REQUEST_INTENT_MODES.includes(intent.mode as (typeof REQUEST_INTENT_MODES)[number])) return value;
  const operations = Array.isArray(plan.operations) ? plan.operations as Array<Record<string, unknown>> : [];
  const types = new Set(operations.map((operation) => operation.type));
  let mode: (typeof REQUEST_INTENT_MODES)[number] = "answer";
  if (plan.decision === "operate") {
    if (types.size > 1) mode = "mixed";
    else if (types.has("artifact.create")) mode = "create";
    else if (types.has("artifact.update")) mode = "update";
    else if (types.has("workspaceItem.add")) mode = "place";
    else if (types.has("workspaceItem.hide")) mode = "remove_placement";
    else if (types.has("workspace.create")) mode = "create_workspace";
    else if (types.has("workspace.update")) mode = "update_workspace";
    else if (types.has("artifact.link")) mode = "link";
  }
  return { ...plan, intent: { ...intent, mode } };
}

export function parseSpectraPlan(value: unknown) {
  const plan = spectraPlanSchema.parse(normalizePlanIntentMode(value));
  return { ...plan, operations: plan.operations.map(parseModelOperation) };
}

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] } as const;

const documentContentJsonSchema = {
  type: "object", additionalProperties: false, required: ["blocks", "outline"],
  properties: {
    blocks: { type: "array", minItems: 1, maxItems: 300, items: { type: "object", additionalProperties: false, required: ["id", "type", "text"], properties: { id: { type: "string" }, type: { enum: ["paragraph", "heading", "quote", "callout", "list", "math", "equation", "code", "task", "table"] }, text: { type: "string" }, latex: { type: "string" }, attrs: { type: "object", additionalProperties: true } } } },
    outline: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "title", "level"], properties: { id: { type: "string" }, title: { type: "string" }, level: { type: "number" } } } },
  },
} as const;

const deckContentJsonSchema = {
  type: "object", additionalProperties: false, required: ["cards", "settings"],
  properties: {
    cards: { type: "array", minItems: 1, maxItems: 200, items: { type: "object", additionalProperties: false, required: ["id", "front", "back", "hint", "sourceRefs", "confidence", "section", "tags"], properties: { id: { type: "string" }, front: { type: "string", minLength: 1 }, back: { type: "string", minLength: 1 }, hint: { type: "string" }, sourceRefs: { type: "array", items: { type: "string" } }, confidence: { enum: ["unknown", "weak", "medium", "strong"] }, section: { type: "string" }, tags: { type: "array", items: { type: "string" } } } } },
    settings: { type: "object", additionalProperties: false, required: ["shuffle", "revealMode", "showHints"], properties: { shuffle: { type: "boolean" }, revealMode: { enum: ["click", "type"] }, showHints: { type: "boolean" } } },
  },
} as const;

const quizContentJsonSchema = {
  type: "object", additionalProperties: false, required: ["questions", "settings"],
  properties: {
    questions: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, required: ["id", "prompt", "type", "options", "correctAnswer", "explanation", "difficulty", "sourceRefs", "feedback"], properties: { id: { type: "string" }, prompt: { type: "string", minLength: 1 }, type: { enum: ["multiple_choice", "short_answer"] }, options: { type: "array", items: { type: "string" } }, correctAnswer: { type: "string", minLength: 1 }, explanation: { type: "string" }, difficulty: { enum: ["easy", "medium", "hard"] }, sourceRefs: { type: "array", items: { type: "string" } }, feedback: { type: "string" } } } },
    settings: { type: "object", additionalProperties: false, required: ["showAnswersImmediately", "timed", "shuffleQuestions", "passingScore"], properties: { showAnswersImmediately: { type: "boolean" }, timed: { type: "boolean" }, shuffleQuestions: { type: "boolean" }, passingScore: { type: "number" } } },
  },
} as const;

const plannerContentJsonSchema = {
  type: "object", additionalProperties: false, required: ["description", "dueAt", "startAt", "endAt", "allDay", "status", "priority", "linkedArtifactIds", "linkedThreadIds", "subtasks", "attachments", "reminders", "estimateMinutes", "progressNote", "sourceRefs"],
  properties: { description: { type: "string" }, dueAt: nullableNumber, startAt: nullableNumber, endAt: nullableNumber, allDay: { type: "boolean" }, status: { enum: ["todo", "doing", "done"] }, priority: { enum: ["low", "medium", "high"] }, linkedArtifactIds: { type: "array", items: { type: "string" } }, linkedThreadIds: { type: "array", items: { type: "string" } }, subtasks: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "title", "done"], properties: { id: { type: "string" }, title: { type: "string" }, done: { type: "boolean" } } } }, attachments: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "name", "meta"], properties: { id: { type: "string" }, name: { type: "string" }, meta: { type: "string" } } } }, reminders: { type: "array", items: { type: "string" } }, estimateMinutes: nullableNumber, progressNote: { type: "string" }, sourceRefs: { type: "array", items: { type: "string" } } },
} as const;

const threadContentJsonSchema = {
  type: "object", additionalProperties: false, required: ["threadId", "summary", "linkedArtifactIds"],
  properties: { threadId: nullableString, summary: { type: "string" }, linkedArtifactIds: { type: "array", items: { type: "string" } } },
} as const;

function artifactCreateVariant(blueprintKey: (typeof SPECTRA_BLUEPRINT_KEYS)[number], content: unknown) {
  return {
    type: "object", additionalProperties: false, required: ["type", "input"],
    properties: {
      type: { const: "artifact.create" },
      input: { type: "object", additionalProperties: false, required: ["blueprintKey", "title", "summary", "content", "tags", "workspaceId", "placement"], properties: { blueprintKey: { const: blueprintKey }, title: { type: "string" }, summary: nullableString, content, tags: { type: "array", items: { type: "string" }, maxItems: 16 }, workspaceId: nullableString, placement: { enum: ["context", "inbox"] } } },
    },
  } as const;
}

function artifactUpdateVariant(blueprintKey: (typeof SPECTRA_BLUEPRINT_KEYS)[number], content: unknown) {
  return {
    type: "object", additionalProperties: false, required: ["type", "input"],
    properties: {
      type: { const: "artifact.update" },
      input: { type: "object", additionalProperties: false, required: ["artifactId", "blueprintKey", "title", "summary", "content", "tags"], properties: { artifactId: { type: "string" }, blueprintKey: { const: blueprintKey }, title: nullableString, summary: nullableString, content: { anyOf: [content, { type: "null" }] }, tags: { anyOf: [{ type: "array", items: { type: "string" }, maxItems: 16 }, { type: "null" }] } } },
    },
  } as const;
}

export const SPECTRA_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "intent", "conversationTitle", "conversationSummary", "choices", "finalResponse", "operations"],
  properties: {
    decision: { enum: PLAN_DECISIONS },
    intent: { type: "object", additionalProperties: false, required: ["mode", "requestedArtifactTypes", "requestedVisibleArtifactCount", "targetArtifactId", "targetWorkspaceId"], properties: { mode: { enum: REQUEST_INTENT_MODES }, requestedArtifactTypes: { type: "array", items: { enum: SPECTRA_BLUEPRINT_KEYS }, maxItems: 5 }, requestedVisibleArtifactCount: { type: "integer", minimum: 0, maximum: 1000 }, targetArtifactId: nullableString, targetWorkspaceId: nullableString } },
    conversationTitle: nullableString,
    conversationSummary: nullableString,
    choices: { anyOf: [{ type: "object", additionalProperties: false, required: ["question", "options"], properties: { question: { type: "string" }, options: { type: "array", minItems: 2, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["title", "description"], properties: { title: { type: "string" }, description: nullableString } } } } }, { type: "null" }] },
    finalResponse: { type: "string", minLength: 1, maxLength: 4000 },
    operations: {
      type: "array", maxItems: 8,
      items: { oneOf: [
        artifactCreateVariant("document", documentContentJsonSchema),
        artifactCreateVariant("flashcard_deck", deckContentJsonSchema),
        artifactCreateVariant("quiz", quizContentJsonSchema),
        artifactCreateVariant("planner_task", plannerContentJsonSchema),
        artifactCreateVariant("thread_reference", threadContentJsonSchema),
        artifactUpdateVariant("document", documentContentJsonSchema),
        artifactUpdateVariant("flashcard_deck", deckContentJsonSchema),
        artifactUpdateVariant("quiz", quizContentJsonSchema),
        artifactUpdateVariant("planner_task", plannerContentJsonSchema),
        artifactUpdateVariant("thread_reference", threadContentJsonSchema),
        { type: "object", additionalProperties: false, required: ["type", "input"], properties: { type: { const: "workspace.create" }, input: { type: "object", additionalProperties: false, required: ["title", "description", "icon", "color"], properties: { title: { type: "string" }, description: nullableString, icon: { anyOf: [{ enum: ["Sparkles", "BookOpen", "Sprout", "BarChart3"] }, { type: "null" }] }, color: nullableString } } } },
        { type: "object", additionalProperties: false, required: ["type", "input"], properties: { type: { const: "workspace.update" }, input: { type: "object", additionalProperties: false, required: ["workspaceId", "title", "description", "icon", "color"], properties: { workspaceId: { type: "string" }, title: nullableString, description: nullableString, icon: { anyOf: [{ enum: ["Sparkles", "BookOpen", "Sprout", "BarChart3"] }, { type: "null" }] }, color: nullableString } } } },
        { type: "object", additionalProperties: false, required: ["type", "input"], properties: { type: { const: "artifact.link" }, input: { type: "object", additionalProperties: false, required: ["sourceArtifactId", "targetArtifactId", "relationType", "label", "explanation", "workspaceId"], properties: { sourceArtifactId: { type: "string" }, targetArtifactId: { type: "string" }, relationType: { enum: ["related", "supports", "contradicts", "source_for", "generated_from", "follow_up", "belongs_with"] }, label: nullableString, explanation: nullableString, workspaceId: nullableString } } } },
        { type: "object", additionalProperties: false, required: ["type", "input"], properties: { type: { const: "workspaceItem.add" }, input: { type: "object", additionalProperties: false, required: ["artifactId", "workspaceId"], properties: { artifactId: { type: "string" }, workspaceId: { type: "string" } } } } },
        { type: "object", additionalProperties: false, required: ["type", "input"], properties: { type: { const: "workspaceItem.hide" }, input: { type: "object", additionalProperties: false, required: ["workspaceItemId"], properties: { workspaceItemId: { type: "string" } } } } },
      ] },
    },
  },
} as const;
