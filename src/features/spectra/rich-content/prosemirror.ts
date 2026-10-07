import type { JSONContent } from "@tiptap/core";
import {
  richContentAst,
  type RichAlign,
  type RichBlock,
  type RichBlockDraft,
  type RichCalloutTone,
  type RichInline,
  type RichMark,
  type RichTextStyle,
  type SpectraRichContentAst,
} from "./ast";

/*
 * The editors' ProseMirror documents and the shared model, both ways.
 *
 * A text field that stores Markdown or slide runs is still edited by the same
 * TipTap field: its value comes in through `richContentToProseMirror` and
 * goes back out through `richContentFromProseMirror`, so the editor never
 * learns a second schema and the model never learns ProseMirror.
 */

type Json = JSONContent;
const ALIGNS = new Set<RichAlign>(["left", "center", "right", "justify"]);
const TONES = new Set<RichCalloutTone>(["info", "tip", "warning"]);
const MARK_NAMES: Record<string, RichMark> = { bold: "bold", italic: "italic", underline: "underline", strike: "strike" };

function alignOf(node: Json): RichAlign | undefined {
  const value = node.attrs?.textAlign;
  return ALIGNS.has(value) && value !== "left" ? value : undefined;
}

function styleOf(attrs: Record<string, unknown> | undefined): RichTextStyle | undefined {
  if (!attrs) return undefined;
  const style: RichTextStyle = {};
  if (typeof attrs.fontFamily === "string" && attrs.fontFamily) style.fontFamily = attrs.fontFamily;
  if (typeof attrs.color === "string" && attrs.color) style.color = attrs.color;
  const size = typeof attrs.fontSize === "string" ? attrs.fontSize.match(/^([\d.]+)pt$/) : null;
  if (size) style.fontSizePt = Number(size[1]);
  return Object.keys(style).length ? style : undefined;
}

function inlinesFrom(nodes: readonly Json[] | undefined): RichInline[] {
  const output: RichInline[] = [];
  for (const node of nodes ?? []) {
    if (node.type === "hardBreak") { output.push({ type: "break" }); continue; }
    if (node.type === "inlineEquation") { output.push({ type: "inline_math", math: String(node.attrs?.latex ?? ""), complete: true }); continue; }
    if (node.type === "spectraCitation") {
      const evidence = node.attrs?.evidenceSpanId;
      output.push({
        type: "citation",
        sourceId: String(node.attrs?.sourceId ?? ""),
        evidenceIds: typeof evidence === "string" && evidence ? [evidence] : [],
        ...(typeof node.attrs?.label === "string" ? { label: node.attrs.label } : {}),
      });
      continue;
    }
    if (node.type === "image") { output.push({ type: "image", url: String(node.attrs?.src ?? ""), alt: String(node.attrs?.alt ?? "") }); continue; }
    if (node.type !== "text" || !node.text) continue;
    const marks = node.marks ?? [];
    if (marks.some((mark) => mark.type === "code")) { output.push({ type: "inline_code", code: node.text }); continue; }
    const richMarks = marks.flatMap((mark) => (MARK_NAMES[mark.type] ? [MARK_NAMES[mark.type]!] : []));
    const style = styleOf(marks.find((mark) => mark.type === "textStyle")?.attrs);
    const text: RichInline = { type: "text", text: node.text, ...(richMarks.length ? { marks: richMarks } : {}), ...(style ? { style } : {}) };
    const link = marks.find((mark) => mark.type === "link")?.attrs?.href;
    const last = output[output.length - 1];
    if (typeof link === "string" && link) {
      if (last?.type === "link" && last.href === link) last.content.push(text);
      else output.push({ type: "link", href: link, content: [text] });
      continue;
    }
    output.push(text);
  }
  return output;
}

/**
 * The attribute on the empty line `richContentToProseMirror` puts at the top
 * of a list item that opens with something else (a deeper list, a code
 * block): the editor needs it, the content does not have it.
 */
export const LIST_FILLER = "listFiller";

/** A list item's content without the editor's own filler line, while it is still empty. */
function withoutFiller(nodes: readonly Json[] | undefined): readonly Json[] | undefined {
  const [first, ...rest] = nodes ?? [];
  return first?.type === "paragraph" && first.attrs?.[LIST_FILLER] === true && !first.content?.length && rest.length ? rest : nodes;
}

function blocksFrom(nodes: readonly Json[] | undefined): RichBlockDraft[] {
  const blocks: RichBlockDraft[] = [];
  for (const node of nodes ?? []) {
    const align = alignOf(node);
    switch (node.type) {
      case "paragraph":
        blocks.push({ type: "paragraph", content: inlinesFrom(node.content), ...(align ? { align } : {}) });
        break;
      case "heading": {
        const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1))) as 1 | 2 | 3 | 4 | 5 | 6;
        blocks.push({ type: "heading", level, content: inlinesFrom(node.content), ...(align ? { align } : {}) });
        break;
      }
      case "bulletList":
      case "orderedList":
      case "taskList": {
        const kind = node.type === "taskList" ? "task" : node.type === "orderedList" ? "ordered" : "bullet";
        const start = Number(node.attrs?.start);
        blocks.push({
          type: "list",
          kind,
          ...(kind === "ordered" && Number.isInteger(start) && start > 1 ? { start } : {}),
          items: (node.content ?? []).map((item) => ({
            ...(kind === "task" ? { checked: Boolean(item.attrs?.checked) } : {}),
            blocks: blocksFrom(withoutFiller(item.content)) as RichBlock[],
          })),
        });
        break;
      }
      case "blockquote":
        blocks.push({ type: "quote", blocks: blocksFrom(node.content) as RichBlock[] });
        break;
      case "callout": {
        const tone = node.attrs?.type as RichCalloutTone;
        blocks.push({ type: "callout", tone: TONES.has(tone) ? tone : "info", blocks: blocksFrom(node.content) as RichBlock[] });
        break;
      }
      case "codeBlock":
        blocks.push({ type: "code_block", code: (node.content ?? []).map((child) => child.text ?? "").join(""), ...(node.attrs?.language ? { language: String(node.attrs.language) } : {}) });
        break;
      case "equation":
        blocks.push({ type: "math_block", math: String(node.attrs?.latex ?? "") });
        break;
      case "horizontalRule":
        blocks.push({ type: "rule" });
        break;
      case "image":
        blocks.push({ type: "media", url: String(node.attrs?.src ?? ""), alt: String(node.attrs?.alt ?? "") });
        break;
      case "spectraReference": {
        const embedId = node.attrs?.embedId;
        const workId = node.attrs?.sourceArtifactId ?? node.attrs?.workId;
        blocks.push({ type: "embed", ...(typeof embedId === "string" && embedId ? { embedId } : {}), ...(typeof workId === "string" && workId ? { workId } : {}) });
        break;
      }
      case "table":
        blocks.push({
          type: "table",
          header: Boolean(node.content?.[0]?.content?.some((cell) => cell.type === "tableHeader")),
          rows: (node.content ?? []).map((row) => (row.content ?? []).map((cell) => inlinesFrom((cell.content ?? []).flatMap((block, index) => (index ? [{ type: "hardBreak" }, ...(block.content ?? [])] : block.content ?? []))))),
        });
        break;
      default:
        if (node.content?.length) blocks.push(...blocksFrom(node.content));
    }
  }
  return blocks;
}

/** A ProseMirror document (an editor's `getJSON()`) as the shared model. */
export function richContentFromProseMirror(doc: Json): SpectraRichContentAst {
  return richContentAst(blocksFrom(doc.content));
}

// ---------------------------------------------------------------------------

function marksFor(inline: Extract<RichInline, { type: "text" }>, href?: string) {
  const marks: NonNullable<Json["marks"]> = (inline.marks ?? []).map((mark) => ({ type: mark }));
  if (inline.style) {
    marks.push({
      type: "textStyle",
      attrs: {
        fontFamily: inline.style.fontFamily ?? null,
        fontSize: inline.style.fontSizePt ? `${inline.style.fontSizePt}pt` : null,
        color: inline.style.color ?? null,
      },
    });
  }
  if (href) marks.push({ type: "link", attrs: { href } });
  return marks;
}

function inlinesTo(content: readonly RichInline[], href?: string): Json[] {
  const output: Json[] = [];
  for (const inline of content) {
    switch (inline.type) {
      case "text": {
        if (!inline.text) break;
        const marks = marksFor(inline, href);
        output.push({ type: "text", text: inline.text, ...(marks.length ? { marks } : {}) });
        break;
      }
      case "inline_code":
        if (inline.code) output.push({ type: "text", text: inline.code, marks: [{ type: "code" }] });
        break;
      case "inline_math":
        output.push({ type: "inlineEquation", attrs: { latex: inline.math } });
        break;
      case "link":
        output.push(...inlinesTo(inline.content, inline.href));
        break;
      case "break":
        output.push({ type: "hardBreak" });
        break;
      case "citation":
        output.push({ type: "text", text: `[${inline.label ?? "source"}]` });
        break;
      case "reference":
        output.push({ type: "text", text: inline.label ?? "Referenced work" });
        break;
      case "footnote_ref":
        output.push({ type: "text", text: `[${inline.id}]` });
        break;
      case "image":
        output.push({ type: "text", text: inline.alt });
        break;
    }
  }
  return output;
}

function paragraph(content: readonly RichInline[], align?: RichAlign): Json {
  const inner = inlinesTo(content);
  return { type: "paragraph", ...(align ? { attrs: { textAlign: align } } : {}), ...(inner.length ? { content: inner } : {}) };
}

function blocksTo(blocks: readonly RichBlock[]): Json[] {
  return blocks.flatMap((block): Json[] => {
    switch (block.type) {
      case "paragraph":
        return [paragraph(block.content, block.align)];
      case "heading": {
        const inner = inlinesTo(block.content);
        return [{ type: "heading", attrs: { level: Math.min(3, block.level), ...(block.align ? { textAlign: block.align } : {}) }, ...(inner.length ? { content: inner } : {}) }];
      }
      case "list": {
        const type = block.kind === "task" ? "taskList" : block.kind === "ordered" ? "orderedList" : "bulletList";
        const item = block.kind === "task" ? "taskItem" : "listItem";
        return [{
          type,
          ...(block.start ? { attrs: { start: block.start } } : {}),
          content: block.items.map((entry) => {
            const content = blocksTo(entry.blocks);
            // A list item starts with a paragraph in every editor schema. One
            // made up here is marked, so it never reads back as an empty line.
            if (!content.length || content[0]!.type !== "paragraph") content.unshift({ type: "paragraph", attrs: { [LIST_FILLER]: true } });
            return { type: item, ...(block.kind === "task" ? { attrs: { checked: Boolean(entry.checked) } } : {}), content };
          }),
        }];
      }
      case "quote":
        return [{ type: "blockquote", content: blocksTo(block.blocks).length ? blocksTo(block.blocks) : [{ type: "paragraph" }] }];
      case "callout":
        return [{ type: "callout", attrs: { type: block.tone }, content: blocksTo(block.blocks).length ? blocksTo(block.blocks) : [{ type: "paragraph" }] }];
      case "code_block":
        return [{ type: "codeBlock", ...(block.language ? { attrs: { language: block.language } } : {}), ...(block.code ? { content: [{ type: "text", text: block.code }] } : {}) }];
      case "math_block":
        return [{ type: "equation", attrs: { latex: block.math, display: "block", alignment: "center" } }];
      case "rule":
        return [{ type: "horizontalRule" }];
      case "table":
      case "media":
      case "embed":
      case "source_note":
      case "footnote":
        // Not part of the field editors' schema: kept as readable text.
        return [paragraph(richBlockInlines(block))];
    }
  });
}

/** What a block reads as when an editor cannot hold it as itself. */
function richBlockInlines(block: RichBlock): RichInline[] {
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

/** The shared model as a ProseMirror document for a TipTap field. */
export function richContentToProseMirror(ast: SpectraRichContentAst): Json {
  const content = blocksTo(ast.blocks);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
