import { previewText } from "../components/preview-text";
import { normalizeWhiteboardContent, type WhiteboardEdge, type WhiteboardNode } from "../whiteboard/model";
import type { PresentedWorkType } from "./presentation";
import { getArtifactTypeManifest } from "./registry";

/*
 * What a work looks like from the outside: the first words of a document, the
 * front of a few flashcards, the question a quiz opens with, the corner of a
 * sheet, a board's first page, when a task is due, what a thread last asked.
 * Cards draw this
 * instead of a type icon, so a desk of work reads as the work itself. Every
 * reader is defensive: content is whatever the editor saved, and a preview
 * that cannot be read is simply absent.
 */

/** A line of a document's opening: words, or a table drawn as one. */
export type PreviewLine = string | { rows: string[][] };

export type WorkPreview =
  | { kind: "text"; heading?: string; lines: PreviewLine[] }
  | { kind: "cards"; count: number; fronts: string[] }
  | { kind: "questions"; count: number; first: string; options: string[] }
  | { kind: "tasks"; items: Array<{ title: string; done: boolean }> }
  | {
      kind: "task";
      status: TaskStatus;
      dueAt?: number;
      priority?: "low" | "medium" | "high";
      note: string;
      steps: { done: number; total: number };
    }
  | { kind: "exchange"; ask: string; answer: string }
  | { kind: "code"; path: string; lines: string[] }
  | { kind: "slides"; count: number; titles: string[] }
  | { kind: "grid"; rows: string[][] }
  | { kind: "board"; pages: number; nodes: WhiteboardNode[]; edges: WhiteboardEdge[] }
  /** A file's first page, drawn small (a PDF). */
  | { kind: "page"; image: string; pages: number };

export type TaskStatus = "todo" | "doing" | "done";

type Json = Record<string, unknown>;

const record = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown, limit = 160) => (typeof value === "string" ? previewText(value).slice(0, limit) : "");

const HEADING = /^(heading|title|h[1-3])/i;
/** The corner of a table a card shows, as a sheet's corner is. */
const TABLE = { rows: 4, columns: 4 };

/**
 * A block's words without what stands in for its pictures: an imported
 * picture's alternative text is often only Word's "Picture 1", which read on
 * a card as if the document said it.
 */
function blockWords(block: Json, limit: number) {
  const inline = list(block.inlineContent).map(record);
  if (!inline.length) return text(block.text, limit);
  return text(inline.map((item) => (item.kind === "text" ? String(item.text ?? "") : item.kind === "equation" ? String(item.latex ?? "") : "")).join(""), limit);
}

function tableCorner(block: Json): PreviewLine | null {
  const rows = list(block.rows)
    .slice(0, TABLE.rows)
    .map((row) => list(row).slice(0, TABLE.columns).map((cell) => text(cell, 40)));
  return rows.some((row) => row.some(Boolean)) ? { rows } : null;
}

function documentPreview(content: Json): WorkPreview | null {
  const blocks = list(content.blocks).map(record);
  const filled = blocks.flatMap((block) => {
    const type = String(block.type ?? "");
    if (type === "image") return [];
    if (type === "table") {
      const table = tableCorner(block);
      return table ? [{ type, line: table }] : [];
    }
    const words = blockWords(block, 220);
    return words ? [{ type, line: words as PreviewLine }] : [];
  });
  if (!filled.length) return null;
  const [first, ...rest] = filled;
  // A short or heading-typed opening line is the document's own title for its body.
  const titled = typeof first.line === "string" && (HEADING.test(first.type) || (first.line.length < 70 && rest.length > 0));
  return titled
    ? { kind: "text", heading: first.line as string, lines: rest.slice(0, 4).map((block) => block.line) }
    : { kind: "text", lines: filled.slice(0, 5).map((block) => block.line) };
}

function deckPreview(content: Json): WorkPreview | null {
  const cards = list(content.cards).map(record);
  if (!cards.length) return null;
  return { kind: "cards", count: cards.length, fronts: cards.map((card) => text(card.front, 90)).filter(Boolean).slice(0, 3) };
}

function quizPreview(content: Json, optionLabels: (question: Json) => string[]): WorkPreview | null {
  const questions = list(content.questions).map(record);
  if (!questions.length) return null;
  const first = questions.find((question) => text(question.prompt)) ?? questions[0];
  return { kind: "questions", count: questions.length, first: text(first.prompt, 200), options: optionLabels(first).slice(0, 3) };
}

/** A list of tasks shows its first few; a single task shows when it is due, how far along it is, and its note. */
function taskPreview(stored: Json): WorkPreview | null {
  const tasks = list(stored.tasks).map(record);
  // A single task keeps its one plan task beside its own fields; it is still one task, not a list of one.
  const only = tasks.length === 1 ? tasks[0] : null;
  const content: Json = only
    ? {
        ...stored,
        status: typeof stored.status === "string" ? stored.status : only.status === "completed" ? "done" : only.status,
        dueAt: stored.dueAt ?? only.dueAt,
        description: text(stored.description) ? stored.description : only.description,
        subtasks: Array.isArray(stored.subtasks) && stored.subtasks.length ? stored.subtasks : only.checklist,
      }
    : stored;
  const items = (only ? [] : tasks)
    .map((task) => ({ title: text(task.title ?? task.taskTitle, 90), done: task.status === "done" || task.status === "completed" }))
    .filter((item) => item.title);
  if (items.length) return { kind: "tasks", items: items.slice(0, 4) };
  if (only && typeof content.status !== "string") content.status = "todo";
  if (!text(content.taskTitle) && typeof content.status !== "string") return null;
  const steps = list(content.subtasks).map(record);
  const status = content.status === "done" || content.status === "doing" ? content.status : "todo";
  const priority = content.priority === "low" || content.priority === "medium" || content.priority === "high" ? content.priority : undefined;
  return {
    kind: "task",
    status,
    dueAt: typeof content.dueAt === "number" ? content.dueAt : typeof content.endAt === "number" ? content.endAt : undefined,
    priority,
    note: text(content.description, 200) || text(content.progressNote, 200),
    steps: { done: steps.filter((step) => step.done === true).length, total: steps.length },
  };
}

function codePreview(content: Json): WorkPreview | null {
  const files = list(content.files).map(record);
  const entry = files.find((file) => file.id === content.entryFileId && text(file.source)) ?? files.find((file) => typeof file.source === "string" && file.source.trim());
  if (!entry || typeof entry.source !== "string") return null;
  const lines = entry.source.split("\n").map((line) => line.replace(/\t/g, "  ").slice(0, 80)).filter((line, index, all) => line.trim() || (index > 0 && all[index - 1].trim()));
  return lines.length ? { kind: "code", path: String(entry.path ?? ""), lines: lines.slice(0, 6) } : null;
}

function slidesPreview(content: Json): WorkPreview | null {
  const slides = list(content.slides).map(record);
  if (!slides.length) return null;
  const titles = slides
    .map((slide) => text(slide.title, 80) || text(list(slide.objects).map((object) => firstWords(record(object).content)).find(Boolean), 80))
    .filter(Boolean);
  return { kind: "slides", count: slides.length, titles: titles.slice(0, 3) };
}

/** The first words a slide object holds, wherever its rich text keeps them. */
function firstWords(value: unknown, depth = 0): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (depth > 5 || !value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = firstWords(child, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  // Only the fields that hold words: a style name or a run's font is not one.
  const holder = value as Record<string, unknown>;
  for (const key of ["text", "content", "paragraphs", "runs", "children", "items"]) {
    const found = firstWords(holder[key], depth + 1);
    if (found) return found;
  }
  return undefined;
}

/** The rows and columns a sheet's corner shows: enough to read as a table. */
const GRID = { rows: 6, columns: 4 };

/** A sheet's top-left corner as it reads on screen, from the first sheet with anything in it. */
function gridPreview(content: Json): WorkPreview | null {
  const sheets = list(content.sheets).map(record);
  const sheet = sheets.find((candidate) => candidate.id === content.activeSheetId && candidate.hidden !== true) ?? sheets.find((candidate) => candidate.hidden !== true);
  return cornerPreview(record(sheet?.cells), (cell) => {
    const value = record(cell).value;
    return typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : typeof value === "boolean" ? String(value).toUpperCase() : text(value, 40);
  });
}

/** A sheet's top-left corner from cells keyed by address, each read to the words it shows. */
export function cornerPreview(cells: Record<string, unknown>, shownOf: (cell: unknown) => string): WorkPreview | null {
  const rows = Array.from({ length: GRID.rows }, () => Array.from({ length: GRID.columns }, () => ""));
  let filled = false;
  for (const [address, cell] of Object.entries(cells)) {
    const match = /^([A-Z]+)(\d+)$/.exec(address.toUpperCase());
    if (!match || match[1]!.length > 1) continue;
    const column = match[1]!.charCodeAt(0) - 65;
    const row = Number(match[2]) - 1;
    if (column >= GRID.columns || row >= GRID.rows) continue;
    const shown = shownOf(cell);
    if (shown) {
      rows[row]![column] = shown;
      filled = true;
    }
  }
  if (!filled) return null;
  // Rows past the last written one are left off, so a short table is not padded.
  const last = rows.findLastIndex((row) => row.some(Boolean));
  return { kind: "grid", rows: rows.slice(0, last + 1) };
}

/** Objects a board's thumbnail draws at most; more is a sample, as the rail's is. */
const BOARD_OBJECTS = 80;

/** A board's first page with anything on it, as the page rail draws it. */
function boardPreview(content: Json): WorkPreview | null {
  const board = normalizeWhiteboardContent(content);
  const page = board.pages.find((candidate) => board.nodes.some((node) => node.pageId === candidate.id && !node.hidden));
  if (!page) return null;
  const nodes = board.nodes.filter((node) => node.pageId === page.id && !node.hidden);
  const step = Math.ceil(nodes.length / BOARD_OBJECTS);
  const sample = step > 1 ? nodes.filter((_, index) => index % step === 0) : nodes;
  const kept = new Set(sample.map((node) => node.id));
  return {
    kind: "board",
    pages: board.pages.length,
    nodes: sample,
    edges: board.edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
  };
}

/** Messages are Markdown; a face shows the words, not the marks around them. */
function unmarked(value: string) {
  return value
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__|\*|~~|`)(\S(?:.*?\S)?)\1/g, "$2");
}

/** A thread's face is its last exchange: what was asked, and how the answer began. */
export function threadPreview(messages: ReadonlyArray<{ role: string; content: string }>): WorkPreview | null {
  const spoken = messages.filter((message) => (message.role === "user" || message.role === "assistant") && text(message.content));
  const lastAsk = spoken.findLastIndex((message) => message.role === "user");
  if (lastAsk < 0) return null;
  const answer = spoken.slice(lastAsk + 1).find((message) => message.role === "assistant");
  return {
    kind: "exchange",
    ask: text(unmarked(spoken[lastAsk]!.content), 140),
    answer: answer ? text(unmarked(answer.content), 260) : "",
  };
}

export function workPreview(type: PresentedWorkType, content: unknown): WorkPreview | null {
  const body = record(content);
  switch (type) {
    case "document":
      return documentPreview(body);
    case "flashcard_deck":
      return deckPreview(body);
    case "quiz":
      return quizPreview(body, (question) => list(question.options).map((option) => text(record(option).text ?? record(option).label ?? option, 60)).filter(Boolean));
    case "planner_task":
      return taskPreview(body);
    case "code":
      return codePreview(body);
    case "presentation":
      return slidesPreview(body);
    case "sheets":
      return gridPreview(body);
    case "whiteboard":
      return boardPreview(body);
    default:
      return null;
  }
}

/** A summary worth reading: not the type's own boilerplate, an import note or a bare file size. */
export function meaningfulSummary(type: PresentedWorkType, summary?: string) {
  const value = previewText(summary);
  if (!value) return "";
  if (value === getArtifactTypeManifest(type)?.identity.description) return "";
  if (/^imported from /i.test(value) || /^[\d.,]+\s?(B|KB|MB|GB)$/i.test(value)) return "";
  return value;
}

/** The file kind a resource's name declares ("PDF", "XLSX"), for cards that have no preview of their own. */
export function fileKind(title: string) {
  const match = /\.([a-z0-9]{2,5})$/i.exec(title.trim());
  return match ? match[1].toUpperCase() : null;
}

/** How much a work holds, in words ("12 cards", "3 slides"), when its kind counts anything. */
export function previewExtent(preview: WorkPreview) {
  if (preview.kind === "cards") return plural(preview.count, "card");
  if (preview.kind === "questions") return plural(preview.count, "question");
  if (preview.kind === "slides") return plural(preview.count, "slide");
  if ((preview.kind === "board" || preview.kind === "page") && preview.pages > 1) return plural(preview.pages, "page");
  return null;
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
