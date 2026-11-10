/*
 * What a person reads in a saved version, whatever kind of work it is: the
 * words on the page, in page order. Nothing here ever falls back to printing
 * the stored structure.
 */

import { plainTextFromStored } from "../../rich-content/adapters";

type Snapshot = { title?: unknown; summary?: unknown; content?: unknown };

export type ReadablePart = { label?: string; text: string };

export type VersionPartChange =
  | { kind: "same"; count: number; first: string }
  | { kind: "changed"; label?: string; before: string; after: string }
  | { kind: "added"; label?: string; after: string }
  | { kind: "removed"; label?: string; before: string };

const TEXT_KEYS = [
  "text", "title", "heading", "label", "name", "front", "back", "hint", "prompt", "question", "answer",
  "explanation", "notes", "note", "caption", "alt", "description", "summary", "body", "value", "source",
  "content", "items", "children", "rows", "cells", "options", "choices", "blocks", "subtasks", "elements",
  "shapes", "nodes", "columns",
];

/** The words inside a stored value, skipping ids, styling and anything else that is not read. */
export function textOf(value: unknown, depth = 0, storedRichText = false): string {
  if (value == null || depth > 12) return "";
  if (typeof value === "string") return storedRichText ? plainTextFromStored(value) : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => textOf(item, depth + 1, storedRichText)).filter(Boolean).join(" ");
  if (typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of TEXT_KEYS) {
    if (key in record) {
      const text = textOf(record[key], depth + 1, storedRichText);
      if (text) parts.push(text);
    }
  }
  return parts.join(" ");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object").map(record) : [];
}

function clean(text: string) {
  return text.replace(/[ \t ]+/g, " ").trim();
}

/** A rich-text tree, one part per block; list items and table rows each stand alone. */
function proseMirrorParts(node: Record<string, unknown>, out: ReadablePart[]) {
  const children = records(node.content);
  for (const child of children) {
    const type = String(child.type ?? "");
    if (["bulletList", "orderedList", "taskList", "listItem", "taskItem", "table", "blockquote", "callout"].includes(type)) {
      proseMirrorParts(child, out);
      continue;
    }
    const text = clean(textOf(child));
    if (text) out.push({ text });
  }
}

function sheetParts(content: Record<string, unknown>, out: ReadablePart[]) {
  for (const sheet of records(content.sheets)) {
    const name = String(sheet.name ?? sheet.title ?? "Sheet");
    const cells = sheet.cells;
    if (cells && typeof cells === "object" && !Array.isArray(cells)) {
      for (const [ref, cell] of Object.entries(cells as Record<string, unknown>)) {
        const entry = record(cell);
        const text = clean(textOf(entry.formula ?? entry.value ?? entry.text ?? cell));
        if (text) out.push({ label: `${name} ${ref}`, text });
      }
      continue;
    }
    records(sheet.rows).forEach((row, index) => {
      const text = clean(textOf(row));
      if (text) out.push({ label: `${name} row ${index + 1}`, text });
    });
  }
}

export function readableParts(blueprintKey: string | undefined, snapshot: Snapshot): ReadablePart[] {
  const out: ReadablePart[] = [];
  const title = clean(textOf(snapshot.title));
  const summary = clean(textOf(snapshot.summary));
  if (title) out.push({ label: "Title", text: title });
  if (summary) out.push({ label: "Summary", text: summary });
  const content = record(snapshot.content);
  const numbered = (items: Record<string, unknown>[], noun: string) =>
    items.forEach((item, index) => {
      const text = clean(textOf(item, 0, blueprintKey === "quiz"));
      if (text) out.push({ label: `${noun} ${index + 1}`, text });
    });
  switch (blueprintKey) {
    case "document": {
      const tree = record(content.tiptap);
      if (tree.type === "doc") proseMirrorParts(tree, out);
      else
        for (const block of records(content.blocks)) {
          const text = clean(textOf(block));
          if (text) out.push({ text });
        }
      break;
    }
    case "flashcard_deck":
      records(content.cards).forEach((card, index) => {
        for (const [key, noun] of [["front", "front"], ["back", "back"], ["hint", "hint"]] as const) {
          const text = clean(textOf(card[key], 0, true));
          if (text) out.push({ label: `Card ${index + 1} ${noun}`, text });
        }
      });
      break;
    case "quiz":
      numbered(records(content.questions), "Question");
      break;
    case "presentation":
      numbered(records(content.slides), "Slide");
      break;
    case "sheets":
      sheetParts(content, out);
      break;
    case "whiteboard":
      for (const node of records(content.nodes)) {
        const text = clean(textOf(node));
        if (text) out.push({ text });
      }
      break;
    case "planner_task": {
      for (const key of ["status", "priority", "dueDate", "notes", "description"]) {
        const text = clean(textOf(content[key]));
        if (text) out.push({ label: key === "dueDate" ? "Due" : key[0]!.toUpperCase() + key.slice(1), text });
      }
      numbered(records(content.subtasks), "Step");
      break;
    }
    case "timetable":
      for (const event of records(content.events)) {
        const text = clean(textOf(event));
        if (text) out.push({ text });
      }
      break;
    case "code":
      for (const file of records(content.files)) {
        const path = String(file.path ?? "File");
        String(file.source ?? "")
          .split("\n")
          .slice(0, 2000)
          .forEach((line, index) => {
            if (line.trim()) out.push({ label: `${path}, line ${index + 1}`, text: line });
          });
      }
      break;
    default: {
      const text = clean(textOf(content));
      if (text) out.push({ text });
    }
  }
  return out;
}

const MAX_LCS = 1600;

/** Page order, with what stayed folded, and a removal next to an addition read as one change. */
export function versionPartChanges(before: readonly ReadablePart[], after: readonly ReadablePart[]): VersionPartChange[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start]!.text === after[start]!.text) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1]!.text === after[endAfter - 1]!.text) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const middleBefore = before.slice(start, endBefore);
  const middleAfter = after.slice(start, endAfter);
  const ops: { kind: "same" | "added" | "removed"; part: ReadablePart }[] = [];
  for (const part of after.slice(0, start)) ops.push({ kind: "same", part });
  if (middleBefore.length * middleAfter.length > MAX_LCS * MAX_LCS || middleBefore.length > MAX_LCS || middleAfter.length > MAX_LCS) {
    for (const part of middleBefore) ops.push({ kind: "removed", part });
    for (const part of middleAfter) ops.push({ kind: "added", part });
  } else {
    const rows = middleBefore.length;
    const columns = middleAfter.length;
    const table = Array.from({ length: rows + 1 }, () => new Uint16Array(columns + 1));
    for (let row = rows - 1; row >= 0; row -= 1)
      for (let column = columns - 1; column >= 0; column -= 1)
        table[row]![column] =
          middleBefore[row]!.text === middleAfter[column]!.text
            ? table[row + 1]![column + 1]! + 1
            : Math.max(table[row + 1]![column]!, table[row]![column + 1]!);
    let row = 0;
    let column = 0;
    while (row < rows || column < columns) {
      if (row < rows && column < columns && middleBefore[row]!.text === middleAfter[column]!.text) {
        ops.push({ kind: "same", part: middleAfter[column]! });
        row += 1;
        column += 1;
      } else if (column >= columns || (row < rows && table[row + 1]![column]! >= table[row]![column + 1]!)) {
        ops.push({ kind: "removed", part: middleBefore[row]! });
        row += 1;
      } else {
        ops.push({ kind: "added", part: middleAfter[column]! });
        column += 1;
      }
    }
  }
  for (const part of after.slice(endAfter)) ops.push({ kind: "same", part });

  const changes: VersionPartChange[] = [];
  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index]!;
    if (op.kind === "same") {
      const last = changes.at(-1);
      if (last?.kind === "same") last.count += 1;
      else changes.push({ kind: "same", count: 1, first: op.part.text });
      continue;
    }
    if (op.kind === "removed") {
      const next = ops[index + 1];
      if (next?.kind === "added") {
        changes.push({ kind: "changed", label: next.part.label ?? op.part.label, before: op.part.text, after: next.part.text });
        index += 1;
      } else changes.push({ kind: "removed", label: op.part.label, before: op.part.text });
      continue;
    }
    changes.push({ kind: "added", label: op.part.label, after: op.part.text });
  }
  return changes;
}

/** How many edits there are, for a line in the timeline. */
export function changeCount(changes: readonly VersionPartChange[]) {
  return changes.filter((change) => change.kind !== "same").length;
}
