import { canonicalSemanticValue, semanticallyEqual } from "../../../../shared/canonical-json";
import { hasRichSemantics, semanticRichText } from "./docx-lens";
import type { DocxProjectionBlock, DocxRichInline } from "./projection-contracts";

/*
 * When Word and Spectra both change the same paragraph, the edits usually
 * touch different words: a student fixes a typo in Word while the teacher's
 * comment lands two sentences later in Spectra. Treating the paragraph as one
 * unit made that a conflict. This merges inside it: the paragraph becomes a
 * sequence of tokens (words, spaces and punctuation that carry their run
 * format and link; equations, images, notes, citations and comment marks are
 * one token each) and a three-way merge keeps both sides' changes when they
 * touch different tokens. Two changes to the same words stay a conflict, as do
 * conflicting changes to the paragraph's style or a table cell changed on both
 * sides — a merge here never guesses.
 */

type Token = { item: DocxRichInline; key: string };

/** Above this many token comparisons a paragraph is left to the conflict view. */
const MAX_DIFF_CELLS = 4_000_000;

const WORD = /\s+|[\p{L}\p{M}\p{N}_'’-]+|[^\s\p{L}\p{M}\p{N}_'’-]/gu;

function tokenize(content: readonly DocxRichInline[]): Token[] {
  const tokens: Token[] = [];
  for (const item of content) {
    if (item.kind !== "text") {
      tokens.push({ item, key: JSON.stringify(canonicalSemanticValue(item)) });
      continue;
    }
    const { text: _text, ...run } = item;
    for (const piece of item.text.match(WORD) ?? []) {
      const token = { ...run, kind: "text" as const, text: piece };
      tokens.push({ item: token, key: JSON.stringify(canonicalSemanticValue(token)) });
    }
  }
  return tokens;
}

/** Joins neighbouring words that share format and link back into runs. */
function untokenize(tokens: readonly Token[]): DocxRichInline[] {
  const out: DocxRichInline[] = [];
  for (const { item } of tokens) {
    const last = out.at(-1);
    if (
      item.kind === "text" && last?.kind === "text" &&
      semanticallyEqual(last.format, item.format) && semanticallyEqual(last.href, item.href)
    ) {
      out[out.length - 1] = { ...last, text: last.text + item.text };
      continue;
    }
    out.push(item);
  }
  return out;
}

/** Longest common subsequence as base index → other index, or null when too large. */
function matchIndices(base: readonly string[], other: readonly string[]): Map<number, number> | null {
  const matches = new Map<number, number>();
  let start = 0;
  while (start < base.length && start < other.length && base[start] === other[start]) {
    matches.set(start, start);
    start += 1;
  }
  let baseEnd = base.length;
  let otherEnd = other.length;
  while (baseEnd > start && otherEnd > start && base[baseEnd - 1] === other[otherEnd - 1]) {
    baseEnd -= 1;
    otherEnd -= 1;
  }
  const rows = baseEnd - start;
  const columns = otherEnd - start;
  if (rows * columns > MAX_DIFF_CELLS) return null;
  if (rows && columns) {
    // lengths[i][j] = LCS of base[start+i..] and other[start+j..]
    const width = columns + 1;
    const lengths = new Uint32Array((rows + 1) * width);
    for (let i = rows - 1; i >= 0; i -= 1)
      for (let j = columns - 1; j >= 0; j -= 1)
        lengths[i * width + j] = base[start + i] === other[start + j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    let i = 0;
    let j = 0;
    while (i < rows && j < columns) {
      if (base[start + i] === other[start + j]) {
        matches.set(start + i, start + j);
        i += 1;
        j += 1;
      } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) i += 1;
      else j += 1;
    }
  }
  for (let offset = 0; baseEnd + offset < base.length; offset += 1) matches.set(baseEnd + offset, otherEnd + offset);
  return matches;
}

const sameKeys = (left: readonly Token[], right: readonly Token[]) =>
  left.length === right.length && left.every((token, index) => token.key === right[index].key);

/** diff3 over token sequences; undefined when both sides changed the same stretch differently. */
export function mergeTokenSequences(base: readonly Token[], ours: readonly Token[], theirs: readonly Token[]): Token[] | undefined {
  const baseKeys = base.map((token) => token.key);
  const toOurs = matchIndices(baseKeys, ours.map((token) => token.key));
  const toTheirs = matchIndices(baseKeys, theirs.map((token) => token.key));
  if (!toOurs || !toTheirs) return undefined;
  const merged: Token[] = [];
  let i = 0;
  let j = 0;
  let k = 0;
  const settle = (baseEnd: number, oursEnd: number, theirsEnd: number) => {
    const baseChunk = base.slice(i, baseEnd);
    const oursChunk = ours.slice(j, oursEnd);
    const theirsChunk = theirs.slice(k, theirsEnd);
    if (sameKeys(oursChunk, baseChunk)) merged.push(...theirsChunk);
    else if (sameKeys(theirsChunk, baseChunk) || sameKeys(oursChunk, theirsChunk)) merged.push(...oursChunk);
    else return false;
    return true;
  };
  for (let index = 0; index < base.length; index += 1) {
    const oursIndex = toOurs.get(index);
    const theirsIndex = toTheirs.get(index);
    if (oursIndex === undefined || theirsIndex === undefined || oursIndex < j || theirsIndex < k) continue;
    if (!settle(index, oursIndex, theirsIndex)) return undefined;
    merged.push(theirs[theirsIndex]);
    i = index + 1;
    j = oursIndex + 1;
    k = theirsIndex + 1;
  }
  if (!settle(base.length, ours.length, theirs.length)) return undefined;
  return merged;
}

const NO_CHANGE = Symbol("no-change");

/** Three-way pick for one value: the side that changed it wins; both changing it differently fails. */
function pick<T>(base: T, ours: T, theirs: T): T | typeof NO_CHANGE {
  if (semanticallyEqual(ours, base)) return theirs;
  if (semanticallyEqual(theirs, base) || semanticallyEqual(ours, theirs)) return ours;
  return NO_CHANGE;
}

function mergeRecord(
  base: Record<string, unknown> | undefined,
  ours: Record<string, unknown> | undefined,
  theirs: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined | typeof NO_CHANGE {
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(ours ?? {}), ...Object.keys(theirs ?? {})]);
  const merged: Record<string, unknown> = {};
  for (const key of keys) {
    const value = pick(base?.[key], ours?.[key], theirs?.[key]);
    if (value === NO_CHANGE) return NO_CHANGE;
    if (value !== undefined) merged[key] = value;
  }
  return Object.keys(merged).length || ours || theirs ? merged : undefined;
}

const plainText = (content: readonly DocxRichInline[]) =>
  hasRichSemantics(content) ? semanticRichText(content) : content.map((item) => (item.kind === "text" ? item.text : "")).join("");

/** A block's runs, or null when its text was edited without its runs (then the runs cannot be trusted). */
function inlineOf(block: DocxProjectionBlock): readonly DocxRichInline[] | null {
  if (!block.inlineContent) return block.text ? [{ kind: "text", text: block.text }] : [];
  return plainText(block.inlineContent).replace(/ +$/u, "") === block.text.replace(/ +$/u, "") ? block.inlineContent : null;
}

function mergeInline(base: DocxProjectionBlock, ours: DocxProjectionBlock, theirs: DocxProjectionBlock) {
  const sides = [inlineOf(base), inlineOf(ours), inlineOf(theirs)];
  if (sides.some((side) => side === null)) return undefined;
  const [baseTokens, oursTokens, theirsTokens] = sides.map((side) => tokenize(side!));
  const merged = mergeTokenSequences(baseTokens, oursTokens, theirsTokens);
  return merged && untokenize(merged);
}

type Cell = { text: string; rich?: DocxRichInline[] };
const cellOf = (block: DocxProjectionBlock, row: number, column: number): Cell =>
  ({ text: block.rows?.[row]?.[column] ?? "", rich: block.richRows?.[row]?.[column] });

function sameShape(blocks: readonly DocxProjectionBlock[]) {
  const shape = (block: DocxProjectionBlock) => JSON.stringify((block.rows ?? []).map((row) => row.length));
  const richShape = (block: DocxProjectionBlock) =>
    !block.richRows || JSON.stringify(block.richRows.map((row) => row.length)) === shape(block);
  return blocks.every((block) => richShape(block) && shape(block) === shape(blocks[0]));
}

function mergeTable(base: DocxProjectionBlock, ours: DocxProjectionBlock, theirs: DocxProjectionBlock) {
  if (!sameShape([base, ours, theirs])) return undefined;
  const rows: string[][] = [];
  const richRows: DocxRichInline[][][] = [];
  for (const [rowIndex, row] of (base.rows ?? []).entries()) {
    rows.push([]);
    richRows.push([]);
    for (const columnIndex of row.keys()) {
      const cell = pick(cellOf(base, rowIndex, columnIndex), cellOf(ours, rowIndex, columnIndex), cellOf(theirs, rowIndex, columnIndex));
      if (cell === NO_CHANGE) return undefined;
      rows[rowIndex].push(cell.text);
      richRows[rowIndex].push(cell.rich ?? [{ kind: "text", text: cell.text }]);
    }
  }
  return {
    text: rows.map((row) => row.join(" | ")).join("\n"),
    rows,
    ...(richRows.some((row) => row.some(hasRichSemantics)) ? { richRows } : {}),
  };
}

/**
 * Merges one block both sides changed. Returns undefined when the changes
 * overlap, which the caller reports as a conflict.
 */
export function mergeDocxBlock(
  base: DocxProjectionBlock | undefined,
  ours: DocxProjectionBlock | undefined,
  theirs: DocxProjectionBlock | undefined,
): DocxProjectionBlock | undefined {
  // Deleting a block the other side edited is a decision for a person.
  if (!base || !ours || !theirs) return undefined;
  const type = pick(base.type, ours.type, theirs.type);
  const attrs = mergeRecord(base.attrs, ours.attrs, theirs.attrs);
  if (type === NO_CHANGE || attrs === NO_CHANGE) return undefined;
  if ([base, ours, theirs].some((block) => block.attrs?.nativeReadOnly)) return undefined;
  const shell = { id: ours.id, type, ...(attrs ? { attrs } : {}) };
  if ([base.type, ours.type, theirs.type].includes("table")) {
    if (type !== "table") return undefined;
    const table = mergeTable(base, ours, theirs);
    return table && { ...shell, ...table };
  }
  const latex = pick(base.latex, ours.latex, theirs.latex);
  if (latex === NO_CHANGE) return undefined;
  const inline = mergeInline(base, ours, theirs);
  if (!inline) return undefined;
  const rich = hasRichSemantics(inline);
  return {
    ...shell,
    text: plainText(inline),
    ...(latex !== undefined ? { latex } : {}),
    ...(rich ? { inlineContent: inline } : {}),
  };
}
