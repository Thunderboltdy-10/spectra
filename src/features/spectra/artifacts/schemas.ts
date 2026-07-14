import { z } from "zod";
import { documentContentSchema } from "../blueprints/document";
import { flashcardDeckContentSchema } from "../blueprints/flashcard-deck";
import { plannerTaskContentSchema } from "../blueprints/planner-task";
import { quizContentSchema } from "../blueprints/quiz";

const id = z.string().trim().min(1).max(180);
const text = z.string().max(250_000);

export { documentContentSchema, flashcardDeckContentSchema, plannerTaskContentSchema, quizContentSchema };

export const agentContentSchema = z.object({
  instructions: z.object({ regionId: id, text }),
  skills: z.array(z.object({ id, name: z.string().min(1).max(100), instructions: text, enabled: z.boolean() })),
  tools: z.array(z.object({ id, key: z.string().min(1).max(100), enabled: z.boolean(), approval: z.enum(["never", "consequential", "always"]) })),
  resources: z.array(z.object({ id, artifactId: id, mode: z.enum(["read", "use"]), label: z.string().max(160) })),
  routing: z.object({ enabled: z.boolean(), description: z.string().max(2_000).optional(), examples: z.array(z.string().max(500)).max(30).optional() }),
}).strict();

export const timetableContentSchema = z.object({
  timezone: z.string().min(1).max(100),
  layers: z.array(z.object({ id, name: z.string().min(1).max(120), kind: z.enum(["personal", "school", "class", "tasks", "external"]), visible: z.boolean(), sourceId: id.optional() })),
  events: z.array(z.object({ id, layerId: id, title: z.string().min(1).max(300), start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), allDay: z.boolean(), recurrence: z.string().max(500).optional(), sourceRef: id.optional(), location: z.string().max(300).optional(), notes: text.optional() })),
}).strict();

const slideObjectSchema = z.object({
  id,
  type: z.enum(["text", "shape", "image", "chart", "table", "embed", "video", "group"]),
  x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), rotation: z.number(),
  content: z.unknown(),
  style: z.record(z.string(), z.unknown()).optional(),
  altText: z.string().max(2_000).optional(),
});
export const presentationContentSchema = z.object({
  theme: z.object({ id, tokens: z.record(z.string(), z.string()).optional() }),
  slides: z.array(z.object({ id, title: z.string().max(300), speakerNotes: text.optional(), objects: z.array(slideObjectSchema) })).min(1),
}).strict();

const cellSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  formula: z.string().max(8_000).optional(),
  format: z.record(z.string(), z.unknown()).optional(),
  validation: z.record(z.string(), z.unknown()).optional(),
});
export const sheetsContentSchema = z.object({
  workbook: z.object({ calculationMode: z.enum(["automatic", "manual"]), locale: z.string().min(2).max(40), namedRanges: z.record(z.string(), z.string()).optional() }),
  sheets: z.array(z.object({
    id, name: z.string().min(1).max(100),
    cells: z.record(z.string().regex(/^[A-Z]+[1-9][0-9]*$/), cellSchema),
    tables: z.array(z.object({ id, name: z.string().min(1).max(100), range: z.string().min(2).max(100), filters: z.array(z.unknown()).optional(), sort: z.array(z.unknown()).optional() })),
    charts: z.array(z.object({ id, type: z.enum(["column", "bar", "line", "area", "pie", "scatter", "combo"]), sourceRange: z.string().min(2).max(100), title: z.string().max(300), position: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }) })),
  })).min(1),
  activeSheetId: id,
}).strict();

export const codeContentSchema = z.object({
  runtime: z.enum(["browser", "react", "python", "none"]),
  entryFileId: id,
  files: z.array(z.object({ id, path: z.string().min(1).max(500), language: z.string().min(1).max(60), source: text })).min(1),
  visualisation: z.object({ enabled: z.boolean(), title: z.string().max(300).optional(), description: z.string().max(2_000).optional() }),
  dependencies: z.record(z.string(), z.string()).optional(),
}).strict();

export const whiteboardContentSchema = z.object({
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }),
  nodes: z.array(z.object({ id, type: z.enum(["text", "note", "shape", "image", "embed", "frame", "group"]), x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), rotation: z.number().optional(), content: z.unknown(), style: z.record(z.string(), z.unknown()).optional(), layerId: id })),
  edges: z.array(z.object({ id, from: id, to: id, fromAnchor: z.string().max(100).optional(), toAnchor: z.string().max(100).optional(), label: z.string().max(500).optional(), style: z.record(z.string(), z.unknown()).optional() })),
  layers: z.array(z.object({ id, name: z.string().min(1).max(100), visible: z.boolean(), locked: z.boolean() })).min(1),
}).strict();

export const artifactContentSchemas = {
  document: documentContentSchema,
  flashcard_deck: flashcardDeckContentSchema,
  quiz: quizContentSchema,
  planner_task: plannerTaskContentSchema,
  agent: agentContentSchema,
  timetable: timetableContentSchema,
  presentation: presentationContentSchema,
  sheets: sheetsContentSchema,
  code: codeContentSchema,
  whiteboard: whiteboardContentSchema,
} as const;

