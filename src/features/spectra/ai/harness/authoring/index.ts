import type { ArtifactTypeKey } from "../../../artifacts/types";
import { agentFromSpec, agentOutline, agentProblems, applyAgentEdits, type AgentEditOp, type AgentFields } from "./agent";
import { applyCodeEdits, codeFromSpec, codeOutline, codeReadback, type CodeEditOp, type CodeSpec } from "./code";
import {
  applyDocumentEdits,
  documentChunks,
  documentFromMarkdown,
  documentReadback,
  documentSectionMarkdown,
  documentToMarkdown,
  type DocumentEditOp,
} from "./document";
import {
  applyListEdits,
  applyPlannerTaskEdits,
  isListType,
  listFromSpec,
  listOutline,
  listProblems,
  listReadback,
  plannerTaskFromSpec,
  plannerTaskOutline,
  plannerTaskProblems,
  type ListEditOp,
  type PlannerTaskOp,
} from "./items";
import { KEEP_MARKER } from "./markdown";
import {
  applyPresentationEdits,
  presentationFromSpec,
  presentationOutline,
  presentationProblems,
  presentationReadback,
  type PresentationEditOp,
  type PresentationSpec,
} from "./presentation";
import { AuthoringError, type IdFactory, defaultIdFactory, isPlaceholder, list, record, truncate } from "./shared";
import { applySheetsEdits, sheetRangeText, sheetsFromSpec, sheetsProblems, sheetsReadback, type SheetsEditOp, type SheetsSpec } from "./sheets";
import {
  applyWhiteboardEdits,
  whiteboardFromSpec,
  whiteboardOutline,
  whiteboardProblems,
  whiteboardReadback,
  type WhiteboardEditOp,
  type WhiteboardSpec,
} from "./whiteboard";

/*
 * One entry point per verb for every artifact type: build content from a
 * spec, apply edit operations, read a range, and describe the result. The
 * tools call only these; each type's authoring format lives in its module.
 */

export { AuthoringError } from "./shared";

export const AUTHORED_TYPES = [
  "document",
  "presentation",
  "sheets",
  "whiteboard",
  "flashcard_deck",
  "quiz",
  "planner_task",
  "code",
  "agent",
  "timetable",
] as const satisfies readonly ArtifactTypeKey[];

export type AuthoredType = (typeof AUTHORED_TYPES)[number];

export function isAuthoredType(type: unknown): type is AuthoredType {
  return typeof type === "string" && (AUTHORED_TYPES as readonly string[]).includes(type);
}

export type AuthoringContext = { timeZone: string; ids?: IdFactory };

export type AuthoredContent = {
  content: Record<string, unknown>;
  /** What the model reads back: shape, problems, the changed parts. */
  readback: string;
  /** Empty or placeholder content, overflow, broken formulas. */
  problems: string[];
  /** For the user: "6 slides", "Added 2 cards". Never an id. */
  summary: string;
};

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function documentProblems(content: unknown) {
  const chunks = documentChunks(content);
  const problems: string[] = [];
  chunks.forEach((chunk, index) => {
    if (KEEP_MARKER.test(chunk.markdown)) return;
    const bare = chunk.markdown.replace(/^#+\s*|^[-*>]\s*|\[[ x]\]\s*/gm, "").trim();
    if (chunk.node.type === "horizontalRule") return;
    if (!bare && !(index === 0 && chunks.length === 1)) problems.push(`block ${index + 1} (${chunk.node.type}) is empty`);
    else if (bare && isPlaceholder(bare)) problems.push(`block ${index + 1} holds placeholder text "${bare}"`);
  });
  if (!chunks.some((chunk) => chunk.markdown.trim())) problems.push("the document is empty");
  return problems;
}

/** A count that describes the artifact's size, for summaries. */
function measure(type: AuthoredType, content: unknown): { count: number; noun: string } | null {
  const value = record(content);
  switch (type) {
    case "document":
      return { count: documentToMarkdown(content).split(/\s+/).filter(Boolean).length, noun: "word" };
    case "presentation":
      return { count: list(value.slides).length, noun: "slide" };
    case "sheets":
      return { count: list(value.sheets).length, noun: "sheet" };
    case "whiteboard":
      return { count: list(value.nodes).length, noun: "node" };
    case "flashcard_deck":
      return { count: list(value.cards).length, noun: "card" };
    case "quiz":
      return { count: list(value.questions).length, noun: "question" };
    case "timetable":
      return { count: list(value.events).length, noun: "event" };
    case "planner_task":
      return { count: list(value.subtasks).length, noun: "subtask" };
    case "code":
      return { count: list(value.files).length, noun: "file" };
    default:
      return null;
  }
}

function summarise(type: AuthoredType, content: unknown, before?: unknown) {
  const now = measure(type, content);
  if (!before) {
    if (!now || (type === "planner_task" && !now.count)) return "Created";
    return type === "document" ? `About ${plural(now.count, now.noun)}` : plural(now.count, now.noun);
  }
  const then = measure(type, before);
  if (!now || !then || type === "document" || now.count === then.count) return "Edited";
  const delta = now.count - then.count;
  return delta > 0 ? `Added ${plural(delta, now.noun)}` : `Removed ${plural(-delta, now.noun)}`;
}

function problemsOf(type: AuthoredType, content: unknown): string[] {
  switch (type) {
    case "document":
      return documentProblems(content);
    case "presentation":
      return presentationProblems(content);
    case "sheets":
      return sheetsProblems(content);
    case "whiteboard":
      return whiteboardProblems(content);
    case "planner_task":
      return plannerTaskProblems(content);
    case "agent":
      return agentProblems(content);
    default:
      return isListType(type) ? listProblems(type, content) : [];
  }
}

function withProblems(readback: string, problems: string[], alreadyListed: boolean) {
  if (!problems.length || alreadyListed) return readback;
  return `${readback}\nProblems: ${problems.join("; ")}.`;
}

function asArray<T>(value: unknown, field: string): T[] {
  if (!Array.isArray(value) || !value.length) throw new AuthoringError(`${field} must be a non-empty list.`);
  return value as T[];
}

/** Builds new content from the type's creation spec. */
export function authorNew(type: AuthoredType, spec: unknown, context: AuthoringContext): AuthoredContent {
  const ids = context.ids ?? defaultIdFactory();
  const input = record(spec);
  let content: Record<string, unknown>;
  let readback: string;
  let listed = true;
  switch (type) {
    case "document": {
      const markdown = typeof input.markdown === "string" ? input.markdown : "";
      if (!markdown.trim()) throw new AuthoringError("markdown is required: the whole document in Markdown.");
      content = documentFromMarkdown(markdown, undefined, ids);
      readback = documentReadback(content);
      listed = false;
      break;
    }
    case "presentation":
      content = presentationFromSpec(
        {
          slides: asArray(input.slides, "slides"),
          theme: input.theme as PresentationSpec["theme"],
          design: input.design as PresentationSpec["design"],
        },
        ids,
      );
      readback = presentationReadback(content);
      break;
    case "sheets":
      content = sheetsFromSpec({ sheets: asArray(input.sheets, "sheets") } as SheetsSpec, ids).content as unknown as Record<string, unknown>;
      readback = sheetsReadback(content);
      break;
    case "whiteboard":
      content = whiteboardFromSpec(
        { nodes: asArray(input.nodes, "nodes"), edges: input.edges as WhiteboardSpec["edges"], layout: input.layout as WhiteboardSpec["layout"] },
        ids,
      );
      readback = whiteboardReadback(content);
      break;
    case "flashcard_deck":
    case "quiz":
    case "timetable":
      content = listFromSpec(
        type,
        { items: asArray(input.items, "items"), settings: input.settings as Record<string, unknown> | undefined },
        ids,
      );
      readback = listReadback(type, content);
      break;
    case "planner_task":
      content = plannerTaskFromSpec(input as Parameters<typeof plannerTaskFromSpec>[0], context.timeZone, ids);
      readback = plannerTaskOutline(content);
      listed = false;
      break;
    case "code":
      content = codeFromSpec(input as CodeSpec, ids) as unknown as Record<string, unknown>;
      readback = codeReadback(content);
      listed = false;
      break;
    case "agent":
      content = agentFromSpec(input as AgentFields, ids) as unknown as Record<string, unknown>;
      readback = agentOutline(content);
      listed = false;
      break;
  }
  const problems = problemsOf(type, content);
  return { content, readback: withProblems(readback, problems, listed), problems, summary: summarise(type, content) };
}

/** Applies edit operations to a copy. Throws an AuthoringError naming the operation. */
export function authorEdit(type: AuthoredType, before: unknown, ops: unknown, context: AuthoringContext): AuthoredContent {
  const ids = context.ids ?? defaultIdFactory();
  const operations = asArray<Record<string, unknown>>(ops, "operations");
  let content: Record<string, unknown>;
  let readback: string;
  let listed = true;
  switch (type) {
    case "document": {
      const markdown = applyDocumentEdits(documentToMarkdown(before), operations as unknown as DocumentEditOp[]);
      content = documentFromMarkdown(markdown, before, ids);
      readback = documentReadback(content, before);
      listed = false;
      break;
    }
    case "presentation":
      content = applyPresentationEdits(before, operations as unknown as PresentationEditOp[], ids);
      readback = presentationReadback(content, before);
      break;
    case "sheets": {
      const result = applySheetsEdits(before, operations as unknown as SheetsEditOp[], ids);
      content = result.content as unknown as Record<string, unknown>;
      readback = sheetsReadback(content, result.touched);
      break;
    }
    case "whiteboard":
      content = applyWhiteboardEdits(before, operations as unknown as WhiteboardEditOp[], ids) as unknown as Record<string, unknown>;
      readback = whiteboardReadback(content, before);
      break;
    case "flashcard_deck":
    case "quiz":
    case "timetable":
      content = applyListEdits(type, before, operations as unknown as ListEditOp[], ids);
      readback = listReadback(type, content, before);
      break;
    case "planner_task":
      content = applyPlannerTaskEdits(
        { timezone: context.timeZone, ...record(before) },
        operations as unknown as PlannerTaskOp[],
        ids,
      );
      readback = plannerTaskOutline(content);
      listed = false;
      break;
    case "code":
      content = applyCodeEdits(before, operations as unknown as CodeEditOp[], ids) as unknown as Record<string, unknown>;
      readback = codeReadback(content, before);
      listed = false;
      break;
    case "agent":
      content = applyAgentEdits(before, operations as unknown as AgentEditOp[], ids) as unknown as Record<string, unknown>;
      readback = agentOutline(content);
      listed = false;
      break;
  }
  const problems = problemsOf(type, content);
  return { content, readback: withProblems(readback, problems, listed), problems, summary: summarise(type, content, before) };
}

export type ReadRange = {
  /** Document heading; its section is returned. */
  section?: string;
  /** Slide, card, question or line numbers (1-based, inclusive). */
  from?: number;
  to?: number;
  /** Sheets: the sheet name and an A1 range. */
  sheet?: string;
  range?: string;
  /** Code: the file path. */
  file?: string;
};

const READ_LIMIT = 16_000;

/** The artifact in its authoring format, or the requested part of it. */
export function readAuthored(type: AuthoredType, content: unknown, range: ReadRange = {}): string {
  switch (type) {
    case "document": {
      const markdown = documentToMarkdown(content);
      if (range.section) return documentSectionMarkdown(markdown, range.section);
      if (markdown.length <= READ_LIMIT) return markdown || "(empty document)";
      return `${markdown.slice(0, READ_LIMIT)}\n… The document continues. Read a section by its heading to see more.`;
    }
    case "presentation":
      return presentationOutline(content, {
        max: READ_LIMIT,
        ...(range.from ? { slides: [range.from, range.to ?? range.from] as [number, number] } : {}),
      });
    case "sheets": {
      const book = record(content);
      const names = list(book.sheets).map((sheet) => String(record(sheet).name));
      if (range.sheet || range.range) return sheetRangeText(content, { sheet: range.sheet, range: range.range, maxRows: 60, maxColumns: 16 });
      return names.map((name) => sheetRangeText(content, { sheet: name, maxRows: 40, maxColumns: 12 })).join("\n\n");
    }
    case "whiteboard":
      return whiteboardOutline(content, READ_LIMIT);
    case "flashcard_deck":
    case "quiz":
    case "timetable":
      return listOutline(type, content, { from: range.from, to: range.to, max: READ_LIMIT });
    case "planner_task":
      return plannerTaskOutline(content);
    case "code":
      return codeOutline(content, { file: range.file, from: range.from, to: range.to, max: READ_LIMIT });
    case "agent":
      return agentOutline(content);
  }
}

/** A short shape line for listings and the environment block. */
export function authoredShape(type: AuthoredType, content: unknown) {
  const size = measure(type, content);
  return size ? (type === "document" ? `about ${plural(size.count, size.noun)}` : plural(size.count, size.noun)) : "";
}

export function authoredProblems(type: AuthoredType, content: unknown) {
  return problemsOf(type, content);
}

export { truncate };
