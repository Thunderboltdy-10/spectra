/*
 * Markdown <-> the document editor's ProseMirror JSON.
 *
 * Models write Markdown fluently, so documents are authored and edited in it.
 * The subset maps one to one onto the editor's nodes:
 *
 *   # / ## / ###            heading (levels 1-3)
 *   - item, 1. item         bullet and ordered lists, nested by two spaces
 *   - [ ] task, - [x] done  task lists
 *   > quote                 blockquote
 *   > [!tip] text           callout (note, info, tip, success, warning)
 *   ```lang                 code block
 *   $$ latex $$             display equation
 *   | a | b |               table (first row is the header; :--: aligns a column)
 *   {style=banded}          the line after a table: its look (style, lines, fills)
 *   ---                     divider
 *   [[page-break]]          page break
 *   [[toc]]                 a contents list from the headings
 *   text {.center}          a paragraph's or heading's alignment, {.caption} a caption
 *   **b** *i* ~~s~~ `c` ==h== <u>u</u> <sup>2</sup> <sub>2</sub> [t](url) $x^2$   inline marks
 *   <span style="color: #C00000">red</span>   text colour
 *   ^[note text], or [^1] with a "[^1]: note text" line   footnotes
 *
 * Anything Markdown cannot express (a live reference, a citation, an image)
 * is shown as a keep marker, `<!-- keep:ID label -->`. Leaving the marker in
 * place keeps the original node exactly; deleting it removes the node.
 */

import { normalizeMath } from "../../../rich-content/markdown";
import { TABLE_STYLES, type TableLines } from "../../../editor/table-styles";

export type PmMark = { type: string; attrs?: Record<string, unknown> };
export type PmNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: PmMark[];
};

const KEEP_MARKER = /^<!--\s*keep:([^\s]+)(?:\s+[^]*?)?\s*-->$/;

// ---------------------------------------------------------------- inline

function textNode(text: string, marks: PmMark[]): PmNode | null {
  if (!text) return null;
  return marks.length ? { type: "text", text, marks: marks.map((mark) => ({ ...mark })) } : { type: "text", text };
}

function pushText(out: PmNode[], text: string, marks: PmMark[]) {
  const node = textNode(text, marks);
  if (!node) return;
  const previous = out.at(-1);
  if (
    previous?.type === "text" &&
    JSON.stringify(previous.marks ?? []) === JSON.stringify(node.marks ?? [])
  ) {
    previous.text = `${previous.text ?? ""}${node.text}`;
    return;
  }
  out.push(node);
}

const DELIMITERS: Array<{ open: string; close: string; mark: PmMark }> = [
  { open: "**", close: "**", mark: { type: "bold" } },
  { open: "__", close: "__", mark: { type: "bold" } },
  { open: "~~", close: "~~", mark: { type: "strike" } },
  { open: "==", close: "==", mark: { type: "highlight" } },
  { open: "<u>", close: "</u>", mark: { type: "underline" } },
  { open: "<sup>", close: "</sup>", mark: { type: "superscript" } },
  { open: "<sub>", close: "</sub>", mark: { type: "subscript" } },
  { open: "*", close: "*", mark: { type: "italic" } },
  { open: "_", close: "_", mark: { type: "italic" } },
];

function findClose(source: string, from: number, close: string) {
  let index = from;
  while (index < source.length) {
    const found = source.indexOf(close, index);
    if (found < 0) return -1;
    if (source[found - 1] === "\\") {
      index = found + close.length;
      continue;
    }
    // `*` must not match the first half of `**`.
    if ((close === "*" || close === "_") && source[found + 1] === close) {
      index = found + 2;
      continue;
    }
    return found;
  }
  return -1;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const COLOR_SPAN = /^<span\s+style=["']\s*color\s*:\s*(#[0-9a-fA-F]{6})\s*;?\s*["']\s*>/;

/** The end of a bracketed run that starts at `open`, past nested brackets and escapes. */
function closingBracket(source: string, open: number) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") index += 1;
    else if (char === "[") depth += 1;
    else if (char === "]" && --depth === 0) return index;
  }
  return -1;
}

const unescapeNote = (text: string) => text.replace(/\\([\\\[\]])/g, "$1").trim();

const CITATION = /^\[\[cite:([^:\]|]+)(?::([^\]|]+))?(?:\|([^\]]+))?\]\]/;

function citationId() {
  return `cite-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function parseInline(source: string, marks: PmMark[] = []): PmNode[] {
  const out: PmNode[] = [];
  let buffer = "";
  const flush = () => {
    pushText(out, buffer, marks);
    buffer = "";
  };
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    const rest = source.slice(index);
    if (char === "\\" && index + 1 < source.length && /[\\`*_{}[\]()#+\-.!|~=$<>^]/.test(source[index + 1]!)) {
      buffer += source[index + 1];
      index += 2;
      continue;
    }
    if (char === "\n") {
      // A Markdown hard break is two trailing spaces or a backslash; a plain
      // newline inside a paragraph is a soft break, shown as a space.
      if (buffer.endsWith("  ")) {
        buffer = buffer.replace(/ +$/, "");
        flush();
        out.push({ type: "hardBreak" });
      } else buffer += " ";
      index += 1;
      continue;
    }
    if (char === "`") {
      const close = source.indexOf("`", index + 1);
      if (close > index + 1) {
        flush();
        pushText(out, source.slice(index + 1, close), [...marks, { type: "code" }]);
        index = close + 1;
        continue;
      }
    }
    if (char === "$" && source[index + 1] !== "$" && source[index + 1] !== " ") {
      const close = source.indexOf("$", index + 1);
      if (close > index + 1 && source[close - 1] !== " " && !/\d/.test(source[close + 1] ?? "")) {
        flush();
        out.push({ type: "inlineEquation", attrs: { latex: source.slice(index + 1, close) } });
        index = close + 1;
        continue;
      }
    }
    if (char === "^" && source[index + 1] === "[") {
      // A footnote written where it belongs: ^[the note's words].
      const close = closingBracket(source, index + 1);
      if (close > index + 2) {
        flush();
        out.push({ type: "footnote", attrs: { text: unescapeNote(source.slice(index + 2, close)) } });
        index = close + 1;
        continue;
      }
    }
    if (char === "<") {
      const color = COLOR_SPAN.exec(rest);
      const close = color ? source.indexOf("</span>", index + color[0].length) : -1;
      if (color && close > index + color[0].length) {
        flush();
        for (const node of parseInline(source.slice(index + color[0].length, close), [...marks, { type: "textStyle", attrs: { color: color[1]!.toUpperCase() } }])) {
          if (node.type === "text") pushText(out, node.text ?? "", node.marks ?? []);
          else out.push(node);
        }
        index = close + "</span>".length;
        continue;
      }
    }
    if (char === "[") {
      // A citation the model wrote as it does in chat, [[cite:SOURCE(:WHERE)|Label]],
      // becomes a real citation node instead of raw text with an id in it.
      const cite = CITATION.exec(rest);
      if (cite) {
        flush();
        out.push({
          type: "spectraCitation",
          attrs: {
            id: citationId(),
            sourceId: cite[1]!.trim(),
            evidenceSpanId: cite[2]?.trim() || null,
            label: cite[3]?.trim() || "Source",
          },
        });
        index += cite[0].length;
        continue;
      }
      const link = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
      if (link) {
        flush();
        out.push(
          ...parseInline(link[1]!, [...marks, { type: "link", attrs: { href: link[2] } }]),
        );
        index += link[0].length;
        continue;
      }
    }
    const delimiter = DELIMITERS.find((entry) => rest.startsWith(entry.open));
    if (delimiter) {
      const start = index + delimiter.open.length;
      const close = findClose(source, start, delimiter.close);
      const inner = close > start ? source.slice(start, close) : "";
      const intraword =
        delimiter.open === "_" && /\w/.test(source[index - 1] ?? "");
      if (inner && !/^\s|\s$/.test(inner) && !intraword) {
        flush();
        for (const node of parseInline(inner, [...marks, delimiter.mark])) {
          if (node.type === "text") pushText(out, node.text ?? "", node.marks ?? []);
          else out.push(node);
        }
        index = close + delimiter.close.length;
        continue;
      }
    }
    buffer += char;
    index += 1;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- blocks

function indentOf(line: string) {
  const match = /^( *)/.exec(line.replace(/\t/g, "  "));
  return match ? match[1]!.length : 0;
}

const LIST_ITEM = /^( *)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^ {0,3}(```+|~~~+)\s*([\w+#.-]*)\s*$/;

const PAGE_BREAK = /^(?:\[\[page-?break\]\]|\\(?:newpage|pagebreak|clearpage))$/i;
const TOC = /^\[\[(?:toc|contents)\]\]$/i;
const NOTE_DEFINITION = /^\[\^([^\]\s]+)\]:\s?(.*)$/;
/** Attributes after a paragraph or heading: {.center}, {.caption .right}. */
const BLOCK_ATTRIBUTES = /\s*\{((?:\s*\.[a-z-]+)+)\s*\}\s*$/i;
/** The look written on the line after a table: {style=banded} or {lines=horizontal line-color=#1F4E79}. */
const TABLE_ATTRIBUTES = /^\{\s*((?:[a-z-]+\s*=\s*[#\w-]+\s*)+)\}$/i;
const ALIGNMENTS = new Set(["left", "center", "right", "justify"]);

function isBlockStart(line: string) {
  const trimmed = line.trim();
  return (
    PAGE_BREAK.test(trimmed) ||
    TOC.test(trimmed) ||
    /^#{1,6}(\s|$)/.test(trimmed) ||
    LIST_ITEM.test(line) ||
    trimmed.startsWith(">") ||
    FENCE.test(line) ||
    trimmed.startsWith("$$") ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed) ||
    KEEP_MARKER.test(trimmed) ||
    (trimmed.startsWith("|") && trimmed.endsWith("|"))
  );
}

const CALLOUT_TYPES: Record<string, string> = {
  note: "info",
  info: "info",
  tip: "success",
  success: "success",
  important: "warning",
  warning: "warning",
  caution: "warning",
};

function tableCells(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]!;
    if (char === "\\" && trimmed[index + 1] === "|") {
      current += "|";
      index += 1;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

/** A paragraph's or heading's trailing {.center .caption}, read off its text. */
function blockAttributes(text: string): { text: string; attrs: Record<string, unknown> } {
  const match = BLOCK_ATTRIBUTES.exec(text);
  if (!match || text[match.index + match[0].indexOf("{") - 1] === "\\") return { text, attrs: {} };
  const attrs: Record<string, unknown> = {};
  for (const name of match[1]!.split(/\s+/).map((entry) => entry.replace(/^\./, "").toLowerCase()).filter(Boolean)) {
    if (ALIGNMENTS.has(name)) attrs.textAlign = name;
    else if (name === "centre") attrs.textAlign = "center";
    else if (name === "caption") attrs.blockStyle = "caption";
    else return { text, attrs: {} };
  }
  return { text: text.slice(0, match.index), attrs };
}

function paragraph(text: string, align?: string): PmNode {
  const { text: words, attrs } = blockAttributes(text.trim());
  if (align && !attrs.textAlign) attrs.textAlign = align;
  const content = parseInline(words.trim());
  const withAttrs = Object.keys(attrs).length ? { attrs } : {};
  return content.length ? { type: "paragraph", ...withAttrs, content } : { type: "paragraph", ...withAttrs };
}

/** The look on the line after a table, as table attributes and a fill for each row. */
function tableLook(line: string | undefined) {
  const match = TABLE_ATTRIBUTES.exec(line?.trim() ?? "");
  if (!match) return null;
  const values = new Map<string, string>();
  for (const pair of match[1]!.trim().split(/\s+(?=[a-z-]+\s*=)/i)) {
    const [key, value] = pair.split("=").map((part) => part.trim());
    if (key && value) values.set(key.toLowerCase(), value);
  }
  const preset = TABLE_STYLES[values.get("style") as keyof typeof TABLE_STYLES];
  const lines = (values.get("lines") ?? preset?.lines ?? null) as TableLines | null;
  const color = (key: string) => {
    const value = values.get(key);
    return value && HEX_COLOR.test(value) ? value.toUpperCase() : null;
  };
  const header = values.has("header-fill") ? color("header-fill") : (preset?.header ?? null);
  const band = values.has("band-fill") ? color("band-fill") : (preset?.band ?? null);
  const lineColor = color("line-color");
  if (lines !== null && !["grid", "horizontal", "outer", "none"].includes(lines)) return null;
  const filled = Boolean(preset) || values.has("header-fill") || values.has("band-fill");
  if (!filled && lines === null && !lineColor) return null;
  return {
    attrs: {
      ...(lines ? { lines, borderless: lines === "none" } : {}),
      ...(lineColor ? { lineColor } : {}),
      ...(filled ? { fillsSet: true } : {}),
    },
    fills: filled ? { header, band } : null,
  };
}

const COLUMN_ALIGN = (cell: string) => {
  const trimmed = cell.trim();
  if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
  if (trimmed.endsWith(":")) return "right";
  return undefined;
};

/**
 * Footnotes written the GitHub way, [^1] in the text and "[^1]: the note" on a
 * line of its own, become inline notes, ^[the note], where the reference is.
 */
function inlineNoteDefinitions(markdown: string) {
  const definitions = new Map<string, string>();
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    const opening = FENCE.exec(line)?.[1] ?? null;
    if (fence) {
      if (line.trim().startsWith(fence)) fence = null;
    } else if (opening) fence = opening;
    else {
      const definition = NOTE_DEFINITION.exec(line.trim());
      if (definition) {
        definitions.set(definition[1]!, definition[2]!);
        continue;
      }
    }
    kept.push(line);
  }
  if (!definitions.size) return markdown;
  const escape = (text: string) => text.replace(/([\\\[\]])/g, "\\$1");
  fence = null;
  return kept
    .map((line) => {
      const opening = FENCE.exec(line)?.[1] ?? null;
      if (fence) {
        if (line.trim().startsWith(fence)) fence = null;
        return line;
      }
      if (opening) {
        fence = opening;
        return line;
      }
      return line.replace(/\[\^([^\]\s]+)\]/g, (whole, label: string) =>
        definitions.has(label) ? `^[${escape(definitions.get(label)!)}]` : whole,
      );
    })
    .join("\n");
}

function parseList(lines: string[], start: number): { node: PmNode; next: number } {
  const first = LIST_ITEM.exec(lines[start]!)!;
  const baseIndent = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  const task = /^\[[ xX]\]\s/.test(first[3]!);
  const items: PmNode[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index]!;
    const match = LIST_ITEM.exec(line);
    if (!match || match[1]!.length !== baseIndent) break;
    if (/\d/.test(match[2]!) !== ordered) break;
    let text = match[3]!;
    let checked: boolean | undefined;
    if (task) {
      const box = /^\[([ xX])\]\s+(.*)$/.exec(text);
      if (!box) break;
      checked = box[1] !== " ";
      text = box[2]!;
    }
    index += 1;
    // Continuation lines and nested lists belong to this item.
    const childLines: string[] = [];
    while (index < lines.length) {
      const next = lines[index]!;
      if (!next.trim()) {
        const after = lines[index + 1];
        if (after !== undefined && indentOf(after) > baseIndent && after.trim()) {
          childLines.push("");
          index += 1;
          continue;
        }
        break;
      }
      if (indentOf(next) > baseIndent) {
        childLines.push(next.slice(Math.min(indentOf(next), baseIndent + 2)));
        index += 1;
        continue;
      }
      if (!isBlockStart(next) && !LIST_ITEM.test(next)) {
        text += `\n${next.trim()}`;
        index += 1;
        continue;
      }
      break;
    }
    const content: PmNode[] = [paragraph(text)];
    if (childLines.some((child) => child.trim())) content.push(...parseBlocks(childLines.join("\n"), true));
    items.push(
      task
        ? { type: "taskItem", attrs: { checked: Boolean(checked) }, content }
        : { type: "listItem", content },
    );
  }
  const type = task ? "taskList" : ordered ? "orderedList" : "bulletList";
  const startNumber = ordered ? Number.parseInt(first[2]!, 10) : 1;
  return {
    node: {
      type,
      ...(ordered && startNumber !== 1 ? { attrs: { start: startNumber } } : {}),
      content: items,
    },
    next: index,
  };
}

/** Dollars for maths written with backslash brackets, which Markdown would read as escapes. Code fences stay as written. */
function normalizeMathOutsideFences(markdown: string) {
  const parts: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (prose.length) parts.push(normalizeMath(prose.join("\n")));
    prose = [];
  };
  for (const line of markdown.split("\n")) {
    const opening = FENCE.exec(line)?.[1] ?? null;
    if (fence) {
      parts.push(line);
      if (line.trim().startsWith(fence)) fence = null;
    } else if (opening) {
      flush();
      fence = opening;
      parts.push(line);
    } else prose.push(line);
  }
  flush();
  return parts.join("\n");
}

export function parseBlocks(markdown: string, nested = false): PmNode[] {
  const normalised = normalizeMathOutsideFences(markdown.replace(/\r\n?/g, "\n"));
  const lines = (nested ? normalised : inlineNoteDefinitions(normalised)).split("\n");
  const nodes: PmNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    const keep = KEEP_MARKER.exec(trimmed);
    if (keep) {
      nodes.push({ type: "__keep", attrs: { id: keep[1] } });
      index += 1;
      continue;
    }
    if (PAGE_BREAK.test(trimmed)) {
      nodes.push({ type: "pageBreak" });
      index += 1;
      continue;
    }
    if (TOC.test(trimmed)) {
      nodes.push({ type: "__toc" });
      index += 1;
      continue;
    }
    const heading = /^(#{1,6})(?:\s+(.*?))?\s*#*\s*$/.exec(trimmed);
    if (heading) {
      const { text: title, attrs: extra } = blockAttributes(heading[2] ?? "");
      const content = parseInline(title.trim());
      nodes.push({
        type: "heading",
        attrs: { level: Math.min(3, heading[1]!.length), ...(typeof extra.textAlign === "string" ? { textAlign: extra.textAlign } : {}) },
        ...(content.length ? { content } : {}),
      });
      index += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.trim().startsWith(marker)) {
        body.push(lines[index]!);
        index += 1;
      }
      index += 1;
      const text = body.join("\n");
      nodes.push({
        type: "codeBlock",
        attrs: { language: fence[2] || null },
        ...(text ? { content: [{ type: "text", text }] } : {}),
      });
      continue;
    }
    if (trimmed.startsWith("$$")) {
      let latex = trimmed.slice(2);
      if (latex.trimEnd().endsWith("$$") && latex.trim().length > 2) {
        latex = latex.trimEnd().slice(0, -2);
        index += 1;
      } else {
        const body: string[] = latex.trim() ? [latex] : [];
        index += 1;
        while (index < lines.length && !lines[index]!.trimEnd().endsWith("$$")) {
          body.push(lines[index]!);
          index += 1;
        }
        if (index < lines.length) {
          const last = lines[index]!.trimEnd().slice(0, -2);
          if (last.trim()) body.push(last);
          index += 1;
        }
        latex = body.join("\n");
      }
      nodes.push({ type: "equation", attrs: { latex: latex.trim(), display: "block", alignment: "center" } });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      nodes.push({ type: "horizontalRule" });
      index += 1;
      continue;
    }
    if (trimmed.startsWith(">")) {
      const body: string[] = [];
      while (index < lines.length && lines[index]!.trim().startsWith(">")) {
        body.push(lines[index]!.trim().replace(/^>\s?/, ""));
        index += 1;
      }
      const callout = /^\[!(\w+)\]\s*(.*)$/.exec(body[0] ?? "");
      if (callout) {
        const inner = [callout[2]!, ...body.slice(1)].join("\n");
        const content = parseBlocks(inner, true);
        nodes.push({
          type: "callout",
          attrs: { type: CALLOUT_TYPES[callout[1]!.toLowerCase()] ?? "info" },
          content: content.length ? content : [{ type: "paragraph" }],
        });
      } else {
        const content = parseBlocks(body.join("\n"), true);
        nodes.push({ type: "blockquote", content: content.length ? content : [{ type: "paragraph" }] });
      }
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const list = parseList(lines, index);
      nodes.push(list.node);
      index = list.next;
      continue;
    }
    if (
      trimmed.startsWith("|") &&
      /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[index + 1] ?? "")
    ) {
      const rows: string[][] = [tableCells(line)];
      const aligns = tableCells(lines[index + 1]!).map(COLUMN_ALIGN);
      index += 2;
      while (index < lines.length && lines[index]!.trim().startsWith("|")) {
        rows.push(tableCells(lines[index]!));
        index += 1;
      }
      const look = tableLook(lines[index]);
      if (look) index += 1;
      const width = Math.max(...rows.map((row) => row.length));
      nodes.push({
        type: "table",
        ...(look && Object.keys(look.attrs).length ? { attrs: look.attrs } : {}),
        content: rows.map((row, rowIndex) => {
          // Body rows alternate from the first: the second, fourth… take the band.
          const fill = !look?.fills ? undefined : rowIndex === 0 ? look.fills.header : rowIndex % 2 === 0 ? look.fills.band : null;
          return {
            type: "tableRow",
            content: Array.from({ length: width }, (_unused, cellIndex) => ({
              type: rowIndex === 0 ? "tableHeader" : "tableCell",
              ...(fill ? { attrs: { background: fill } } : {}),
              content: [paragraph(row[cellIndex] ?? "", aligns[cellIndex])],
            })),
          };
        }),
      });
      continue;
    }
    const body: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index]!.trim() && !isBlockStart(lines[index]!)) {
      body.push(lines[index]!);
      index += 1;
    }
    nodes.push(paragraph(body.map((entry) => entry.replace(/^ +/, "")).join("\n")));
  }
  return nodes;
}

// ---------------------------------------------------------------- serialise

function escapeText(text: string) {
  return text
    .replace(/([\\`*_[\]]|~~|==|\$)/g, "\\$1")
    .replace(/\^(?=\\\[)/g, "\\^")
    .replace(/<(?=\/?(?:u|sup|sub|span)[\s>])/gi, "\\<");
}

const MARK_ORDER = ["link", "textStyle", "bold", "italic", "strike", "highlight", "underline", "superscript", "subscript", "code"];

/** A text colour Markdown writes: a colour and nothing else on the mark (a Word font stays unwritten). */
export function writtenColor(mark: PmMark) {
  if (mark.type !== "textStyle") return null;
  const color = mark.attrs?.color;
  if (typeof color !== "string" || !HEX_COLOR.test(color)) return null;
  const others = Object.entries(mark.attrs ?? {}).filter(([key, value]) => key !== "color" && value !== null && value !== undefined);
  return others.length ? null : color.toUpperCase();
}

/** True for a mark Markdown writes itself. */
export function isWrittenMark(mark: PmMark) {
  return MARK_ORDER.includes(mark.type) && (mark.type !== "textStyle" || writtenColor(mark) !== null);
}

function wrap(text: string, mark: PmMark) {
  switch (mark.type) {
    case "bold":
      return `**${text}**`;
    case "italic":
      return `*${text}*`;
    case "strike":
      return `~~${text}~~`;
    case "highlight":
      return `==${text}==`;
    case "underline":
      return `<u>${text}</u>`;
    case "superscript":
      return `<sup>${text}</sup>`;
    case "subscript":
      return `<sub>${text}</sub>`;
    case "textStyle": {
      const color = writtenColor(mark);
      return color ? `<span style="color: ${color}">${text}</span>` : text;
    }
    case "link":
      return `[${text}](${String(mark.attrs?.href ?? "")})`;
    default:
      return text;
  }
}

export function serializeInline(nodes: PmNode[] | undefined): string {
  let out = "";
  for (const node of nodes ?? []) {
    if (node.type === "text") {
      const marks = [...(node.marks ?? [])].sort(
        (left, right) => MARK_ORDER.indexOf(right.type) - MARK_ORDER.indexOf(left.type),
      );
      const code = marks.some((mark) => mark.type === "code");
      let text = code ? `\`${node.text ?? ""}\`` : escapeText(node.text ?? "");
      // Whitespace at a mark's edge is not valid Markdown; keep it outside.
      const lead = /^\s*/.exec(text)![0];
      const trail = /\s*$/.exec(text)![0];
      let core = text.slice(lead.length, text.length - trail.length || undefined);
      if (core) {
        for (const mark of marks) if (mark.type !== "code") core = wrap(core, mark);
        text = `${lead}${core}${trail}`;
      }
      out += text;
    } else if (node.type === "hardBreak") out += "  \n";
    else if (node.type === "inlineEquation" || node.type === "equation")
      out += `$${String(node.attrs?.latex ?? "")}$`;
    else if (node.type === "footnote")
      out += `^[${String(node.attrs?.text ?? "").replace(/([\\[\]])/g, "\\$1")}]`;
    else if (node.type === "spectraCitation") {
      const where = typeof node.attrs?.evidenceSpanId === "string" && node.attrs.evidenceSpanId ? `:${node.attrs.evidenceSpanId}` : "";
      out += `[[cite:${String(node.attrs?.sourceId ?? "")}${where}|${String(node.attrs?.label ?? "Source")}]]`;
    } else if (node.content) out += serializeInline(node.content);
    else if (typeof node.attrs?.label === "string") out += node.attrs.label;
    else if (typeof node.attrs?.alt === "string") out += node.attrs.alt;
  }
  return out;
}

function indentLines(text: string, prefix: string) {
  return text
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : line))
    .join("\n");
}

const CALLOUT_NAMES: Record<string, string> = { info: "note", success: "tip", tip: "tip", warning: "warning" };

/** A node Markdown cannot express: kept by id, shown as a marker. */
function keepMarker(id: string, node: PmNode) {
  const label =
    (typeof node.attrs?.label === "string" && node.attrs.label) ||
    (typeof node.attrs?.title === "string" && node.attrs.title) ||
    (node.type === "paragraph" ? "blank line" : node.type);
  return `<!-- keep:${id} ${String(label).replace(/--+/g, "-").slice(0, 80)} -->`;
}

const MARKDOWN_NODES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "listItem",
  "taskItem",
  "blockquote",
  "callout",
  "codeBlock",
  "equation",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "horizontalRule",
  "text",
  "hardBreak",
  "inlineEquation",
  "pageBreak",
  "footnote",
]);

/** True when a node (and everything in it) has a Markdown form. */
export function expressibleInMarkdown(node: PmNode): boolean {
  // A citation Spectra made round-trips as [[cite:…]]; one imported from Word
  // carries its native field and stays kept as it is.
  if (node.type === "spectraCitation") return !node.attrs?.native && typeof node.attrs?.sourceId === "string" && Boolean(node.attrs.sourceId);
  // A note Word wrote keeps its own formatted content; one Spectra made is its words.
  if (node.type === "footnote") return !node.attrs?.nativeNoteId && !node.attrs?.nativeReadOnly && !node.attrs?.noteContent;
  if (!MARKDOWN_NODES.has(node.type)) return false;
  return (node.content ?? []).every(expressibleInMarkdown);
}

export function serializeBlock(node: PmNode): string {
  switch (node.type) {
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(node.attrs?.level) || 2));
      return `${"#".repeat(level)} ${serializeInline(node.content)}${attributeSuffix(node, false)}`;
    }
    case "paragraph":
      return `${serializeInline(node.content)}${attributeSuffix(node, true)}`;
    case "pageBreak":
      return "[[page-break]]";
    case "bulletList":
    case "orderedList":
    case "taskList": {
      const start = Number(node.attrs?.start) || 1;
      return (node.content ?? [])
        .map((item, index) => {
          const marker =
            node.type === "orderedList"
              ? `${start + index}.`
              : node.type === "taskList"
                ? `- [${item.attrs?.checked ? "x" : " "}]`
                : "-";
          const [first, ...rest] = item.content ?? [];
          const head = first?.type === "paragraph" ? serializeInline(first.content) : first ? serializeBlock(first) : "";
          const children = rest.map(serializeBlock).filter(Boolean).join("\n");
          return `${marker} ${head}${children ? `\n${indentLines(children, "  ")}` : ""}`;
        })
        .join("\n");
    }
    case "blockquote":
      return indentLines(serializeBlocks(node.content ?? []), "> ").replace(/^$/gm, ">");
    case "callout": {
      const name = CALLOUT_NAMES[String(node.attrs?.type ?? "info")] ?? "note";
      const body = serializeBlocks(node.content ?? []);
      return indentLines(`[!${name}] ${body}`, "> ").replace(/^$/gm, ">");
    }
    case "codeBlock": {
      const text = serializeInlinePlain(node.content);
      return `\`\`\`${String(node.attrs?.language ?? "")}\n${text}\n\`\`\``;
    }
    case "equation":
      return `$$\n${String(node.attrs?.latex ?? "")}\n$$`;
    case "horizontalRule":
      return "---";
    case "table": {
      const rows = (node.content ?? []).map((row) =>
        (row.content ?? []).map((cell) =>
          (cell.content ?? [])
            .map((child) => (child.type === "paragraph" ? `${serializeInline(child.content)}${attributeSuffix(child, true, true)}` : serializeBlock(child)))
            .join(" ")
            .replace(/\|/g, "\\|")
            .replace(/\n+/g, " "),
        ),
      );
      if (!rows.length) return "";
      const width = Math.max(...rows.map((row) => row.length));
      const line = (row: string[]) =>
        `| ${Array.from({ length: width }, (_unused, index) => row[index] ?? "").join(" | ")} |`;
      const aligns = Array.from({ length: width }, (_unused, column) => columnAlign(node, column));
      const rule = aligns.map((align) => (align === "center" ? ":---:" : align === "right" ? "---:" : "---"));
      const look = tableLookLine(node);
      return [line(rows[0]!), `| ${rule.join(" | ")} |`, ...rows.slice(1).map(line), ...(look ? [look] : [])].join("\n");
    }
    default:
      return serializeInline(node.content);
  }
}

function alignOf(node: PmNode | undefined) {
  const align = node?.attrs?.textAlign;
  return typeof align === "string" && ALIGNMENTS.has(align) && align !== "left" ? align : undefined;
}

/** The {.center .caption} a paragraph or heading carries; a table cell's alignment is its column's. */
function attributeSuffix(node: PmNode, paragraphStyles: boolean, inCell = false) {
  const names: string[] = [];
  if (paragraphStyles && (node.attrs?.blockStyle === "caption" || node.attrs?.styleId === "Caption")) names.push("caption");
  const align = alignOf(node);
  if (align && !inCell) names.push(align);
  return names.length ? ` {${names.map((name) => `.${name}`).join(" ")}}` : "";
}

const cellParagraph = (cell: PmNode | undefined) => cell?.content?.find((child) => child.type === "paragraph");

/** A column's alignment when every cell in it shares one. */
function columnAlign(table: PmNode, column: number) {
  const aligns = new Set((table.content ?? []).map((row) => alignOf(cellParagraph(row.content?.[column]))));
  const [only] = aligns;
  return aligns.size === 1 ? only : undefined;
}

/** The look line for a table whose lines or fills were chosen in Spectra. */
function tableLookLine(table: PmNode) {
  const attrs = table.attrs ?? {};
  const lines = typeof attrs.lines === "string" ? attrs.lines : null;
  const lineColor = typeof attrs.lineColor === "string" && HEX_COLOR.test(attrs.lineColor) ? attrs.lineColor.toUpperCase() : null;
  if (!lines && !lineColor && !attrs.fillsSet) return "";
  const rows = table.content ?? [];
  const rowFill = (row: PmNode) => {
    const fills = new Set((row.content ?? []).map((cell) => (typeof cell.attrs?.background === "string" ? cell.attrs.background.toUpperCase() : null)));
    return fills.size === 1 ? [...fills][0]! : undefined;
  };
  const headed = rows[0]?.content?.[0]?.type === "tableHeader";
  const header = headed && rows[0] ? rowFill(rows[0]) : null;
  const body = rows.slice(headed ? 1 : 0);
  const band = body[1] ? rowFill(body[1]) : null;
  const regular =
    header !== undefined &&
    band !== undefined &&
    body.every((row, index) => rowFill(row) === (index % 2 === 1 ? band : null));
  const fills = attrs.fillsSet && regular ? { header: header ?? null, band: band ?? null } : null;
  const shownLines = lines ?? (attrs.borderless ? "none" : "grid");
  if (!lineColor && fills) {
    const preset = Object.entries(TABLE_STYLES).find(
      ([, style]) => style.lines === shownLines && style.header === fills.header && style.band === fills.band,
    );
    if (preset) return `{style=${preset[0]}}`;
  }
  const parts = [`lines=${shownLines}`];
  if (lineColor) parts.push(`line-color=${lineColor}`);
  if (fills?.header) parts.push(`header-fill=${fills.header}`);
  if (fills?.band) parts.push(`band-fill=${fills.band}`);
  return `{${parts.join(" ")}}`;
}

function serializeInlinePlain(nodes: PmNode[] | undefined): string {
  return (nodes ?? []).map((node) => node.text ?? (node.type === "hardBreak" ? "\n" : serializeInlinePlain(node.content))).join("");
}

export function serializeBlocks(nodes: PmNode[]): string {
  return nodes.map(serializeBlock).join("\n\n");
}

export { KEEP_MARKER, keepMarker };
