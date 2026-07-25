/**
 * Document contentPatch helpers: resolve id/heading-stable paths and remap
 * fragile absolute block indices for section-scoped rewrites so earlier
 * headings (e.g. 1.3) cannot be silently overwritten when rewriting section 2.
 * Also applies sheets cell-path canonicalization and cells-map merges.
 */

import {
  canonicalizeSheetsPatchChange,
  isSheetsCellsMapPath,
  mergeSheetCellsMaps,
} from "./sheets-content-patch";
import { canonicalizeWhiteboardPatchChange } from "./whiteboard-content-patch";

export type ContentPatchChange = { path: string; value: unknown };

type DocumentBlock = Record<string, unknown>;

function asBlocks(content: unknown): DocumentBlock[] {
  if (!content || typeof content !== "object" || Array.isArray(content))
    return [];
  const blocks = (content as Record<string, unknown>).blocks;
  return Array.isArray(blocks)
    ? blocks.filter(
        (block): block is DocumentBlock =>
          Boolean(block) && typeof block === "object" && !Array.isArray(block),
      )
    : [];
}

function blockText(block: DocumentBlock | undefined) {
  return typeof block?.text === "string" ? block.text : "";
}

function isHeading(block: DocumentBlock | undefined) {
  return (
    typeof block?.type === "string" && block.type.toLowerCase().startsWith("heading")
  );
}

function headingLevel(block: DocumentBlock | undefined) {
  const attrs =
    block?.attrs && typeof block.attrs === "object" && !Array.isArray(block.attrs)
      ? (block.attrs as Record<string, unknown>)
      : {};
  const level = Number(attrs.level);
  return Number.isInteger(level) && level >= 1 && level <= 3 ? level : 2;
}

/** Match "2. Title", "2) Title", "2: Title", "Section 2 …". */
export function matchesSectionHeading(
  text: string,
  sectionNumber: number,
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const n = String(sectionNumber);
  return (
    new RegExp(`^${n}(?:[.\\:)]|\\s+)\\s*\\S`).test(trimmed) ||
    new RegExp(`^section\\s+${n}\\b`, "i").test(trimmed)
  );
}

export type DocumentSectionRange = {
  headingIndex: number;
  bodyStart: number;
  bodyEnd: number;
  headingId: string | null;
};

export function findDocumentSectionRange(
  content: unknown,
  sectionNumber: number,
): DocumentSectionRange | null {
  const blocks = asBlocks(content);
  const headingIndex = blocks.findIndex(
    (block) =>
      isHeading(block) && matchesSectionHeading(blockText(block), sectionNumber),
  );
  if (headingIndex < 0) return null;
  const level = headingLevel(blocks[headingIndex]);
  let bodyEnd = blocks.length;
  for (let index = headingIndex + 1; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (!isHeading(block)) continue;
    if (headingLevel(block) <= level) {
      bodyEnd = index;
      break;
    }
  }
  const heading = blocks[headingIndex]!;
  return {
    headingIndex,
    bodyStart: headingIndex + 1,
    bodyEnd,
    headingId:
      typeof heading.id === "string" && heading.id.trim() ? heading.id : null,
  };
}

/**
 * Resolve `/blocks/<n>/…`, `/blocks/id:<id>/…`, or `/blocks/byId/<id>/…`
 * (plus optional `/content` prefix) into a canonical numeric path.
 */
export function resolveDocumentPatchPath(
  content: unknown,
  path: string,
): string {
  const match = path.match(
    /^(\/(?:content\/)?)blocks\/(?:id:|byId\/)?([^/]+)(.*)$/i,
  );
  if (!match) return path;
  const [, prefix = "/", selector = "", rest = ""] = match;
  const blocks = asBlocks(content);
  let index = -1;
  if (/^\d+$/.test(selector)) {
    index = Number(selector);
  } else {
    const decoded = selector.replaceAll("~1", "/").replaceAll("~0", "~");
    index = blocks.findIndex(
      (block) => typeof block.id === "string" && block.id === decoded,
    );
  }
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= blocks.length
  )
    throw new Error(`Content patch index is out of range: ${path}`);
  return `${prefix}blocks/${index}${rest}`;
}

function parseBlockIndex(path: string): number | null {
  const match = path.match(/^\/(?:content\/)?blocks\/(\d+)(?:\/|$)/);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) ? index : null;
}

function extractPatchText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    if (typeof row.text === "string") return row.text;
    if (typeof row.content === "string") return row.content;
    if (typeof row.body === "string") return row.body;
  }
  return null;
}

function looksLikeHeadingTitle(text: string, sectionNumber: number) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 160) return false;
  if (trimmed.includes("\n")) return false;
  if (matchesSectionHeading(trimmed, sectionNumber)) return true;
  // Short title without nested sentence punctuation is treated as a rename.
  return trimmed.length <= 80 && !/[.!?]/.test(trimmed.slice(0, -1));
}

function requestedSectionNumber(prompt: string): number | null {
  const patterns = [
    /\b(?:rewrite|replace|edit|change|update|shorten|condense|tighten|revise)\b[^.!?]{0,100}\bsection\s+(\d+)\b/i,
    /\bsection\s+(\d+)\b[^.!?]{0,100}\b(?:more\s+)?(?:concise|shorter|brief|tighter|compact)\b/i,
    /\bmake\s+section\s+(\d+)\b[^.!?]{0,60}\b(?:more\s+)?(?:concise|shorter|brief)\b/i,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (!match) continue;
    const number = Number(match[1]);
    if (Number.isInteger(number) && number > 0) return number;
  }
  return null;
}

/**
 * When the user asks to rewrite section N, remap mis-aimed absolute block
 * pointers onto that section's body and never allow earlier headings to be
 * overwritten with body prose.
 */
export function remapDocumentSectionRewriteChanges(
  content: unknown,
  prompt: string,
  changes: ContentPatchChange[],
): ContentPatchChange[] {
  const sectionNumber = requestedSectionNumber(prompt);
  if (sectionNumber === null || changes.length === 0) return changes;
  const range = findDocumentSectionRange(content, sectionNumber);
  if (!range) return changes;

  const blocks = asBlocks(content);
  const bodyIndices: number[] = [];
  for (let index = range.bodyStart; index < range.bodyEnd; index += 1) {
    if (!isHeading(blocks[index])) bodyIndices.push(index);
  }
  if (bodyIndices.length === 0) return changes;

  const remapped: ContentPatchChange[] = [];
  let bodySlot = 0;

  for (const change of changes) {
    let path = change.path;
    try {
      path = resolveDocumentPatchPath(content, path);
    } catch {
      remapped.push(change);
      continue;
    }
    if (!/^\/(?:content\/)?blocks\//.test(path)) {
      remapped.push({ ...change, path });
      continue;
    }

    const index = parseBlockIndex(path);
    if (index === null) {
      remapped.push({ ...change, path });
      continue;
    }

    const inSection = index >= range.headingIndex && index < range.bodyEnd;
    const targetingHeading = isHeading(blocks[index]);
    const text = extractPatchText(change.value);

    // Preserve the section heading unless the model supplies a short title.
    if (index === range.headingIndex) {
      if (
        text !== null &&
        looksLikeHeadingTitle(text, sectionNumber) &&
        /\/text$/.test(path)
      ) {
        remapped.push({ path: `/blocks/${range.headingIndex}/text`, value: text });
      }
      continue;
    }

    // Outside the section, or onto a nested/peer heading: body-like values
    // belong on the section body, never on untouched headings like 1.3.
    if (!inSection || targetingHeading) {
      if (text === null || !text.trim()) continue;
      const target =
        bodyIndices[Math.min(bodySlot, bodyIndices.length - 1)] ??
        bodyIndices[0]!;
      remapped.push({ path: `/blocks/${target}/text`, value: text });
      bodySlot += 1;
      continue;
    }

    // Inside the section body — keep, but normalize whole-block string writes.
    if (/^\/(?:content\/)?blocks\/\d+$/.test(path) && typeof change.value === "string") {
      remapped.push({ path: `/blocks/${index}/text`, value: change.value });
      continue;
    }
    remapped.push({ ...change, path: path.replace(/^\/content/, "") });
  }

  if (remapped.length > 0) return remapped;

  // Every change targeted a heading (or empty values). Recover body prose onto
  // the section body so a rewrite still lands and earlier headings stay intact.
  const recovered = changes
    .map((change) => extractPatchText(change.value))
    .filter((text): text is string => Boolean(text?.trim()));
  if (recovered.length === 0) return changes;
  return recovered.map((text, index) => ({
    path: `/blocks/${bodyIndices[Math.min(index, bodyIndices.length - 1)]!}/text`,
    value: text,
  }));
}

export function applyResolvedContentPatch(
  content: unknown,
  patch: { changes: ContentPatchChange[] },
) {
  const next = structuredClone(content) as unknown;
  for (const rawChange of patch.changes) {
    // Sheets: uppercase A1 addresses and coerce scalar/formula cell writes so
    // column appends survive normalize + verify. Whiteboard: resolve id/title
    // node selectors and lift bare fill/stroke onto style.* before write.
    const sheetsCanonical = canonicalizeSheetsPatchChange(rawChange);
    const change = canonicalizeWhiteboardPatchChange(next, sheetsCanonical);
    const resolvedPath = resolveDocumentPatchPath(next, change.path);
    const segments = resolvedPath
      .slice(1)
      .split("/")
      .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
    let cursor: unknown = next;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index]!;
      if (
        !cursor ||
        typeof cursor !== "object" ||
        ["__proto__", "prototype", "constructor"].includes(segment)
      )
        throw new Error(`Invalid content patch path: ${change.path}`);
      const key: string | number = Array.isArray(cursor)
        ? Number(segment)
        : segment;
      if (
        Array.isArray(cursor) &&
        (!Number.isInteger(key) ||
          Number(key) < 0 ||
          Number(key) >= cursor.length)
      )
        throw new Error(`Content patch index is out of range: ${change.path}`);
      cursor = (cursor as Record<string | number, unknown>)[key];
    }
    const finalSegment = segments.at(-1)!;
    if (
      !cursor ||
      typeof cursor !== "object" ||
      ["__proto__", "prototype", "constructor"].includes(finalSegment)
    )
      throw new Error(`Invalid content patch path: ${change.path}`);
    // JSON Pointer "-" appends to the end of an array (RFC 6901). Models use
    // `/cards/-` and `/questions/-` when adding a new item after an existing list.
    if (Array.isArray(cursor) && finalSegment === "-") {
      cursor.push(structuredClone(change.value));
      continue;
    }
    const finalKey: string | number = Array.isArray(cursor)
      ? Number(finalSegment)
      : finalSegment;
    if (
      Array.isArray(cursor) &&
      (!Number.isInteger(finalKey) ||
        Number(finalKey) < 0 ||
        Number(finalKey) > cursor.length)
    )
      throw new Error(`Content patch index is out of range: ${change.path}`);
    if (Array.isArray(cursor) && Number(finalKey) === cursor.length) {
      cursor.push(structuredClone(change.value));
      continue;
    }
    // Partial `/sheets/N/cells` maps merge into the existing grid so a column
    // append cannot wipe unrelated addresses (same class of bug as deck `/-`).
    if (
      !Array.isArray(cursor) &&
      finalSegment === "cells" &&
      isSheetsCellsMapPath(resolvedPath.replace(/^\/content/, ""))
    ) {
      const existing = (cursor as Record<string, unknown>).cells;
      (cursor as Record<string, unknown>).cells = mergeSheetCellsMaps(
        existing,
        change.value,
      );
      continue;
    }
    (cursor as Record<string | number, unknown>)[finalKey] = structuredClone(
      change.value,
    );
  }
  if (
    next &&
    typeof next === "object" &&
    !Array.isArray(next) &&
    patch.changes.some((change) =>
      /^\/(?:content\/)?blocks(?:\/|$)/.test(change.path),
    )
  ) {
    delete (next as Record<string, unknown>).tiptap;
  }
  return next;
}
