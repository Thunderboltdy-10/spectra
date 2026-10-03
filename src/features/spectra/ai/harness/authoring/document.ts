import {
  documentBlocksFromJson,
  documentContentToProseMirrorJson,
} from "../../../../../../shared/document-projection.mjs";
import {
  KEEP_MARKER,
  expressibleInMarkdown,
  keepMarker,
  parseBlocks,
  serializeBlock,
  serializeInline,
  type PmNode,
} from "./markdown";
import { AuthoringError, type IdFactory, defaultIdFactory, record, truncate } from "./shared";

/*
 * Documents are authored and edited in Markdown. The canonical content is the
 * editor's ProseMirror JSON (`tiptap`), with `blocks` and `outline` derived
 * from it. An edit re-parses the new Markdown and reuses every top-level node
 * whose Markdown did not change, so block ids, comments anchors and formatting
 * Markdown cannot express survive untouched sections.
 */

export type DocumentChunk = { id: string; node: PmNode; markdown: string };

function blockIdOf(node: PmNode, index: number) {
  const id = node.attrs?.blockId;
  return typeof id === "string" && id ? id : `block-${index + 1}`;
}

/** The document's top-level nodes with their Markdown form. */
export function documentChunks(content: unknown): DocumentChunk[] {
  const doc = documentContentToProseMirrorJson(content) as PmNode;
  const seen = new Set<string>();
  return (doc.content ?? []).map((node, index) => {
    let id = blockIdOf(node, index);
    while (seen.has(id)) id = `${id}~`;
    seen.add(id);
    const markdown = expressibleInMarkdown(node) ? serializeBlock(node) : keepMarker(id, node);
    return { id, node, markdown };
  });
}

export function documentToMarkdown(content: unknown) {
  return documentChunks(content)
    .map((chunk) => chunk.markdown)
    .join("\n\n");
}

function headingText(node: PmNode) {
  return serializeInline(node.content).replace(/[*_~=`]/g, "").trim();
}

export function documentOutline(doc: PmNode) {
  return (doc.content ?? []).flatMap((node, index) =>
    node.type === "heading"
      ? [{ id: blockIdOf(node, index), title: headingText(node), level: Number(node.attrs?.level) || 2 }]
      : [],
  );
}

/** Builds document content from Markdown, reusing unchanged nodes of `previous`. */
export function documentFromMarkdown(
  markdown: string,
  previous?: unknown,
  ids: IdFactory = defaultIdFactory(),
) {
  const before = previous ? documentChunks(previous) : [];
  const byMarkdown = new Map<string, DocumentChunk[]>();
  for (const chunk of before) {
    const list = byMarkdown.get(chunk.markdown) ?? [];
    list.push(chunk);
    byMarkdown.set(chunk.markdown, list);
  }
  const byId = new Map(before.map((chunk) => [chunk.id, chunk]));
  const used = new Set<string>();
  const nodes: PmNode[] = [];
  for (const parsed of parseBlocks(markdown)) {
    if (parsed.type === "__keep") {
      const kept = byId.get(String(parsed.attrs?.id));
      if (!kept)
        throw new AuthoringError(
          `The marker keep:${String(parsed.attrs?.id)} does not match anything in this document. Keep markers can only stay or be deleted.`,
        );
      if (!used.has(kept.id)) {
        used.add(kept.id);
        nodes.push(kept.node);
      }
      continue;
    }
    const text = serializeBlock(parsed);
    const reusable = byMarkdown.get(text)?.find((chunk) => !used.has(chunk.id));
    if (reusable) {
      used.add(reusable.id);
      nodes.push(reusable.node);
      continue;
    }
    let id = ids("block");
    while (used.has(id) || byId.has(id)) id = ids("block");
    used.add(id);
    nodes.push({ ...parsed, attrs: { ...(parsed.attrs ?? {}), blockId: id } });
  }
  if (!nodes.length) nodes.push({ type: "paragraph", attrs: { blockId: ids("block") } });
  const doc: PmNode = { type: "doc", content: nodes };
  const base = record(previous);
  const { tiptap: _tiptap, blocks: _blocks, outline: _outline, ...rest } = base;
  return {
    ...rest,
    tiptap: doc,
    blocks: documentBlocksFromJson(doc),
    outline: documentOutline(doc),
  };
}

// ---------------------------------------------------------------- edits

export type DocumentEditOp =
  | { op: "replace"; find: string; replace: string; all?: boolean }
  | { op: "insert"; markdown: string; after?: string; before?: string; position?: "start" | "end" }
  | { op: "move_section"; heading: string; after?: string; before?: string; position?: "start" | "end" }
  | { op: "delete_section"; heading: string }
  | { op: "rewrite"; markdown: string };

type Section = { start: number; end: number; level: number; title: string };

function lineOffsets(markdown: string) {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of markdown.split("\n")) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

function normaliseTitle(value: string) {
  return value
    .replace(/^#+\s*/, "")
    .replace(/[*_~=`]/g, "")
    .trim()
    .toLowerCase();
}

function sections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const offsets = lineOffsets(markdown);
  const headings: Array<{ line: number; level: number; title: string }> = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (/^ {0,3}(```|~~~)/.test(line)) fenced = !fenced;
    const match = !fenced && /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) headings.push({ line: index, level: Math.min(3, match[1]!.length), title: match[2]!.trim() });
  });
  return headings.map((heading, index) => {
    const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
    return {
      start: offsets[heading.line]!,
      end: next ? offsets[next.line]! : markdown.length,
      level: heading.level,
      title: heading.title,
    };
  });
}

function findSection(markdown: string, heading: string, label: string): Section {
  const wanted = normaliseTitle(heading);
  const all = sections(markdown);
  const exact = all.filter((section) => normaliseTitle(section.title) === wanted);
  const matches = exact.length ? exact : all.filter((section) => normaliseTitle(section.title).includes(wanted));
  if (matches.length === 1) return matches[0]!;
  const titles = all.map((section) => `"${section.title}"`).join(", ") || "none";
  if (!matches.length)
    throw new AuthoringError(`${label}: no heading matches "${heading}". Headings: ${titles}.`);
  throw new AuthoringError(`${label}: "${heading}" matches ${matches.length} headings. Use the full heading text.`);
}

function insertionPoint(
  markdown: string,
  target: { after?: string; before?: string; position?: "start" | "end" },
  label: string,
) {
  if (target.after) return findSection(markdown, target.after, label).end;
  if (target.before) return findSection(markdown, target.before, label).start;
  if (target.position === "start") return 0;
  return markdown.length;
}

function spliceBlock(markdown: string, at: number, block: string) {
  const head = markdown.slice(0, at).replace(/\s+$/, "");
  const tail = markdown.slice(at).trim();
  return [head, block.trim(), tail].filter(Boolean).join("\n\n");
}

function countOccurrences(haystack: string, needle: string) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Applies edits to the document's Markdown. Throws naming the failing op. */
export function applyDocumentEdits(markdown: string, ops: DocumentEditOp[]) {
  let text = markdown;
  ops.forEach((op, index) => {
    const label = `Edit ${index + 1} (${op.op})`;
    switch (op.op) {
      case "replace": {
        if (!op.find) throw new AuthoringError(`${label}: \`find\` is empty.`);
        const count = countOccurrences(text, op.find);
        if (!count)
          throw new AuthoringError(
            `${label}: \`find\` text was not found. It must match the document's Markdown exactly, including formatting marks. Read the document if unsure.`,
          );
        if (count > 1 && !op.all)
          throw new AuthoringError(
            `${label}: \`find\` text appears ${count} times. Include more surrounding text, or set "all": true to replace every one.`,
          );
        text = op.all ? text.split(op.find).join(op.replace) : text.replace(op.find, () => op.replace);
        break;
      }
      case "insert": {
        if (!op.markdown?.trim()) throw new AuthoringError(`${label}: \`markdown\` is empty.`);
        text = spliceBlock(text, insertionPoint(text, op, label), op.markdown);
        break;
      }
      case "move_section": {
        const section = findSection(text, op.heading, label);
        const body = text.slice(section.start, section.end);
        const without = `${text.slice(0, section.start)}${text.slice(section.end)}`;
        if ((op.after && normaliseTitle(op.after) === normaliseTitle(section.title)) ||
            (op.before && normaliseTitle(op.before) === normaliseTitle(section.title)))
          throw new AuthoringError(`${label}: a section cannot move relative to itself.`);
        text = spliceBlock(without, insertionPoint(without, op, label), body);
        break;
      }
      case "delete_section": {
        const section = findSection(text, op.heading, label);
        text = [text.slice(0, section.start).replace(/\s+$/, ""), text.slice(section.end).replace(/^\s+/, "")]
          .filter(Boolean)
          .join("\n\n");
        break;
      }
      case "rewrite": {
        text = op.markdown ?? "";
        break;
      }
      default:
        throw new AuthoringError(`${label}: unknown operation. Use replace, insert, move_section, delete_section or rewrite.`);
    }
  });
  return text;
}

// ---------------------------------------------------------------- readback

function words(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** What the model sees after a create or edit: shape, problems, changed parts. */
export function documentReadback(content: unknown, previous?: unknown) {
  const chunks = documentChunks(content);
  const beforeIds = new Set(previous ? documentChunks(previous).map((chunk) => chunk.id) : []);
  const markdown = chunks.map((chunk) => chunk.markdown).join("\n\n");
  const lines: string[] = [];
  const outline = documentOutline(documentContentToProseMirrorJson(content) as PmNode);
  lines.push(
    `${chunks.length} blocks, about ${words(markdown)} words${outline.length ? `. Outline: ${outline.map((entry) => `${"#".repeat(entry.level)} ${entry.title}`).join(" / ")}` : ""}.`,
  );
  const problems: string[] = [];
  chunks.forEach((chunk, index) => {
    if (KEEP_MARKER.test(chunk.markdown)) return;
    const bare = chunk.markdown.replace(/^#+\s*|^[-*>]\s*|\[[ x]\]\s*/gm, "").trim();
    if (!bare && chunk.node.type !== "horizontalRule" && !(index === 0 && chunks.length === 1))
      problems.push(`block ${index + 1} (${chunk.node.type}) is empty`);
  });
  if (problems.length) lines.push(`Empty: ${problems.join("; ")}.`);
  if (previous) {
    const changed = chunks.filter((chunk) => !beforeIds.has(chunk.id));
    lines.push(
      changed.length
        ? `Changed or new blocks:\n${truncate(changed.map((chunk) => chunk.markdown).join("\n\n"), 2_400)}`
        : "No block changed.",
    );
  } else lines.push(`Content:\n${truncate(markdown, 2_400)}`);
  return lines.join("\n");
}
