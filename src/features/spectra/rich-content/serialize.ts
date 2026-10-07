import type { RichBlock, RichCalloutTone, RichInline, RichMark, SpectraRichContentAst } from "./ast";

/*
 * The shared model written back out: as Markdown, for the surfaces that store
 * Markdown (notes, task and plan descriptions), and as plain text, for the
 * places that only need the words (selectors, rails, labels, previews).
 *
 * The Markdown is what `parseSpectraRichContent` reads back to the same
 * model, so a field edited in a TipTap editor and stored as Markdown keeps
 * its lists, checklists, quotes, code and math across saves.
 */

// ---------------------------------------------------------------------------
// Markdown

const MARK_ORDER: RichMark[] = ["bold", "italic", "strike", "underline"];
const OPEN: Record<RichMark, string> = { bold: "**", italic: "*", strike: "~~", underline: "<u>" };
const CLOSE: Record<RichMark, string> = { bold: "**", italic: "*", strike: "~~", underline: "</u>" };
const WORD = /[\p{L}\p{N}]/u;
const TONE_ALERT: Record<RichCalloutTone, string> = { info: "NOTE", tip: "TIP", warning: "WARNING" };

function escapeText(text: string, mathDollars: boolean) {
  let output = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    // `]` stays bare: escaped alongside `\[` it would read as display math.
    if (char === "\\" || char === "*" || char === "`" || char === "[" || char === "~") output += `\\${char}`;
    else if (char === "_" && !(WORD.test(text[index - 1] ?? "") && WORD.test(text[index + 1] ?? ""))) output += "\\_";
    else if (char === "$" && mathDollars) output += "\\$";
    else if (char === "<" && /^<(?:u>|\/u>|br|https?:)/i.test(text.slice(index))) output += "\\<";
    else output += char;
  }
  return output;
}

function codeSpan(code: string) {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = code.startsWith("`") || code.endsWith("`") || (code.startsWith(" ") && code.endsWith(" ") && code.trim()) ? " " : "";
  return `${fence}${pad}${code}${pad}${fence}`;
}

function destination(url: string) {
  return /[\s()<>]/.test(url) ? `<${url.replace(/>/g, "%3E")}>` : url;
}

/** Inline content as Markdown, with marks nested across neighbouring runs. */
function inlinesToMarkdown(content: readonly RichInline[]): string {
  const dollars = content.reduce((count, inline) => count + (inline.type === "text" ? (inline.text.match(/\$/g) ?? []).length : 0), 0) > 1;
  let output = "";
  let open: RichMark[] = [];
  let pendingSpace = "";
  const closeTo = (keep: readonly RichMark[]) => {
    let index = open.findIndex((mark) => !keep.includes(mark));
    if (index < 0) index = open.length;
    for (let mark = open.length - 1; mark >= index; mark -= 1) output += CLOSE[open[mark]!];
    open = open.slice(0, index);
  };
  const openTo = (marks: readonly RichMark[]) => {
    for (const mark of MARK_ORDER) {
      if (marks.includes(mark) && !open.includes(mark)) {
        output += OPEN[mark];
        open.push(mark);
      }
    }
  };
  for (const inline of content) {
    if (inline.type === "text") {
      const [, leading = "", core = "", trailing = ""] = inline.text.match(/^(\s*)([\s\S]*?)(\s*)$/) ?? [];
      // Whitespace sits outside the marks around it, so a delimiter always
      // touches a word.
      if (!core) { pendingSpace += inline.text; continue; }
      const marks = inline.marks ?? [];
      closeTo(marks);
      output += pendingSpace + leading;
      pendingSpace = "";
      openTo(marks);
      output += escapeText(core, dollars);
      pendingSpace = trailing;
      continue;
    }
    closeTo([]);
    output += pendingSpace;
    pendingSpace = "";
    switch (inline.type) {
      case "inline_code":
        output += codeSpan(inline.code);
        break;
      case "inline_math":
        output += `$${inline.math}$`;
        break;
      case "link": {
        const label = inlinesToMarkdown(inline.content);
        output += `[${label || escapeText(inline.href, false)}](${destination(inline.href)})`;
        break;
      }
      case "citation":
        output += `[[cite:${inline.sourceId}:${inline.evidenceIds.join(",") || "source"}${inline.label ? `|${inline.label}` : ""}]]`;
        break;
      case "reference":
        output += `[[ref:${inline.workId}${inline.label ? `|${inline.label}` : ""}]]`;
        break;
      case "footnote_ref":
        output += `[^${inline.id}]`;
        break;
      case "image":
        output += `![${inline.alt}](${destination(inline.url)})`;
        break;
      // Markdown has no tracked changes or comments: a deletion reads struck
      // through, everything else as its own text.
      case "revision": {
        const inner = inlinesToMarkdown(inline.content);
        if (inner) output += inline.kind === "delete" ? `~~${inner}~~` : inner;
        break;
      }
      case "comment":
        output += inlinesToMarkdown(inline.content);
        break;
      case "comment_ref":
        break;
      case "break":
        output += "\n";
        break;
    }
  }
  closeTo([]);
  return output + pendingSpace.replace(/\n/g, "");
}

/** Escapes what would start a different block at the beginning of a line. */
function guardLineStarts(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => line
      .replace(/^(\s*)(#{1,6}(?:\s|$)|>|[-+](?:\s|$)|\$\$|\|)/, "$1\\$2")
      .replace(/^(\s*)(\d{1,9})([.)])(\s|$)/, "$1$2\\$3$4")
      .replace(/^(\s*)Source:/i, (_match, space: string) => `${space}Source\\:`)
      .replace(/^(\s*)!\[/, "$1\\![")
      .replace(/^(\s*)(-{3,}|_{3,}|={3,})\s*$/, "$1\\$2"))
    .join("\n");
}

function prefixLines(text: string, first: string, rest: string) {
  return text.split("\n").map((line, index) => (index ? (line ? rest + line : rest.trimEnd()) : first + line)).join("\n");
}

function tableCell(content: readonly RichInline[]) {
  return inlinesToMarkdown(content.map((inline) => (inline.type === "break" ? { type: "text", text: " " } : inline))).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function blockToMarkdown(block: RichBlock): string {
  switch (block.type) {
    case "paragraph":
      return guardLineStarts(inlinesToMarkdown(block.content));
    case "heading":
      return `${"#".repeat(block.level)} ${inlinesToMarkdown(block.content.map((inline) => (inline.type === "break" ? { type: "text", text: " " } : inline)))}`.trimEnd();
    case "list":
      return block.items.map((item, index) => {
        const marker = block.kind === "ordered" ? `${(block.start ?? 1) + index}. ` : block.kind === "task" ? `- [${item.checked ? "x" : " "}] ` : "- ";
        const indent = " ".repeat(block.kind === "ordered" ? marker.length : 2);
        const body = item.blocks.map((child, childIndex) => (childIndex && child.type !== "list" ? "\n" : "") + blockToMarkdown(child)).join("\n");
        return prefixLines(body, marker, indent).trimEnd() || marker.trimEnd();
      }).join("\n");
    case "quote":
      return prefixLines(blocksToMarkdown(block.blocks), "> ", "> ").replace(/^> $/gm, ">");
    case "callout":
      return prefixLines(`[!${TONE_ALERT[block.tone]}]\n${blocksToMarkdown(block.blocks)}`.trimEnd(), "> ", "> ").replace(/^> $/gm, ">");
    case "code_block": {
      const longest = Math.max(2, ...(block.code.match(/`+/g) ?? []).map((run) => run.length));
      const fence = "`".repeat(longest + 1);
      return `${fence}${block.language ?? ""}\n${block.code}\n${fence}`;
    }
    case "math_block":
      return `$$\n${block.math}\n$$`;
    case "table": {
      const [head = [], ...rows] = block.rows;
      const width = Math.max(1, ...block.rows.map((row) => row.length));
      const row = (cells: readonly RichInline[][]) => `| ${Array.from({ length: width }, (_, index) => tableCell(cells[index] ?? [])).join(" | ")} |`;
      return [row(head), `|${" --- |".repeat(width)}`, ...rows.map(row)].join("\n");
    }
    case "media":
      return `![${block.alt}](${destination(block.url)})`;
    case "embed":
      return block.workId ? `[[ref:${block.workId}${block.label ? `|${block.label}` : ""}]]` : "";
    case "rule":
      return "---";
    case "source_note":
      return `Source: ${inlinesToMarkdown(block.content)}`;
    case "footnote":
      return `[^${block.footnoteId}]: ${inlinesToMarkdown(block.content)}`;
  }
}

function blocksToMarkdown(blocks: readonly RichBlock[]) {
  return blocks.map(blockToMarkdown).filter((text) => text.length > 0).join("\n\n");
}

/** The shared model as the Markdown its parser reads back. */
export function richContentToMarkdown(ast: SpectraRichContentAst): string {
  return blocksToMarkdown(ast.blocks);
}

// ---------------------------------------------------------------------------
// Plain text

function inlinesToText(content: readonly RichInline[]): string {
  return content.map((inline) => {
    switch (inline.type) {
      case "text": return inline.text;
      case "inline_code": return inline.code;
      case "inline_math": return inline.math;
      case "link": return inlinesToText(inline.content) || inline.href;
      case "citation": return inline.label ? `[${inline.label}]` : "";
      case "reference": return inline.label ?? "";
      case "footnote_ref": return "";
      case "image": return inline.alt;
      case "break": return "\n";
      // The words as they would stand with every change accepted.
      case "revision": return inline.kind === "delete" ? "" : inlinesToText(inline.content);
      case "comment": return inlinesToText(inline.content);
      case "comment_ref": return "";
    }
  }).join("");
}

function blockToText(block: RichBlock): string {
  switch (block.type) {
    case "paragraph":
    case "heading":
    case "source_note":
    case "footnote":
      return inlinesToText(block.content);
    case "list":
      return block.items.map((item) => item.blocks.map(blockToText).filter(Boolean).join("\n")).join("\n");
    case "quote":
    case "callout":
      return block.blocks.map(blockToText).filter(Boolean).join("\n");
    case "code_block": return block.code;
    case "math_block": return block.math;
    case "table": return block.rows.map((row) => row.map(inlinesToText).join("\t")).join("\n");
    case "media": return block.alt;
    case "embed": return block.label ?? "";
    case "rule": return "";
  }
}

/** The words, one block per line: for selectors, labels and previews. */
export function richContentToPlainText(ast: SpectraRichContentAst): string {
  return ast.blocks.map(blockToText).filter(Boolean).join("\n").trim();
}
