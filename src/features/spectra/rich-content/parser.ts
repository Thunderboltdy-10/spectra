import {
  SPECTRA_RICH_CONTENT_VERSION,
  type RichBlock,
  type RichInline,
  type SpectraRichContentAst,
  richBlockSemanticKey,
} from "./ast";

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function inlines(value: string): RichInline[] {
  const output: RichInline[] = [];
  const pattern = /\[\[cite:([^:\]|]+):([^\]|]+)(?:\|([^\]]+))?\]\]|\[\[ref:([^\]|]+)(?:\|([^\]]+))?\]\]|`([^`]+)`|\$([^$\n]+)\$|\[\^([^\]]+)\]/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) output.push({ type: "text", text: value.slice(cursor, index) });
    if (match[1]) {
      output.push({ type: "citation", sourceId: match[1], evidenceIds: match[2]!.split(",").map((item) => item.trim()).filter(Boolean), ...(match[3] ? { label: match[3] } : {}) });
    } else if (match[4]) {
      output.push({ type: "reference", workId: match[4], ...(match[5] ? { label: match[5] } : {}) });
    } else if (match[6]) output.push({ type: "inline_code", code: match[6] });
    else if (match[7]) output.push({ type: "inline_math", math: match[7], complete: true });
    else if (match[8]) output.push({ type: "footnote_ref", id: match[8] });
    cursor = index + match[0].length;
  }
  if (cursor < value.length) output.push({ type: "text", text: value.slice(cursor) });
  if (!output.length) output.push({ type: "text", text: value });
  return output;
}

function makeId(index: number, raw: string) {
  return `rich:${index}:${hash(raw)}`;
}

function parseBlocks(source: string): RichBlock[] {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const blocks: RichBlock[] = [];
  let line = 0;
  type RichBlockDraft<T = RichBlock> = T extends RichBlock ? Omit<T, "id"> : never;
  const push = (block: RichBlockDraft) => blocks.push({ ...block, id: makeId(blocks.length, block.raw) } as RichBlock);
  while (line < lines.length) {
    if (!lines[line]!.trim()) { line += 1; continue; }
    const current = lines[line]!;
    const fence = current.match(/^```\s*([^\s]*)/);
    if (fence) {
      const start = line++;
      while (line < lines.length && !/^```\s*$/.test(lines[line]!)) line += 1;
      const complete = line < lines.length;
      if (complete) line += 1;
      const raw = lines.slice(start, line).join("\n");
      push({ type: "code_block", raw, complete, ...(fence[1] ? { language: fence[1] } : {}), code: lines.slice(start + 1, complete ? line - 1 : line).join("\n") });
      continue;
    }
    if (/^\$\$/.test(current)) {
      const start = line++;
      while (line < lines.length && !/\$\$\s*$/.test(lines[line]!)) line += 1;
      const complete = line < lines.length;
      if (complete) line += 1;
      const raw = lines.slice(start, line).join("\n");
      push({ type: "math_block", raw, complete, math: raw.replace(/^\$\$\s*/, "").replace(/\$\$\s*$/, "") });
      continue;
    }
    const heading = current.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      push({ type: "heading", raw: current, complete: true, level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, content: inlines(heading[2]!) });
      line += 1;
      continue;
    }
    const media = current.match(/^!\[([^\]]*)\]\((https?:\/\/[^)]+|\/[^)]+)\)$/);
    if (media) {
      push({ type: "media", raw: current, complete: true, alt: media[1]!, url: media[2]! });
      line += 1;
      continue;
    }
    const footnote = current.match(/^\[\^([^\]]+)\]:\s*(.+)$/);
    if (footnote) {
      push({ type: "footnote", raw: current, complete: true, footnoteId: footnote[1]!, content: inlines(footnote[2]!) });
      line += 1;
      continue;
    }
    const callout = current.match(/^>\s*\[!([A-Za-z]+)\]\s*(.*)$/);
    if (callout) {
      push({ type: "callout", raw: current, complete: true, tone: callout[1]!.toLowerCase(), content: inlines(callout[2]!) });
      line += 1;
      continue;
    }
    const sourceNote = current.match(/^Source:\s*(.+)$/i);
    if (sourceNote) {
      push({ type: "source_note", raw: current, complete: true, content: inlines(sourceNote[1]!) });
      line += 1;
      continue;
    }
    const list = current.match(/^\s*(?:(\d+)\.|[-*+])\s+(.+)$/);
    if (list) {
      const start = line;
      const items: RichInline[][] = [];
      const ordered = Boolean(list[1]);
      while (line < lines.length) {
        const item = lines[line]!.match(/^\s*(?:(\d+)\.|[-*+])\s+(.+)$/);
        if (!item || Boolean(item[1]) !== ordered) break;
        items.push(inlines(item[2]!));
        line += 1;
      }
      push({ type: "list", raw: lines.slice(start, line).join("\n"), complete: true, ordered, items });
      continue;
    }
    if (current.includes("|") && /^\s*\|?\s*:?-+/.test(lines[line + 1] ?? "")) {
      const start = line;
      const rows: RichInline[][][] = [];
      const split = (row: string) => row.replace(/^\s*\||\|\s*$/g, "").split("|").map((cell) => inlines(cell.trim()));
      rows.push(split(current));
      line += 2;
      while (line < lines.length && lines[line]!.includes("|") && lines[line]!.trim()) rows.push(split(lines[line++]!));
      push({ type: "table", raw: lines.slice(start, line).join("\n"), complete: true, rows });
      continue;
    }
    const start = line;
    while (line < lines.length && lines[line]!.trim() && !/^```|^\$\$|^#{1,6}\s|^>\s*\[!|^\[\^[^\]]+\]:|^Source:/i.test(lines[line]!)) line += 1;
    const raw = lines.slice(start, line).join("\n");
    const unmatchedCitation = raw.lastIndexOf("[[") > raw.lastIndexOf("]]");
    push({ type: "paragraph", raw, complete: !unmatchedCitation, content: inlines(raw) });
  }
  return blocks;
}

export function parseSpectraRichContent(source: string): SpectraRichContentAst {
  const blocks = parseBlocks(source);
  return { version: SPECTRA_RICH_CONTENT_VERSION, source, blocks, complete: blocks.every((block) => block.complete) };
}

export class IncrementalRichContentParser {
  private source = "";
  private ast: SpectraRichContentAst = parseSpectraRichContent("");

  append(delta: string) { return this.replace(this.source + delta); }

  replace(source: string) {
    const next = parseSpectraRichContent(source);
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
