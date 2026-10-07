import type {
  PresentationHyperlink,
  PresentationParagraph,
  PresentationTextRun,
} from "../presentation/model";
import {
  richContentAst,
  type RichAlign,
  type RichBlock,
  type RichBlockDraft,
  type RichInline,
  type RichListItem,
  type RichMark,
  type SpectraRichContentAst,
} from "./ast";

/*
 * Slide text (DrawingML paragraphs and runs) and the shared model, both ways.
 *
 * A slide keeps PowerPoint's shape: a flat run of paragraphs, each with a
 * list kind and a level. The model nests lists instead. Reading groups the
 * consecutive bulleted paragraphs into nested lists by level; writing
 * flattens them back. A run's typeface, size and colour travel as the text's
 * own style, so editing a word never loses the deck's formatting.
 *
 * Checklists, quotes, callouts, code and equations are Spectra's own: a
 * paragraph carries `checked` or `block` (and a callout's `tone`), a run
 * `code` or `math`, and PowerPoint gets the nearest thing it has
 * (`nativePresentationParagraph`).
 */

const SLIDE_LINK = "slide:";
type SlideList = Extract<RichBlockDraft, { type: "list" }>;

function hrefOf(link: PresentationTextRun["hyperlink"]): string | undefined {
  if (!link) return undefined;
  if (typeof link === "string") return link;
  return link.kind === "slide" ? `${SLIDE_LINK}${link.slideId}` : link.url;
}

function hyperlinkOf(href: string): PresentationHyperlink {
  return href.startsWith(SLIDE_LINK) ? { kind: "slide", slideId: href.slice(SLIDE_LINK.length) } : { kind: "external", url: href };
}

function runInlines(runs: readonly PresentationTextRun[]): RichInline[] {
  const output: RichInline[] = [];
  for (const run of runs) {
    const marks: RichMark[] = [];
    if (run.bold) marks.push("bold");
    if (run.italic) marks.push("italic");
    if (run.underline) marks.push("underline");
    if (run.strike) marks.push("strike");
    const style = {
      ...(run.fontFamily ? { fontFamily: run.fontFamily } : {}),
      ...(run.fontSizePt ? { fontSizePt: run.fontSizePt } : {}),
      ...(run.color ? { color: run.color } : {}),
    };
    const pieces: RichInline[] = [];
    if (run.math) {
      if (run.text) pieces.push({ type: "inline_math", math: run.text, complete: true });
    } else {
      run.text.split(/\r?\n|\v/).forEach((text, index) => {
        if (index) pieces.push({ type: "break" });
        if (!text) return;
        if (run.code) pieces.push({ type: "inline_code", code: text });
        else pieces.push({ type: "text", text, ...(marks.length ? { marks } : {}), ...(Object.keys(style).length ? { style } : {}) });
      });
    }
    const href = hrefOf(run.hyperlink);
    const last = output[output.length - 1];
    if (href && last?.type === "link" && last.href === href) last.content.push(...pieces);
    else if (href) output.push({ type: "link", href, content: pieces });
    else output.push(...pieces);
  }
  return output;
}

function paragraphBlock(paragraph: PresentationParagraph): RichBlockDraft {
  const align = paragraph.alignment && paragraph.alignment !== "left" ? paragraph.alignment : undefined;
  return { type: "paragraph", content: runInlines(paragraph.runs), ...(align ? { align } : {}) };
}

function listKind(paragraph: PresentationParagraph): SlideList["kind"] | null {
  if (paragraph.bullet === "numbered") return "ordered";
  if (paragraph.bullet !== "bullet") return null;
  return paragraph.checked === undefined ? "bullet" : "task";
}

const paragraphText = (paragraph: PresentationParagraph) => paragraph.runs.map((run) => run.text).join("");
const levelOf = (paragraph: PresentationParagraph) => Math.max(0, Math.min(8, paragraph.level ?? 0));

/**
 * The lines of one quote, callout, code block or equation, from `index`.
 * Consecutive lines of a quote, a callout of one tone or a code block are one
 * block; each equation is its own. A code block inside a list item stays with
 * its own lines (each with `bullet: "none"`) and stops at the next item.
 */
function groupEnd(paragraphs: readonly PresentationParagraph[], index: number): number {
  const first = paragraphs[index]!;
  let end = index + 1;
  if (first.block === "math") return end;
  while (end < paragraphs.length) {
    const next = paragraphs[end]!;
    if (next.block !== first.block || next.tone !== first.tone) break;
    if (first.block === "code" && (listKind(next) || (next.bullet === undefined) !== (first.bullet === undefined) || levelOf(next) !== levelOf(first))) break;
    // A quote written from inside a list item ends where its unbulleted lines end.
    if (first.bullet === "none" && next.bullet === undefined) break;
    end += 1;
  }
  return end;
}

function groupBlock(group: readonly PresentationParagraph[]): RichBlockDraft {
  const first = group[0]!;
  // Inside, the lines are plain again: a list in a quote is a list.
  const inner = () => slideBlocks(group.map(({ block: _block, tone: _tone, ...paragraph }) => paragraph)) as RichBlock[];
  switch (first.block) {
    case "quote":
      return { type: "quote", blocks: inner() };
    case "callout":
      return { type: "callout", tone: first.tone ?? "info", blocks: inner() };
    case "code":
      return { type: "code_block", code: group.map(paragraphText).join("\n") };
    default:
      return { type: "math_block", math: paragraphText(first) };
  }
}

/**
 * Slide paragraphs as blocks, in one pass. Consecutive bulleted paragraphs
 * nest into lists by level. A quote, callout, code block or equation written
 * from inside a list item carries an explicit `bullet: "none"` at the item's
 * level, so it goes back into that item rather than ending the list.
 */
function slideBlocks(paragraphs: readonly PresentationParagraph[]): RichBlockDraft[] {
  const blocks: RichBlockDraft[] = [];
  // The open list at each level while a list runs.
  let stack: SlideList[] = [];
  const lastItem = (list: SlideList) => list.items[list.items.length - 1]!.blocks as RichBlockDraft[];

  /** Adds an item holding `itemBlocks` to the list of `kind` at `level`, opening lists as needed. */
  const addItem = (kind: SlideList["kind"], level: number, checked: boolean | undefined, itemBlocks: RichBlockDraft[]) => {
    stack = stack.slice(0, level + 1);
    while (stack.length <= level) {
      const parent = stack[stack.length - 1];
      const list: SlideList = { type: "list", kind, items: [] };
      if (!parent) blocks.push(list);
      else {
        // A deeper paragraph with no item above it at its parent level still
        // needs an item to hang from.
        if (!parent.items.length) parent.items.push({ blocks: [] });
        lastItem(parent).push(list);
      }
      stack.push(list);
    }
    let list = stack[level]!;
    if (list.kind !== kind) {
      // A numbered run after a bulleted one at the same level is a new list.
      const parent = stack[level - 1];
      const next: SlideList = { type: "list", kind, items: [] };
      if (parent) lastItem(parent).push(next);
      else blocks.push(next);
      stack[level] = next;
      list = next;
    }
    list.items.push({ ...(kind === "task" ? { checked: checked === true } : {}), blocks: itemBlocks as RichBlock[] });
  };

  let index = 0;
  while (index < paragraphs.length) {
    const paragraph = paragraphs[index]!;
    const end = paragraph.block ? groupEnd(paragraphs, index) : index + 1;
    const block = paragraph.block ? groupBlock(paragraphs.slice(index, end)) : paragraphBlock(paragraph);
    const kind = listKind(paragraph);
    const level = levelOf(paragraph);
    const owner = paragraph.block && paragraph.bullet === "none" ? stack[level] : undefined;
    if (kind && !(paragraph.block === "quote" || paragraph.block === "callout")) {
      addItem(kind, level, paragraph.checked, [block]);
    } else if (owner?.items.length) {
      // The rest of a list item: back into the item it was written from.
      stack = stack.slice(0, level + 1);
      lastItem(owner).push(block);
    } else {
      stack = [];
      blocks.push(block);
    }
    index = end;
  }
  return blocks;
}

/** Slide paragraphs as the shared model. */
export function richContentFromSlideParagraphs(paragraphs: readonly PresentationParagraph[]): SpectraRichContentAst {
  return richContentAst(slideBlocks(paragraphs));
}

// ---------------------------------------------------------------------------

function runsOf(content: readonly RichInline[], href?: string): PresentationTextRun[][] {
  // A break starts a new slide paragraph, so runs come back line by line.
  const lines: PresentationTextRun[][] = [[]];
  const push = (run: PresentationTextRun) => {
    if (!run.text) return;
    lines[lines.length - 1]!.push(run);
  };
  for (const inline of content) {
    const link = href ? { hyperlink: hyperlinkOf(href) } : {};
    switch (inline.type) {
      case "text":
        push({
          text: inline.text,
          ...(inline.marks?.includes("bold") ? { bold: true } : {}),
          ...(inline.marks?.includes("italic") ? { italic: true } : {}),
          ...(inline.marks?.includes("underline") ? { underline: true } : {}),
          ...(inline.marks?.includes("strike") ? { strike: true } : {}),
          ...(inline.style?.fontFamily ? { fontFamily: inline.style.fontFamily } : {}),
          ...(inline.style?.fontSizePt ? { fontSizePt: inline.style.fontSizePt } : {}),
          ...(inline.style?.color ? { color: inline.style.color } : {}),
          ...link,
        });
        break;
      case "inline_code":
        push({ text: inline.code, code: true, ...link });
        break;
      case "inline_math":
        push({ text: inline.math, math: true, ...link });
        break;
      case "citation":
        push({ text: `[${inline.label ?? "source"}]`, ...link });
        break;
      case "reference":
        push({ text: inline.label ?? "Referenced work", ...link });
        break;
      case "footnote_ref":
        push({ text: `[${inline.id}]`, ...link });
        break;
      case "image":
        push({ text: inline.alt, ...link });
        break;
      case "link": {
        const [first, ...rest] = runsOf(inline.content, inline.href);
        lines[lines.length - 1]!.push(...(first ?? []));
        lines.push(...rest);
        break;
      }
      case "break":
        lines.push([]);
        break;
    }
  }
  return lines;
}

type ParagraphShape = Omit<PresentationParagraph, "runs">;

/** A list item's later lines keep its level but not its bullet or tick. */
function continuation({ checked: _checked, ...shape }: ParagraphShape): ParagraphShape {
  return shape.bullet ? { ...shape, bullet: "none" } : shape;
}

function paragraphsOf(content: readonly RichInline[], shape: ParagraphShape): PresentationParagraph[] {
  return runsOf(content).map((runs, index) => ({ runs, ...(index === 0 ? shape : continuation(shape)) }));
}

function blockText(block: RichBlock): RichInline[] {
  switch (block.type) {
    case "table":
      return block.rows.flatMap((row, index) => [...(index ? [{ type: "break" } as const] : []), ...row.flatMap((cell, cellIndex) => [...(cellIndex ? [{ type: "text", text: " | " } as const] : []), ...cell])]);
    case "media":
      return [{ type: "text", text: block.alt || block.url }];
    case "embed":
      return [{ type: "text", text: block.label ?? "Embedded work" }];
    case "source_note":
      return [{ type: "text", text: "Source: " }, ...block.content];
    case "footnote":
      return [{ type: "text", text: `[${block.footnoteId}] ` }, ...block.content];
    default:
      return [];
  }
}

type ListItemShape = { bullet: "bullet" | "numbered"; checked?: boolean };

function flatten(blocks: readonly RichBlock[], level: number | undefined, listItem?: ListItemShape): PresentationParagraph[] {
  const output: PresentationParagraph[] = [];
  let leading = Boolean(listItem);
  const shapeFor = (align?: RichAlign): ParagraphShape => {
    const first = leading && listItem;
    const bullet = first ? listItem.bullet : listItem ? "none" : undefined;
    leading = false;
    return {
      ...(align ? { alignment: align } : {}),
      ...(level ? { level } : {}),
      ...(bullet ? { bullet } : {}),
      ...(first && listItem.checked !== undefined ? { checked: listItem.checked } : {}),
    };
  };
  for (const block of blocks) {
    switch (block.type) {
      case "paragraph":
      case "heading":
        // An empty line here is the item's own empty bullet. The editor's
        // filler line (a list item must open with one) never reaches here:
        // `richContentFromProseMirror` drops it.
        output.push(...paragraphsOf(block.content, shapeFor(block.align)));
        break;
      case "list":
        block.items.forEach((item: RichListItem) => {
          output.push(...flatten(item.blocks, listItem ? (level ?? 0) + 1 : level ?? 0, {
            bullet: block.kind === "ordered" ? "numbered" : "bullet",
            ...(block.kind === "task" ? { checked: item.checked === true } : {}),
          }));
        });
        leading = false;
        break;
      case "quote":
      case "callout": {
        const opens = leading && Boolean(listItem);
        const inner = flatten(block.blocks, level, opens ? listItem : undefined);
        const own: Pick<PresentationParagraph, "block" | "tone"> =
          block.type === "callout" ? { block: "callout", tone: block.tone } : { block: "quote" };
        output.push(
          ...inner.map((paragraph) => {
            // Later in a list item, its lines say so, so they read back into the item.
            const placed = listItem && !opens && !paragraph.bullet ? { ...paragraph, bullet: "none" as const } : paragraph;
            return placed.block ? placed : { ...placed, ...own };
          }),
        );
        leading = false;
        break;
      }
      case "code_block": {
        const shape = shapeFor();
        output.push(...block.code.split("\n").map((line, index) => ({
          runs: line ? [{ text: line }] : [],
          ...(index === 0 ? shape : continuation(shape)),
          block: "code" as const,
        })));
        break;
      }
      case "math_block":
        output.push({ runs: block.math ? [{ text: block.math }] : [], ...shapeFor(), block: "math" });
        break;
      case "rule":
        break;
      default:
        output.push(...paragraphsOf(blockText(block), shapeFor()));
    }
  }
  // An empty list item still owns its bullet.
  if (leading && listItem) output.push({ runs: [], ...shapeFor() });
  return output;
}

/** The shared model as slide paragraphs. */
export function richContentToSlideParagraphs(ast: SpectraRichContentAst): PresentationParagraph[] {
  const paragraphs = flatten(ast.blocks, undefined);
  return paragraphs.length ? paragraphs : [{ runs: [] }];
}

// ---------------------------------------------------------------------------

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const PARAGRAPH_KEYS = ["alignment", "level", "bullet", "checked", "block", "tone"] as const;

/**
 * What a run looked like before the field: every key the field did not
 * change keeps its original value (an explicit `bold: false` over a bold
 * placeholder, a legacy link string), and the field's words and changes win.
 */
function keepRun(next: PresentationTextRun, normalized: readonly PresentationTextRun[], original: readonly PresentationTextRun[]): PresentationTextRun {
  const { text, ...format } = next;
  const index = normalized.findIndex(({ text: _text, ...candidate }) => same(candidate, format));
  const source = index >= 0 ? original[index] : undefined;
  if (!source) return next;
  const { text: _text, ...kept } = source;
  return { ...kept, text };
}

function keepParagraph(next: PresentationParagraph, normalized: PresentationParagraph | undefined, original: PresentationParagraph | undefined): PresentationParagraph {
  if (!normalized || !original) return next;
  const merged: PresentationParagraph = { ...next };
  for (const key of PARAGRAPH_KEYS) {
    // The field did not change it: the deck's own value stands, even where the model drops it (a `left` alignment, level 0, an explicit `none` bullet).
    if (same(next[key], normalized[key]) && original[key] !== undefined) (merged as Record<string, unknown>)[key] = original[key];
  }
  // Runs line up one to one when the original had no empty runs: the model drops them.
  const runs = original.runs.filter((run) => run.text);
  merged.runs = runs.length === normalized.runs.length ? next.runs.map((run) => keepRun(run, normalized.runs, runs)) : next.runs;
  return merged;
}

/**
 * The paragraphs a slide text box keeps after its rich field changed.
 *
 * The field speaks the shared model, which does not carry everything a deck
 * holds (an explicit left alignment, a level on an unbulleted line, a run
 * that switches bold off over a bold placeholder). Paragraphs the field did
 * not touch keep their original objects exactly, and a changed paragraph
 * keeps every property the field left as it was, so editing one word never
 * rewrites the rest of an imported slide.
 */
export function slideParagraphsAfterEdit(previous: readonly PresentationParagraph[], next: readonly PresentationParagraph[]): PresentationParagraph[] {
  const normalized = richContentToSlideParagraphs(richContentFromSlideParagraphs(previous));
  // Line breaks inside a run become paragraphs in the model, so the two no longer line up: the field's paragraphs stand.
  if (normalized.length !== previous.length) return [...next];
  let start = 0;
  while (start < next.length && start < normalized.length && same(next[start], normalized[start])) start += 1;
  let end = 0;
  while (end < next.length - start && end < normalized.length - start && same(next[next.length - 1 - end], normalized[normalized.length - 1 - end])) end += 1;
  const middle = next.slice(start, next.length - end).map((paragraph, offset) => {
    const at = start + offset;
    // A paragraph that lines up with an old one is that one, edited; a new one takes nothing from its neighbours.
    return at < normalized.length - end ? keepParagraph(paragraph, normalized[at], previous[at]) : paragraph;
  });
  return [...previous.slice(0, start), ...middle, ...previous.slice(previous.length - end)];
}
