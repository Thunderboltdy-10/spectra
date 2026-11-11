import { documentContentToProseMirrorJson } from "../../../../../../shared/document-projection.mjs";
import { record } from "./shared";

/*
 * How many sheets a document fills on the Pages view, from its block
 * structure alone. The numbers are the page view's own: the paper and margin
 * presets in spectra-document.css, and the prose scale in spectra-prose.css
 * (15px body at 1.65 leading, 0.75em between blocks, headings at 1.6, 1.3 and
 * 1.12em). It is an estimate the model can act on ("About 2 pages"), not a
 * layout: within a quarter page is enough to notice a one-pager ran over.
 */

type PmNode = { type?: string; attrs?: Record<string, unknown>; content?: PmNode[]; text?: string };

const PX_PER_MM = 96 / 25.4;
const PAPER_MM: Record<string, [number, number]> = {
  a4: [210, 297],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
  a5: [148, 210],
};
const MARGIN_MM: Record<string, number> = { normal: 25, narrow: 12, wide: 40 };
const BODY = 15;
const LEADING = 1.65;
const GAP = 0.75 * BODY;
/** Average advance of the sans face, in em, across mixed prose. */
const CHAR_EM = 0.5;
const HEADING: Record<number, { size: number; before: number; after: number }> = {
  1: { size: 1.6, before: 1.35, after: 0.45 },
  2: { size: 1.3, before: 1.35, after: 0.45 },
  3: { size: 1.12, before: 1.35, after: 0.45 },
};

function textOf(node: PmNode): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(textOf).join(node.type === "hardBreak" ? "\n" : "");
}

function hardBreaks(node: PmNode): number {
  if (node.type === "hardBreak") return 1;
  return (node.content ?? []).reduce((sum, child) => sum + hardBreaks(child), 0);
}

function lines(text: string, width: number, size: number) {
  const perLine = Math.max(8, Math.floor(width / (size * CHAR_EM)));
  return Math.max(1, Math.ceil(text.length / perLine));
}

/** Height in px of one block at the given text width, and whether it starts a new sheet. */
function blockHeight(node: PmNode, width: number): number {
  const type = node.type ?? "";
  if (type === "paragraph" || type === "text") {
    const text = textOf(node);
    return (lines(text, width, BODY) + hardBreaks(node)) * BODY * LEADING + GAP;
  }
  if (type === "heading") {
    const level = Math.min(3, Math.max(1, Number(node.attrs?.level) || 1));
    const scale = HEADING[level] ?? { size: 1, before: 1.35, after: 0.45 };
    const size = BODY * scale.size;
    return lines(textOf(node), width, size) * size * 1.25 + (scale.before + scale.after) * size;
  }
  if (type === "bulletList" || type === "orderedList" || type === "taskList") {
    const inner = width - 1.5 * BODY;
    const items = (node.content ?? []).reduce(
      (sum, item) => sum + (item.content ?? []).reduce((height, child) => height + blockHeight(child, inner) - GAP, 0) + 0.4 * BODY,
      0,
    );
    return items + GAP;
  }
  if (type === "blockquote" || type === "callout") {
    const inner = width - 2 * BODY;
    return (node.content ?? []).reduce((sum, child) => sum + blockHeight(child, inner), 0) + GAP;
  }
  if (type === "codeBlock") {
    const size = BODY * 0.875;
    const rows = textOf(node).split("\n").length;
    return rows * size * 1.5 + 2 * BODY + GAP;
  }
  if (type === "table") {
    const rows = node.content ?? [];
    return rows.reduce((sum, row) => {
      const cells = row.content ?? [];
      const cellWidth = width / Math.max(1, cells.length) - 16;
      const tallest = Math.max(
        1,
        ...cells.map((cell) => (cell.content ?? []).reduce((height, child) => height + lines(textOf(child), cellWidth, BODY), 0)),
      );
      return sum + tallest * BODY * LEADING + 16;
    }, 0) + GAP;
  }
  if (type === "image" || type === "figure") {
    const height = Number(node.attrs?.height);
    return (Number.isFinite(height) && height > 0 ? height : 0.56 * width) + GAP;
  }
  if (type === "horizontalRule") return 2 * BODY + GAP;
  if (type === "equation" || type === "mathBlock" || type === "blockMath") return 3 * BODY + GAP;
  // Anything else: its text as prose, or one line.
  const text = textOf(node);
  return lines(text, width, BODY) * BODY * LEADING + GAP;
}

const BREAKS = new Set(["pageBreak", "sectionBreak"]);

export function estimateDocumentPages(content: unknown): number {
  const setup = record(record(content).pageSetup);
  const [paperWidth, paperHeight] = PAPER_MM[typeof setup.size === "string" ? setup.size : "a4"] ?? PAPER_MM.a4!;
  const [widthMm, heightMm] = setup.orientation === "landscape" ? [paperHeight, paperWidth] : [paperWidth, paperHeight];
  const margin = MARGIN_MM[typeof setup.margins === "string" ? setup.margins : "normal"] ?? MARGIN_MM.normal!;
  const columns = Math.min(3, Math.max(1, Number(setup.columns) || 1));
  const columnGap = 9 * PX_PER_MM;
  const width = ((widthMm - 2 * margin) * PX_PER_MM - (columns - 1) * columnGap) / columns;
  const room = (heightMm - 2 * margin) * PX_PER_MM * columns;
  const doc = documentContentToProseMirrorJson(content) as PmNode;
  let pages = 0;
  let used = 0;
  for (const node of doc.content ?? []) {
    if (BREAKS.has(node.type ?? "") || node.attrs?.pageBreakBefore === true || node.attrs?.pageBreak === true) {
      if (used > 0) pages += 1;
      used = 0;
      if (BREAKS.has(node.type ?? "")) continue;
    }
    const height = blockHeight(node, width);
    // A block that does not fit is carried to the next sheet, as page-flow does.
    if (used > 0 && used + height > room && height <= room) {
      pages += 1;
      used = 0;
    }
    used += height;
    while (used > room) {
      pages += 1;
      used -= room;
    }
  }
  return pages + used / room;
}

/** "About 2 pages", for a save result. A last sheet with only a few lines says so. */
export function pagesNote(content: unknown) {
  const raw = estimateDocumentPages(content);
  const sheets = Math.max(1, Math.ceil(raw - 0.02));
  const last = raw - (sheets - 1);
  const tail = sheets > 1 && last < 0.2 ? `, the last with only a few lines` : "";
  return `About ${sheets} ${sheets === 1 ? "page" : "pages"}${tail}.`;
}

const PAGE_WORDS: Record<string, number> = { a: 1, one: 1, single: 1, "1": 1, two: 2, "2": 2, three: 3, "3": 3, four: 4, "4": 4 };

/** The page count a request asks for ("a one-page sheet", "two pages"), or null. */
export function requestedPages(prompt: string): number | null {
  const match = /\b(a|one|single|1|two|2|three|3|four|4)[-\s](?:sided?\s)?pages?\b/i.exec(prompt)
    ?? /\b(?:on|to|in|onto)\s+(one|a single|a|1)\s+(?:side|sheet)\b/i.exec(prompt);
  if (!match) return null;
  return PAGE_WORDS[match[1]!.toLowerCase().replace(/^a single$/, "single")] ?? null;
}

/**
 * Said plainly in a save result when a document runs past the length the
 * student asked for, so the model fixes it before it replies instead of
 * calling a sheet of 1.7 pages "one page" (F02).
 */
export function lengthNote(content: unknown, prompt: string) {
  const asked = requestedPages(prompt);
  if (!asked) return "";
  const pages = estimateDocumentPages(content);
  if (pages <= asked + 0.02) return "";
  const named = asked === 1 ? "one page" : `${asked} pages`;
  return `\nToo long: the student asked for ${named} and this runs to about ${pages.toFixed(1)} pages. Cut it to fit, or tighten the page setup (narrow margins, two columns), before you reply. Do not call it ${named} until it fits.`;
}
