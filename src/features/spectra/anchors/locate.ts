/*
 * Reading a place inside a work. A search result, a citation or Spectra names
 * a region: the semantic layer's region id (a block, slide, sheet range, board
 * node, card, question, event or file id, see shared/semantic-chunks.ts), its
 * label ("Slide 3: Results", "Sheet1 A1:F40", "Heading: Methods") and the
 * passage it matched. A citation's WHERE may be looser ("slide-3", "A1:C9", a
 * heading). These helpers read all of them; each studio decides what they
 * point at in its own content.
 */
import type { SemanticResult } from "../semantic/types";

/** A place inside a work: the region id, and what the semantic layer knew about it. */
export type WorkRegion = {
  /** The region id the semantic layer stored, or a looser locator ("slide-3", "A1:C9", a heading). */
  id: string;
  /** Where it is, for people: "Slide 3: Results", "Sheet1 A1:F40", "Heading: Methods". */
  label?: string;
  /** The passage that matched, so a long region (a code file) can land on its line. */
  excerpt?: string;
};

/** A region from untrusted input (a bus payload, command params): id required, sizes bounded. */
export function workRegionFrom(value: unknown): WorkRegion | undefined {
  if (typeof value === "string") {
    const id = value.trim().slice(0, 400);
    return id ? { id } : undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim().slice(0, 400) : "";
  if (!id) return undefined;
  const label = typeof record.label === "string" ? record.label.trim().slice(0, 240) : "";
  const excerpt = typeof record.excerpt === "string" ? record.excerpt.trim().slice(0, 600) : "";
  return { id, ...(label ? { label } : {}), ...(excerpt ? { excerpt } : {}) };
}

/**
 * The place a semantic result points at inside its work: the region the
 * semantic layer stored, its label, and the passage that matched. Results
 * without a region (a title match, a thread, an event) have none.
 */
export function regionOfResult(result: Pick<SemanticResult, "anchor"> & { location?: string; snippet?: string }): WorkRegion | undefined {
  if (result.anchor.kind !== "artifact" || !result.anchor.regionId) return undefined;
  return workRegionFrom({ id: result.anchor.regionId, label: result.location ?? result.anchor.label, excerpt: result.snippet });
}

/** The texts a region can be read from, most precise first. */
export function regionTexts(region: WorkRegion): string[] {
  return [region.id, region.label].filter((text): text is string => Boolean(text?.trim())).map((text) => text.trim());
}

/** Lower case, no accents, single spaces, no trailing ellipsis: for loose comparisons. */
export function foldText(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[…]+$|\.{3}$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The 0-based position a locator names: "slide-3", "Slide 3: Results",
 * "card 2", "question_4" → 2, 1, 3. `nouns` are the words it may start with.
 */
export function ordinalIn(text: string | undefined, nouns: readonly string[]): number | null {
  if (!text) return null;
  const match = new RegExp(`^(?:${nouns.join("|")})[\\s_#-]*(\\d{1,5})\\b`, "i").exec(text.trim());
  if (!match) return null;
  const position = Number(match[1]) - 1;
  return position >= 0 ? position : null;
}

export type CellPoint = { row: number; column: number };
export type CellRangeLocator = { sheet?: string; start: CellPoint; end: CellPoint };

function columnIndex(letters: string) {
  return letters.toUpperCase().split("").reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0) - 1;
}

/**
 * A cell or range in a locator: "B4", "A1:C9", "Sheet1!A1:C9", "'My sheet'!B2",
 * or a semantic label, "Sheet1 A1:F40". Rows and columns are 0-based.
 */
export function cellRangeIn(text: string | undefined): CellRangeLocator | null {
  if (!text) return null;
  const match = /^(?:(.+?)(?:!|\s+))?\$?([A-Z]{1,3})\$?([1-9]\d{0,6})(?::\$?([A-Z]{1,3})\$?([1-9]\d{0,6}))?$/i.exec(text.trim());
  if (!match) return null;
  const start = { row: Number(match[3]) - 1, column: columnIndex(match[2]!) };
  const end = match[4] && match[5] ? { row: Number(match[5]) - 1, column: columnIndex(match[4]) } : start;
  const sheet = match[1]?.trim().replace(/^'(.*)'$/, "$1");
  return {
    ...(sheet ? { sheet } : {}),
    start: { row: Math.min(start.row, end.row), column: Math.min(start.column, end.column) },
    end: { row: Math.max(start.row, end.row), column: Math.max(start.column, end.column) },
  };
}

/** The heading a locator names: "Heading: Methods" → "methods" (folded). Plain text is read as a heading too. */
export function headingIn(text: string | undefined): string | null {
  if (!text) return null;
  const folded = foldText(text.replace(/^heading\s*:\s*/i, ""));
  return folded.length >= 2 ? folded : null;
}

/**
 * The 1-based line of `source` where `excerpt` starts, or null. The semantic
 * layer stores passages with whitespace collapsed and trims them to a window
 * that may start mid-sentence, so runs of whitespace compare as one space and
 * a shorter run of the passage's words is tried when the whole is not found.
 */
export function lineOfExcerpt(source: string, excerpt: string | undefined): number | null {
  const needle = excerpt?.replace(/^[…\s]+|[…\s]+$/gu, "").replace(/\s+/g, " ").trim();
  if (!source || !needle) return null;
  let collapsed = "";
  const lines: number[] = [];
  let line = 1;
  let space = false;
  for (const character of source) {
    if (/\s/.test(character)) {
      if (!space && collapsed) {
        collapsed += " ";
        lines.push(line);
      }
      space = true;
      if (character === "\n") line += 1;
      continue;
    }
    space = false;
    collapsed += character;
    lines.push(line);
  }
  const lowered = collapsed.toLowerCase();
  const words = needle.split(" ");
  const find = (candidate: string) => {
    if (candidate.length < 6) return -1;
    const exact = collapsed.indexOf(candidate);
    return exact >= 0 ? exact : lowered.indexOf(candidate.toLowerCase());
  };
  for (let start = 0; start < Math.min(words.length, 8); start += 1)
    for (const length of [words.length - start, 10, 6, 4]) {
      if (length <= 0 || length > words.length - start) continue;
      const at = find(words.slice(start, start + length).join(" "));
      if (at >= 0) return lines[at] ?? null;
    }
  return null;
}

/**
 * The item a region names among `items`: the one whose id is the region id,
 * else the one at the position the id or label gives ("slide-3", "Card 2").
 */
export function itemForRegion<T extends { id: string }>(items: readonly T[], region: WorkRegion, nouns: readonly string[]): T | undefined {
  const exact = items.find((item) => item.id === region.id);
  if (exact) return exact;
  for (const text of regionTexts(region)) {
    const position = ordinalIn(text, nouns);
    if (position !== null && items[position]) return items[position];
  }
  return undefined;
}

/** The words a positional locator may start with, per kind of item. */
export const SLIDE_NOUNS = ["slide", "page"] as const;
export const CARD_NOUNS = ["card", "flashcard"] as const;
export const QUESTION_NOUNS = ["question", "q"] as const;
export const FILE_NOUNS = ["file"] as const;
export const SHEET_NOUNS = ["sheet", "tab"] as const;

/**
 * Runs of a passage's words to look for, longest and earliest first. The
 * semantic layer packs neighbouring units (blocks, cards, questions) into one
 * passage and trims it to a window, so the whole rarely appears in one unit;
 * a shorter run of its words finds where it starts.
 */
export function excerptRuns(excerpt: string | undefined): string[] {
  const needle = excerpt ? foldText(excerpt.replace(/^[…\s]+|[…\s]+$/gu, "")) : "";
  if (!needle) return [];
  const words = needle.split(" ");
  const runs: string[] = [];
  for (let start = 0; start < Math.min(words.length, 8); start += 1)
    for (const length of [words.length - start, 10, 6, 4]) {
      if (length <= 0 || length > words.length - start) continue;
      const run = words.slice(start, start + length).join(" ");
      if (run.length >= 8 && !runs.includes(run)) runs.push(run);
    }
  return runs;
}

/** The item whose text holds the longest, earliest run of the passage's words. */
export function bestByExcerpt<T>(items: readonly T[], textOf: (item: T) => string, excerpt: string | undefined): T | undefined {
  const runs = excerptRuns(excerpt);
  if (!runs.length || !items.length) return undefined;
  const texts = items.map((item) => foldText(textOf(item)));
  for (const run of runs) {
    const index = texts.findIndex((text) => text.includes(run));
    if (index >= 0) return items[index];
  }
  return undefined;
}

/**
 * The item a packed passage is about: the region names the first item of the
 * passage, and its excerpt may sit a few items later. Looks from the region's
 * item forward, then falls back to the region's item.
 */
export function itemInPassage<T>(items: readonly T[], start: number, textOf: (item: T) => string, excerpt: string | undefined, span = 40): T | undefined {
  if (start < 0 || start >= items.length) return undefined;
  return bestByExcerpt(items.slice(start, start + span), textOf, excerpt) ?? items[start];
}

/** Text of stored rich text (HTML or plain), for comparing with a passage. */
export function plainOfMarkup(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
