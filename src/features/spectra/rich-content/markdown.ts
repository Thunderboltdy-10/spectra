import {
  identifyBlocks,
  richBlockSemanticKey,
  SPECTRA_RICH_CONTENT_VERSION,
  type RichBlock,
  type RichBlockDraft,
  type RichCalloutTone,
  type RichInline,
  type RichListItem,
  type RichMark,
  type SpectraRichContentAst,
} from "./ast";

/*
 * Markdown into the shared model.
 *
 * Replies, comments, notes and task descriptions are Markdown (GitHub
 * flavour, plus Spectra's `[[cite:…]]` and `[[ref:…]]`). This parser covers
 * what those surfaces write: headings, paragraphs, nested lists and
 * checklists, quotes and alerts, fenced code, display and inline math,
 * tables, rules, images, footnotes and the inline marks. A single newline
 * inside a paragraph is a line break, as in a comment box, everywhere.
 */

// ---------------------------------------------------------------------------
// Inline

const PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const WORD = /[\p{L}\p{N}]/u;
const CITATION = /^\[\[cite:([^:\]|]+)(?::([^\]|]+))?(?:\|([^\]]+))?\]\]/;
const REFERENCE = /^\[\[ref:([^\]|]+)(?:\|([^\]]+))?\]\]/;
const FOOTNOTE_REF = /^\[\^([^\]\s]+)\]/;
const AUTOLINK = /^<(https?:\/\/[^\s>]+)>/;
const BARE_URL = /^https?:\/\/[^\s<]*[^\s<.,:;"')\]!?*_~]/;

function pushText(output: RichInline[], text: string, marks: readonly RichMark[]) {
  if (!text) return;
  const last = output[output.length - 1];
  const same = last?.type === "text" && !last.style && (last.marks ?? []).join() === marks.join();
  if (same) {
    last.text += text;
    return;
  }
  output.push(marks.length ? { type: "text", text, marks: [...marks] } : { type: "text", text });
}

function withMark(marks: readonly RichMark[], mark: RichMark) {
  return marks.includes(mark) ? marks : [...marks, mark];
}

/** The end of a `[label](…)` label, honouring nested brackets and escapes. */
function closingBracket(text: string, open: number) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") { index += 1; continue; }
    if (char === "`") { const end = codeSpanEnd(text, index); if (end > 0) { index = end - 1; continue; } }
    if (char === "[") depth += 1;
    else if (char === "]") { depth -= 1; if (depth === 0) return index; }
  }
  return -1;
}

/** `(url "title")` after a link label: the url and where the destination ends. */
function linkDestination(text: string, open: number) {
  if (text[open] !== "(") return null;
  let index = open + 1;
  while (text[index] === " ") index += 1;
  let url = "";
  if (text[index] === "<") {
    const end = text.indexOf(">", index);
    if (end < 0) return null;
    url = text.slice(index + 1, end);
    index = end + 1;
  } else {
    let depth = 0;
    const start = index;
    while (index < text.length) {
      const char = text[index]!;
      if (char === "\\") { index += 2; continue; }
      if (char === "(") depth += 1;
      else if (char === ")") { if (depth === 0) break; depth -= 1; }
      else if (/\s/.test(char)) break;
      index += 1;
    }
    url = text.slice(start, index);
  }
  while (text[index] === " ") index += 1;
  if (text[index] === '"' || text[index] === "'") {
    const quote = text[index]!;
    const end = text.indexOf(quote, index + 1);
    if (end < 0) return null;
    index = end + 1;
    while (text[index] === " ") index += 1;
  }
  if (text[index] !== ")") return null;
  return { url, end: index + 1 };
}

/** Where a code span opened at `start` ends (exclusive), or -1. */
function codeSpanEnd(text: string, start: number) {
  let ticks = 0;
  while (text[start + ticks] === "`") ticks += 1;
  const fence = "`".repeat(ticks);
  let search = start + ticks;
  while (search < text.length) {
    const found = text.indexOf(fence, search);
    if (found < 0) return -1;
    let run = 0;
    while (text[found + run] === "`") run += 1;
    if (run === ticks) return found + ticks;
    search = found + run;
  }
  return -1;
}

/** `$…$`: the opener has text right after it, the closer text right before it and no digit after. */
function inlineMathEnd(text: string, start: number) {
  if (text[start + 1] === "$" || !text[start + 1] || /\s/.test(text[start + 1]!)) return -1;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") { index += 1; continue; }
    if (char === "\n") return -1;
    if (char === "$") {
      if (/\s/.test(text[index - 1]!) || /\d/.test(text[index + 1] ?? "")) return -1;
      return index + 1;
    }
  }
  return -1;
}

/**
 * The closing delimiter for emphasis opened at `start`, skipping code, math
 * and Spectra's bracketed tokens so a `*` inside them never closes it.
 */
function emphasisEnd(text: string, start: number, delimiter: string) {
  const char = delimiter[0]!;
  for (let index = start + delimiter.length; index < text.length; index += 1) {
    const current = text[index];
    if (current === "\\") { index += 1; continue; }
    if (current === "`") { const end = codeSpanEnd(text, index); if (end > 0) { index = end - 1; continue; } }
    if (current === "[" && text[index + 1] === "[") { const end = text.indexOf("]]", index); if (end > 0) { index = end + 1; continue; } }
    if (current === "$") { const end = inlineMathEnd(text, index); if (end > 0) { index = end - 1; continue; } }
    if (!text.startsWith(delimiter, index)) continue;
    // A longer run is a different delimiter (`**` never closes `*`), unless it closes both.
    const before = text[index - 1] ?? " ";
    if (/\s/.test(before) || index === start + delimiter.length) continue;
    if (char === "_" && WORD.test(text[index + delimiter.length] ?? "")) continue;
    if (delimiter.length === 1 && text[index + 1] === char && text[index + 2] !== char) {
      // `*a **b***`-style runs: let the double close first.
      index += 1;
      continue;
    }
    return index;
  }
  return -1;
}

const EMPHASIS: ReadonlyArray<[string, RichMark[]]> = [
  ["***", ["bold", "italic"]],
  ["___", ["bold", "italic"]],
  ["**", ["bold"]],
  ["__", ["bold"]],
  ["~~", ["strike"]],
  ["*", ["italic"]],
  ["_", ["italic"]],
];

export function parseMarkdownInlines(text: string, marks: readonly RichMark[] = []): RichInline[] {
  const output: RichInline[] = [];
  let plain = "";
  const flush = () => { pushText(output, plain, marks); plain = ""; };
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    const rest = text.slice(index);
    if (char === "\\") {
      const next = text[index + 1];
      if (next === "\n") { flush(); output.push({ type: "break" }); index += 2; continue; }
      if (next && PUNCTUATION.test(next)) { plain += next; index += 2; continue; }
    }
    if (char === "\n") {
      plain = plain.replace(/ +$/, "");
      flush();
      output.push({ type: "break" });
      index += 1;
      while (text[index] === " ") index += 1;
      continue;
    }
    if (char === "`") {
      const end = codeSpanEnd(text, index);
      if (end > 0) {
        let ticks = 0;
        while (text[index + ticks] === "`") ticks += 1;
        let code = text.slice(index + ticks, end - ticks);
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ")) code = code.slice(1, -1);
        flush();
        output.push({ type: "inline_code", code });
        index = end;
        continue;
      }
      let ticks = 0;
      while (text[index + ticks] === "`") ticks += 1;
      plain += text.slice(index, index + ticks);
      index += ticks;
      continue;
    }
    if (char === "[") {
      const citation = rest.match(CITATION);
      if (citation) {
        flush();
        output.push({ type: "citation", sourceId: citation[1]!, evidenceIds: (citation[2] ?? "").split(",").map((item) => item.trim()).filter(Boolean), ...(citation[3] ? { label: citation[3] } : {}) });
        index += citation[0].length;
        continue;
      }
      const reference = rest.match(REFERENCE);
      if (reference) {
        flush();
        output.push({ type: "reference", workId: reference[1]!, ...(reference[2] ? { label: reference[2] } : {}) });
        index += reference[0].length;
        continue;
      }
      const footnote = rest.match(FOOTNOTE_REF);
      if (footnote) {
        flush();
        output.push({ type: "footnote_ref", id: footnote[1]! });
        index += footnote[0].length;
        continue;
      }
      const close = closingBracket(text, index);
      const destination = close > 0 ? linkDestination(text, close + 1) : null;
      if (destination) {
        flush();
        output.push({ type: "link", href: destination.url, content: parseMarkdownInlines(text.slice(index + 1, close), marks) });
        index = destination.end;
        continue;
      }
    }
    if (char === "!" && text[index + 1] === "[") {
      const close = closingBracket(text, index + 1);
      const destination = close > 0 ? linkDestination(text, close + 1) : null;
      if (destination) {
        flush();
        output.push({ type: "image", url: destination.url, alt: text.slice(index + 2, close) });
        index = destination.end;
        continue;
      }
    }
    if (char === "<") {
      const autolink = rest.match(AUTOLINK);
      if (autolink) {
        flush();
        output.push({ type: "link", href: autolink[1]!, content: [{ type: "text", text: autolink[1]!, ...(marks.length ? { marks: [...marks] } : {}) }] });
        index += autolink[0].length;
        continue;
      }
      // Markdown has no underline; editors write it as <u>…</u>.
      if (rest.startsWith("<u>")) {
        const end = text.indexOf("</u>", index + 3);
        if (end > 0) {
          flush();
          output.push(...parseMarkdownInlines(text.slice(index + 3, end), withMark(marks, "underline")));
          index = end + 4;
          continue;
        }
      }
      if (/^<br\s*\/?>/i.test(rest)) {
        flush();
        output.push({ type: "break" });
        index += rest.match(/^<br\s*\/?>/i)![0].length;
        continue;
      }
    }
    if (char === "h" && !WORD.test(text[index - 1] ?? " ")) {
      const url = rest.match(BARE_URL);
      if (url) {
        flush();
        output.push({ type: "link", href: url[0], content: [{ type: "text", text: url[0], ...(marks.length ? { marks: [...marks] } : {}) }] });
        index += url[0].length;
        continue;
      }
    }
    if (char === "$") {
      const end = inlineMathEnd(text, index);
      if (end > 0) {
        flush();
        output.push({ type: "inline_math", math: text.slice(index + 1, end - 1), complete: true });
        index = end;
        continue;
      }
    }
    if (char === "*" || char === "_" || char === "~") {
      let matched = false;
      for (const [delimiter, added] of EMPHASIS) {
        if (!rest.startsWith(delimiter)) continue;
        const after = text[index + delimiter.length];
        if (!after || /\s/.test(after)) continue;
        if (char === "_" && WORD.test(text[index - 1] ?? " ")) continue;
        const end = emphasisEnd(text, index, delimiter);
        if (end < 0) continue;
        flush();
        let next = marks;
        for (const mark of added) next = withMark(next, mark);
        output.push(...parseMarkdownInlines(text.slice(index + delimiter.length, end), next));
        index = end + delimiter.length;
        matched = true;
        break;
      }
      if (matched) continue;
      let run = 0;
      while (text[index + run] === char) run += 1;
      plain += text.slice(index, index + run);
      index += run;
      continue;
    }
    plain += char;
    index += 1;
  }
  flush();
  return output;
}

// ---------------------------------------------------------------------------
// Blocks

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>/;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const MEDIA = /^!\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)\s*$/;
const FOOTNOTE = /^\[\^([^\]]+)\]:\s*(.*)$/;
const SOURCE_NOTE = /^Source:\s*(.+)$/i;
const ALERT = /^\[!(\w+)\][+-]?\s*(.*)$/;

const ALERT_TONES: Record<string, RichCalloutTone> = {
  note: "info", info: "info", important: "info",
  tip: "tip", success: "tip",
  warning: "warning", caution: "warning", danger: "warning",
};

function startsBlock(line: string) {
  return FENCE.test(line) || /^ {0,3}\$\$/.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line)
    || FOOTNOTE.test(line) || MEDIA.test(line) || /^\s*([-*+]|1[.)])\s+\S/.test(line);
}

function unindent(line: string, columns: number) {
  let removed = 0;
  while (removed < columns && line[removed] === " ") removed += 1;
  return line.slice(removed);
}

function splitRow(row: string) {
  const trimmed = row.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]!;
    if (char === "\\" && trimmed[index + 1] === "|") { current += "|"; index += 1; continue; }
    if (char === "`") {
      const end = codeSpanEnd(trimmed, index);
      if (end > 0) { current += trimmed.slice(index, end); index = end - 1; continue; }
    }
    if (char === "|") { cells.push(current.trim()); current = ""; continue; }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseListItems(lines: string[], start: number) {
  const first = lines[start]!.match(LIST_ITEM)!;
  const ordered = /\d/.test(first[2]!);
  const markerChar = ordered ? first[2]!.slice(-1) : first[2]!;
  const items: Array<{ lines: string[]; checked?: boolean }> = [];
  let line = start;
  let contentIndent = 0;
  let blankBefore = false;
  while (line < lines.length) {
    const current = lines[line]!;
    const marker = current.match(LIST_ITEM);
    const sameList = marker && marker[1]!.length < (items.length ? contentIndent : Infinity) && (ordered ? /\d/.test(marker[2]!) && marker[2]!.slice(-1) === markerChar : marker[2] === markerChar);
    if (sameList && marker) {
      const spacing = Math.min(4, (marker[3] ?? " ").length);
      contentIndent = marker[1]!.length + marker[2]!.length + spacing;
      let body = marker[4] ?? "";
      let checked: boolean | undefined;
      const task = body.match(/^\[([ xX])\](?:\s+|$)(.*)$/);
      if (task) { checked = task[1] !== " "; body = task[2]!; }
      items.push({ lines: [body], ...(checked === undefined ? {} : { checked }) });
      blankBefore = false;
      line += 1;
      continue;
    }
    if (!current.trim()) {
      // A blank line ends the list unless the next line still belongs to it.
      const next = lines[line + 1];
      if (next === undefined) break;
      const nextMarker = next.match(LIST_ITEM);
      const indented = next.length - next.trimStart().length >= contentIndent;
      const continues = indented || (nextMarker && (ordered ? /\d/.test(nextMarker[2]!) : nextMarker[2] === markerChar) && nextMarker[1]!.length < contentIndent);
      if (!continues) break;
      items[items.length - 1]!.lines.push("");
      blankBefore = true;
      line += 1;
      continue;
    }
    const indent = current.length - current.trimStart().length;
    if (indent >= contentIndent) {
      items[items.length - 1]!.lines.push(unindent(current, contentIndent));
      line += 1;
      continue;
    }
    // A lazy continuation line carries on the item's paragraph.
    if (!blankBefore && !startsBlock(current) && !LIST_ITEM.test(current)) {
      items[items.length - 1]!.lines.push(current.trim());
      line += 1;
      continue;
    }
    break;
  }
  return { ordered, start: ordered ? Number.parseInt(first[2]!, 10) : undefined, items, end: line };
}

function parseBlockDrafts(lines: string[]): RichBlockDraft[] {
  const blocks: RichBlockDraft[] = [];
  let line = 0;
  const nested = (source: string[]) => parseBlockDrafts(source);
  while (line < lines.length) {
    const current = lines[line]!;
    if (!current.trim()) { line += 1; continue; }

    const fence = current.match(FENCE);
    if (fence) {
      const start = line++;
      const marker = fence[1]!;
      while (line < lines.length && !new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`).test(lines[line]!)) line += 1;
      const complete = line < lines.length;
      if (complete) line += 1;
      blocks.push({ type: "code_block", raw: lines.slice(start, line).join("\n"), complete, ...(fence[2] ? { language: fence[2] } : {}), code: lines.slice(start + 1, complete ? line - 1 : line).join("\n") });
      continue;
    }

    if (/^ {0,3}\$\$/.test(current)) {
      const start = line;
      const single = current.trim().match(/^\$\$(.+)\$\$$/);
      if (single) {
        line += 1;
        blocks.push({ type: "math_block", raw: current, complete: true, math: single[1]!.trim() });
        continue;
      }
      line += 1;
      while (line < lines.length && !/\$\$\s*$/.test(lines[line]!)) line += 1;
      const complete = line < lines.length;
      if (complete) line += 1;
      const raw = lines.slice(start, line).join("\n");
      blocks.push({ type: "math_block", raw, complete, math: raw.trim().replace(/^\$\$\s*/, "").replace(/\s*\$\$$/, "").trim() });
      continue;
    }

    const heading = current.match(HEADING);
    if (heading) {
      blocks.push({ type: "heading", raw: current, level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, content: parseMarkdownInlines(heading[2] ?? "") });
      line += 1;
      continue;
    }

    if (RULE.test(current)) {
      blocks.push({ type: "rule", raw: current });
      line += 1;
      continue;
    }

    if (QUOTE.test(current)) {
      const start = line;
      const inner: string[] = [];
      while (line < lines.length && QUOTE.test(lines[line]!)) {
        inner.push(lines[line]!.replace(/^ {0,3}> ?/, ""));
        line += 1;
      }
      const raw = lines.slice(start, line).join("\n");
      const alert = inner[0]?.match(ALERT);
      const tone = alert ? ALERT_TONES[alert[1]!.toLowerCase()] : undefined;
      if (alert && tone) {
        const body = [alert[2] ?? "", ...inner.slice(1)];
        blocks.push({ type: "callout", raw, tone, blocks: nested(body) as RichBlock[] });
      } else {
        blocks.push({ type: "quote", raw, blocks: nested(inner) as RichBlock[] });
      }
      continue;
    }

    const media = current.match(MEDIA);
    if (media) {
      blocks.push({ type: "media", raw: current, alt: media[1]!, url: media[2]! });
      line += 1;
      continue;
    }

    const footnote = current.match(FOOTNOTE);
    if (footnote) {
      blocks.push({ type: "footnote", raw: current, footnoteId: footnote[1]!, content: parseMarkdownInlines(footnote[2]!) });
      line += 1;
      continue;
    }

    const sourceNote = current.match(SOURCE_NOTE);
    if (sourceNote) {
      blocks.push({ type: "source_note", raw: current, content: parseMarkdownInlines(sourceNote[1]!) });
      line += 1;
      continue;
    }

    if (LIST_ITEM.test(current) && (current.match(LIST_ITEM)![3] !== undefined || line + 1 >= lines.length || !lines[line + 1]!.trim())) {
      const start = line;
      const parsed = parseListItems(lines, line);
      line = parsed.end;
      const task = parsed.items.length > 0 && parsed.items.every((item) => item.checked !== undefined);
      const items: RichListItem[] = parsed.items.map((item) => ({
        ...(task ? { checked: item.checked ?? false } : {}),
        blocks: nested(item.lines) as RichBlock[],
      }));
      blocks.push({
        type: "list",
        raw: lines.slice(start, line).join("\n"),
        kind: task ? "task" : parsed.ordered ? "ordered" : "bullet",
        ...(parsed.ordered && parsed.start !== undefined && parsed.start !== 1 ? { start: parsed.start } : {}),
        items,
      });
      continue;
    }

    if (current.includes("|") && TABLE_DELIMITER.test(lines[line + 1] ?? "") && (lines[line + 1] ?? "").includes("-")) {
      const start = line;
      const rows: RichInline[][][] = [splitRow(current).map((cell) => parseMarkdownInlines(cell))];
      line += 2;
      while (line < lines.length && lines[line]!.includes("|") && lines[line]!.trim()) rows.push(splitRow(lines[line++]!).map((cell) => parseMarkdownInlines(cell)));
      blocks.push({ type: "table", raw: lines.slice(start, line).join("\n"), header: true, rows });
      continue;
    }

    const start = line;
    line += 1;
    while (line < lines.length && lines[line]!.trim() && !startsBlock(lines[line]!) && !SOURCE_NOTE.test(lines[line]!)) {
      // A table can start under a paragraph only with its delimiter row.
      if (lines[line]!.includes("|") && TABLE_DELIMITER.test(lines[line + 1] ?? "")) break;
      line += 1;
    }
    const raw = lines.slice(start, line).join("\n");
    const unmatchedCitation = raw.lastIndexOf("[[") > raw.lastIndexOf("]]");
    blocks.push({ type: "paragraph", raw, complete: !unmatchedCitation, content: parseMarkdownInlines(raw.split("\n").map((part) => part.trimStart()).join("\n").trimEnd()) });
  }
  return blocks;
}

/**
 * Models write display math as `\[…\]` and inline math as `\(…\)` as often
 * as with dollars. Balanced pairs become dollars before parsing.
 */
export function normalizeMath(source: string) {
  let value = source;
  // An escaped backslash (`\\[`) is text, never a delimiter.
  const blockOpen = (value.match(/(?<!\\)\\\[/g) ?? []).length;
  if (blockOpen > 0 && blockOpen === (value.match(/(?<!\\)\\\]/g) ?? []).length) {
    value = value.replace(/(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]/g, (_match, math: string) => `\n$$\n${math.trim()}\n$$\n`);
  }
  const inlineOpen = (value.match(/(?<!\\)\\\(/g) ?? []).length;
  if (inlineOpen > 0 && inlineOpen === (value.match(/(?<!\\)\\\)/g) ?? []).length) {
    value = value.replace(/(?<!\\)\\\((.+?)(?<!\\)\\\)/g, (_match, math: string) => `$${math.trim()}$`);
  }
  return value;
}

export function parseSpectraRichContent(source: string): SpectraRichContentAst {
  const lines = normalizeMath(source.replaceAll("\r\n", "\n"))
    .split("\n")
    .map((line) => line.replace(/^\t+/, (tabs) => "    ".repeat(tabs.length)));
  const blocks = identifyBlocks(parseBlockDrafts(lines));
  return { version: SPECTRA_RICH_CONTENT_VERSION, source, blocks, complete: blocks.every((block) => block.complete) };
}

/**
 * A stream cut inside `**bold` would show its asterisks until the closer
 * comes; the opener is held back instead, so the words appear plain and turn
 * bold when it does. Only the last line, and never inside code.
 */
function holdOpenEmphasis(source: string) {
  const line = source.slice(source.lastIndexOf("\n") + 1);
  const fences = source.match(/^\s*```/gm)?.length ?? 0;
  if (fences % 2 || line.includes("`")) return source;
  const openers = line.match(/(?<![\\*])\*\*(?!\*)/g)?.length ?? 0;
  if (openers % 2 === 0) return source;
  const at = source.lastIndexOf("**");
  return source.slice(0, at) + source.slice(at + 2);
}

/**
 * Parses a stream as it grows. A block that is the same as before keeps its
 * object identity, so the renderer leaves it alone while the next one forms.
 */
export class IncrementalRichContentParser {
  private source = "";
  private ast: SpectraRichContentAst = parseSpectraRichContent("");

  append(delta: string) { return this.replace(this.source + delta); }

  replace(source: string) {
    const next = parseSpectraRichContent(holdOpenEmphasis(source));
    next.source = source;
    const prior = this.ast.blocks;
    next.blocks = next.blocks.map((block, index) => {
      const previous = prior[index];
      return previous && richBlockSemanticKey(previous) === richBlockSemanticKey(block) && previous.complete === block.complete ? previous : block;
    });
    this.source = source;
    this.ast = next;
    return next;
  }

  snapshot() { return this.ast; }
}
