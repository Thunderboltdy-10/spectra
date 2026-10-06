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
    run.text.split(/\r?\n|\v/).forEach((text, index) => {
      if (index) pieces.push({ type: "break" });
      if (text) pieces.push({ type: "text", text, ...(marks.length ? { marks } : {}), ...(Object.keys(style).length ? { style } : {}) });
    });
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

/** Slide paragraphs as the shared model. */
export function richContentFromSlideParagraphs(paragraphs: readonly PresentationParagraph[]): SpectraRichContentAst {
  const blocks: RichBlockDraft[] = [];
  // The open list at each level while consecutive bulleted paragraphs run.
  let stack: SlideList[] = [];
  for (const paragraph of paragraphs) {
    const kind = paragraph.bullet === "bullet" ? "bullet" : paragraph.bullet === "numbered" ? "ordered" : null;
    if (!kind) {
      stack = [];
      blocks.push(paragraphBlock(paragraph));
      continue;
    }
    const level = Math.max(0, Math.min(8, paragraph.level ?? 0));
    stack = stack.slice(0, level + 1);
    while (stack.length <= level) {
      const parent = stack[stack.length - 1];
      const list: SlideList = { type: "list", kind, items: [] };
      if (!parent) blocks.push(list);
      else {
        // A deeper paragraph with no item above it at its parent level still
        // needs an item to hang from.
        if (!parent.items.length) parent.items.push({ blocks: [] });
        (parent.items[parent.items.length - 1]!.blocks as RichBlockDraft[]).push(list);
      }
      stack.push(list);
    }
    let list = stack[level]!;
    if (list.kind !== kind) {
      // A numbered run after a bulleted one at the same level is a new list.
      const parent = stack[level - 1];
      const next: SlideList = { type: "list", kind, items: [] };
      if (parent) (parent.items[parent.items.length - 1]!.blocks as RichBlockDraft[]).push(next);
      else blocks.push(next);
      stack[level] = next;
      list = next;
    }
    list.items.push({ blocks: [paragraphBlock(paragraph)] as RichBlock[] });
  }
  return richContentAst(blocks);
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
        push({ text: inline.code, ...link });
        break;
      case "inline_math":
        push({ text: inline.math, ...link });
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

function paragraphsOf(content: readonly RichInline[], shape: Omit<PresentationParagraph, "runs">): PresentationParagraph[] {
  return runsOf(content).map((runs, index) => ({
    runs,
    ...(shape.alignment ? { alignment: shape.alignment } : {}),
    ...(shape.level ? { level: shape.level } : {}),
    // Only the first line of a list item carries its bullet.
    ...(shape.bullet ? { bullet: index === 0 ? shape.bullet : ("none" as const) } : {}),
  }));
}

function blockText(block: RichBlock): RichInline[] {
  switch (block.type) {
    case "code_block":
      return block.code.split("\n").flatMap((line, index) => [...(index ? [{ type: "break" } as const] : []), { type: "text", text: line } as const]);
    case "math_block":
      return [{ type: "text", text: block.math }];
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

function flatten(blocks: readonly RichBlock[], level: number | undefined, listItem?: { bullet: "bullet" | "numbered" }): PresentationParagraph[] {
  const output: PresentationParagraph[] = [];
  let leading = Boolean(listItem);
  const shapeFor = (align?: RichAlign): Omit<PresentationParagraph, "runs"> => {
    const bullet = leading && listItem ? listItem.bullet : listItem ? "none" : undefined;
    leading = false;
    return { ...(align ? { alignment: align } : {}), ...(level !== undefined ? { level } : {}), ...(bullet ? { bullet } : {}) };
  };
  for (const block of blocks) {
    switch (block.type) {
      case "paragraph":
      case "heading":
        output.push(...paragraphsOf(block.content, shapeFor(block.align)));
        break;
      case "list":
        block.items.forEach((item: RichListItem) => {
          output.push(...flatten(item.blocks, listItem ? (level ?? 0) + 1 : level ?? 0, { bullet: block.kind === "ordered" ? "numbered" : "bullet" }));
        });
        leading = false;
        break;
      case "quote":
      case "callout":
        output.push(...flatten(block.blocks, level, leading && listItem ? listItem : undefined));
        leading = false;
        break;
      case "rule":
        break;
      default:
        output.push(...paragraphsOf(blockText(block), shapeFor()));
    }
  }
  // An empty list item still owns its bullet.
  if (leading && listItem) output.push({ runs: [], ...(level ? { level } : {}), bullet: listItem.bullet });
  return output;
}

/** The shared model as slide paragraphs. */
export function richContentToSlideParagraphs(ast: SpectraRichContentAst): PresentationParagraph[] {
  const paragraphs = flatten(ast.blocks, undefined);
  return paragraphs.length ? paragraphs : [{ runs: [] }];
}
