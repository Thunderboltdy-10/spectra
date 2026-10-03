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
 *   | a | b |               table (first row is the header)
 *   ---                     divider
 *   **b** *i* ~~s~~ `c` ==h== <u>u</u> [t](url) $x^2$   inline marks
 *
 * Anything Markdown cannot express (a live reference, a citation, an image)
 * is shown as a keep marker, `<!-- keep:ID label -->`. Leaving the marker in
 * place keeps the original node exactly; deleting it removes the node.
 */

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
    if (char === "\\" && index + 1 < source.length && /[\\`*_{}[\]()#+\-.!|~=$<>]/.test(source[index + 1]!)) {
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
    if (char === "[") {
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

function isBlockStart(line: string) {
  const trimmed = line.trim();
  return (
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

function paragraph(text: string): PmNode {
  const content = parseInline(text.trim());
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
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
    if (childLines.some((child) => child.trim())) content.push(...parseBlocks(childLines.join("\n")));
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

export function parseBlocks(markdown: string): PmNode[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
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
    const heading = /^(#{1,6})(?:\s+(.*?))?\s*#*\s*$/.exec(trimmed);
    if (heading) {
      const content = parseInline(heading[2] ?? "");
      nodes.push({
        type: "heading",
        attrs: { level: Math.min(3, heading[1]!.length) },
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
        const content = parseBlocks(inner);
        nodes.push({
          type: "callout",
          attrs: { type: CALLOUT_TYPES[callout[1]!.toLowerCase()] ?? "info" },
          content: content.length ? content : [{ type: "paragraph" }],
        });
      } else {
        const content = parseBlocks(body.join("\n"));
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
      index += 2;
      while (index < lines.length && lines[index]!.trim().startsWith("|")) {
        rows.push(tableCells(lines[index]!));
        index += 1;
      }
      const width = Math.max(...rows.map((row) => row.length));
      nodes.push({
        type: "table",
        content: rows.map((row, rowIndex) => ({
          type: "tableRow",
          content: Array.from({ length: width }, (_unused, cellIndex) => ({
            type: rowIndex === 0 ? "tableHeader" : "tableCell",
            content: [paragraph(row[cellIndex] ?? "")],
          })),
        })),
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
  return text.replace(/([\\`*_[\]]|~~|==|\$)/g, "\\$1");
}

const MARK_ORDER = ["link", "bold", "italic", "strike", "highlight", "underline", "code"];

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
    else if (node.content) out += serializeInline(node.content);
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
    node.type;
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
]);

/** True when a node (and everything in it) has a Markdown form. */
export function expressibleInMarkdown(node: PmNode): boolean {
  if (!MARKDOWN_NODES.has(node.type)) return false;
  return (node.content ?? []).every(expressibleInMarkdown);
}

export function serializeBlock(node: PmNode): string {
  switch (node.type) {
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(node.attrs?.level) || 2));
      return `${"#".repeat(level)} ${serializeInline(node.content)}`;
    }
    case "paragraph":
      return serializeInline(node.content);
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
            .map((child) => (child.type === "paragraph" ? serializeInline(child.content) : serializeBlock(child)))
            .join(" ")
            .replace(/\|/g, "\\|")
            .replace(/\n+/g, " "),
        ),
      );
      if (!rows.length) return "";
      const width = Math.max(...rows.map((row) => row.length));
      const line = (row: string[]) =>
        `| ${Array.from({ length: width }, (_unused, index) => row[index] ?? "").join(" | ")} |`;
      return [line(rows[0]!), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
    }
    default:
      return serializeInline(node.content);
  }
}

function serializeInlinePlain(nodes: PmNode[] | undefined): string {
  return (nodes ?? []).map((node) => node.text ?? (node.type === "hardBreak" ? "\n" : serializeInlinePlain(node.content))).join("");
}

export function serializeBlocks(nodes: PmNode[]): string {
  return nodes.map(serializeBlock).join("\n\n");
}

export { KEEP_MARKER, keepMarker };
