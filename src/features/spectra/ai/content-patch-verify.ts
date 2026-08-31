/**
 * Shared contentPatch verify matching. Exact JSON equality is preferred;
 * soft matches cover normalize-added defaults on list appends (`/-`) and
 * sheets cell / cells-map column appends without accepting unrelated no-ops.
 */

import {
  isSheetsCellPath,
  isSheetsCellsMapPath,
} from "./sheets-content-patch";
import { sharedTimetableContent } from "../timetable/model";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringishMatch(authored: string, saved: string) {
  const normalize = (value: string) =>
    value
      .trim()
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      .replace(/[\u2018\u2019\u2032]/g, "'")
      .replace(/[\u201C\u201D\u2033]/g, '"')
      .replace(/\s+/g, " ");
  const a = normalize(authored);
  const s = normalize(saved);
  const authoredDate = Date.parse(a);
  const savedDate = Date.parse(s);
  if (
    Number.isFinite(authoredDate) &&
    Number.isFinite(savedDate) &&
    authoredDate === savedDate
  )
    return true;
  // Saved may contain concurrent inserts around the authored span. Authored
  // containing saved is the stale-projection / phantom-success case: the
  // unique write never landed.
  return s === a || s.includes(a);
}

/** Authored object fields must appear on saved (normalize may add ids/defaults). */
export function authoredObjectFieldsMatch(
  authored: Record<string, unknown>,
  saved: Record<string, unknown>,
): boolean {
  const authoredKeys = Object.keys(authored).filter(
    (key) => authored[key] !== undefined && authored[key] !== null,
  );
  if (authoredKeys.length === 0) return false;
  return authoredKeys.every((key) => {
    if (!(key in saved)) return false;
    if (typeof authored[key] === "string" && typeof saved[key] === "string")
      return stringishMatch(String(authored[key]), String(saved[key]));
    if (isPlainObject(authored[key]) && isPlainObject(saved[key]))
      return authoredObjectFieldsMatch(authored[key], saved[key]);
    return JSON.stringify(saved[key]) === JSON.stringify(authored[key]);
  });
}

function sheetCellMatches(authored: unknown, saved: unknown): boolean {
  if (JSON.stringify(saved) === JSON.stringify(authored)) return true;
  if (!isPlainObject(saved)) return false;

  // Scalar authored value vs normalized `{ value }` / `{ formula }`.
  if (authored === null || typeof authored === "number" || typeof authored === "boolean")
    return saved.value === authored;
  if (typeof authored === "string") {
    const trimmed = authored.trim();
    if (trimmed.startsWith("="))
      return (
        typeof saved.formula === "string" &&
        stringishMatch(trimmed, saved.formula)
      );
    return (
      typeof saved.value === "string" &&
      stringishMatch(trimmed, String(saved.value))
    );
  }
  if (!isPlainObject(authored)) return false;
  return authoredObjectFieldsMatch(authored, saved);
}

function sheetCellsMapMatches(authored: unknown, saved: unknown): boolean {
  if (!isPlainObject(authored) || !isPlainObject(saved)) return false;
  const keys = Object.keys(authored);
  if (keys.length === 0) return false;
  return keys.every((address) => {
    const key = /^[A-Za-z]+[1-9][0-9]*$/.test(address)
      ? address.toUpperCase()
      : address;
    return sheetCellMatches(authored[address], saved[key] ?? saved[address]);
  });
}

function documentAuthoredTextLanded(
  authored: string,
  artifactContent: unknown,
): boolean {
  if (!artifactContent || typeof artifactContent !== "object") return false;
  const blocks = Array.isArray(
    (artifactContent as { blocks?: unknown }).blocks,
  )
    ? ((artifactContent as { blocks: Array<{ text?: unknown }> }).blocks)
    : [];
  if (
    blocks.some(
      (block) =>
        typeof block?.text === "string" && stringishMatch(authored, block.text),
    )
  )
    return true;

  const normalize = (value: string) =>
    value
      .trim()
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      .replace(/[\u2018\u2019\u2032]/g, "'")
      .replace(/[\u201C\u201D\u2033]/g, '"')
      .replace(/\s+/g, " ");
  const authoredNorm = normalize(authored);
  if (!authoredNorm) return false;
  const body = blocks
    .map((block) =>
      typeof block?.text === "string" ? normalize(block.text) : "",
    )
    .filter(Boolean)
    .join("\n");
  if (!body) return false;
  if (body.includes(authoredNorm)) return true;
  // Concurrent human/AI inserts can sit inside the authored span. Every
  // distinctive authored token must still be present — a 70% hit rate let a
  // second same-region AI report Updated while its unique token never landed.
  const tokens = authoredNorm
    .split(/[^A-Za-z0-9_-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 10);
  if (tokens.length === 0) return false;
  return tokens.every((token) => body.includes(token));
}

/** True when authored text (or block.text) is observably present in content. */
export function authoredValueLandedInContent(
  authored: unknown,
  content: unknown,
): boolean {
  if (typeof authored === "string") {
    if (documentAuthoredTextLanded(authored, content)) return true;
    try {
      const blob = JSON.stringify(content ?? "");
      const normalize = (value: string) =>
        value.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s+/g, " ");
      return normalize(blob).includes(normalize(authored.trim()));
    } catch {
      return false;
    }
  }
  if (
    authored &&
    typeof authored === "object" &&
    !Array.isArray(authored) &&
    typeof (authored as { text?: unknown }).text === "string"
  )
    return authoredValueLandedInContent(
      (authored as { text: string }).text,
      content,
    );
  return false;
}

/**
 * Returns true when the saved artifact content reflects the authored patch
 * change. Soft matches are intentional for append/normalize cases only.
 */
export function contentPatchChangeMatchesSaved(
  path: string,
  authoredValue: unknown,
  savedValue: unknown,
  context?: {
    blueprintKey?: string;
    artifactContent?: unknown;
  },
): boolean {
  if (JSON.stringify(savedValue) === JSON.stringify(authoredValue)) return true;

  // Document (and other) scalar text writes often diverge slightly after Yjs
  // normalize / concurrent peer merges. Prefer containment over brittle
  // exact equality so a successful apply is not marked Failed.
  if (typeof authoredValue === "string" && typeof savedValue === "string") {
    if (stringishMatch(authoredValue, savedValue)) return true;
    // Planner status aliases: models often write in_progress; stored canonical
    // value is doing. Treat them as the same outcome so verify does not Fail a
    // successful apply.
    if (
      context?.blueprintKey === "planner_task" &&
      /(?:^|\/)status$/i.test(path)
    ) {
      const aliases: Record<string, string> = {
        pending: "todo",
        not_started: "todo",
        open: "todo",
        in_progress: "doing",
        "in progress": "doing",
        active: "doing",
        complete: "done",
        completed: "done",
        finished: "done",
      };
      const normalizeStatus = (value: string) => {
        const key = value.trim().toLowerCase().replace(/[\s.-]+/g, "_");
        return aliases[key] ?? aliases[value.trim().toLowerCase()] ?? key;
      };
      if (normalizeStatus(authoredValue) === normalizeStatus(savedValue))
        return true;
    }
  }

  // When a block index drifted under concurrent human edits, still accept the
  // change if the authored text is present somewhere in the document body.
  if (
    context?.blueprintKey === "document" &&
    typeof authoredValue === "string" &&
    /^\/(?:content\/)?blocks\/(?:id:[^/]+|\d+)(?:\/text)?$/i.test(path) &&
    documentAuthoredTextLanded(authoredValue, context.artifactContent)
  )
    return true;

  // Whole-block object writes (type + text) after concurrent remaps.
  if (
    context?.blueprintKey === "document" &&
    isPlainObject(authoredValue) &&
    typeof authoredValue.text === "string" &&
    /^\/(?:content\/)?blocks\/(?:id:[^/]+|\d+)$/i.test(path)
  ) {
    if (
      isPlainObject(savedValue) &&
      typeof savedValue.text === "string" &&
      stringishMatch(authoredValue.text, savedValue.text)
    )
      return true;
    if (documentAuthoredTextLanded(authoredValue.text, context.artifactContent))
      return true;
  }

  // Timetable normalization canonicalizes ISO dates and redirects an unknown
  // layer id onto the first available shared layer. Verify the normalized
  // authored event rather than falsely failing after the event is already
  // durably visible.
  if (
    context?.blueprintKey === "timetable" &&
    /^\/(?:content\/)?events\/(?:-|\d+)$/.test(path) &&
    isPlainObject(authoredValue) &&
    isPlainObject(savedValue)
  ) {
    const artifact =
      context.artifactContent &&
      typeof context.artifactContent === "object" &&
      !Array.isArray(context.artifactContent)
        ? (context.artifactContent as Record<string, unknown>)
        : {};
    const normalized = sharedTimetableContent({
      ...artifact,
      events: [authoredValue],
    }).events[0];
    if (normalized && authoredObjectFieldsMatch(normalized, savedValue))
      return true;
  }

  // Append pointers (`/cards/-`, `/questions/-`, `/sheets/-`) and first-item
  // writes (`/events/0`, `/slides/0`) land after normalize, so saved objects
  // often gain ids/defaults. A field-subset match still rejects unrelated
  // no-ops while accepting the canonical saved representation.
  if (
    /\/(?:-|\d+)$/.test(path) &&
    isPlainObject(savedValue) &&
    isPlainObject(authoredValue)
  )
    return authoredObjectFieldsMatch(authoredValue, savedValue);

  if (isSheetsCellPath(path)) return sheetCellMatches(authoredValue, savedValue);

  // `/sheets/N/cells` merges on apply; verify that every authored address landed.
  if (isSheetsCellsMapPath(path))
    return sheetCellsMapMatches(authoredValue, savedValue);

  return false;
}
