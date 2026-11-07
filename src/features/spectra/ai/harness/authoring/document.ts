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
  type PmMark,
  type PmNode,
} from "./markdown";
import { closestText, locateAll, resolveRanges, spliceRanges } from "./locate";
import { AuthoringError, type IdFactory, defaultIdFactory, record, truncate } from "./shared";

/*
 * Documents are authored and edited in Markdown. The canonical content is the
 * editor's ProseMirror JSON (`tiptap`), with `blocks` and `outline` derived
 * from it. An edit re-parses the new Markdown and reuses every top-level node
 * whose Markdown did not change, so block ids, comments anchors and formatting
 * Markdown cannot express survive untouched sections.
 */

const BLOCK_GAP = "\n\n";

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
    // A blank paragraph has no Markdown of its own and would vanish on the way
    // back, so it travels as a marker like anything else Markdown cannot say.
    const written = expressibleInMarkdown(node) ? serializeBlock(node) : "";
    const markdown = written.trim() ? written : keepMarker(id, node);
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

/** Marks Markdown writes itself; anything else (a font, a colour) it cannot say. */
const WRITTEN_MARKS = new Set(["link", "bold", "italic", "strike", "highlight", "underline", "code"]);

function textNodes(node: PmNode): PmNode[] {
  return node.type === "text" ? [node] : (node.content ?? []).flatMap(textNodes);
}

/** The marks Markdown cannot say that cover every word of a block, like a Word paragraph's font. */
function wholeUnwrittenMarks(node: PmNode) {
  const texts = textNodes(node);
  if (!texts.length) return [];
  return (texts[0]!.marks ?? []).filter(
    (mark) =>
      !WRITTEN_MARKS.has(mark.type) &&
      texts.every((text) => text.marks?.some((other) => JSON.stringify(other) === JSON.stringify(mark))),
  );
}

/** A rewritten block keeps the look its words had all over: new words wear it too. */
function withWholeMarks(node: PmNode, marks: readonly PmMark[]): PmNode {
  if (!marks.length) return node;
  if (node.type === "text") {
    const own = node.marks ?? [];
    const added = marks.filter((mark) => !own.some((other) => other.type === mark.type));
    return added.length ? { ...node, marks: [...own, ...added] } : node;
  }
  return node.content ? { ...node, content: node.content.map((child) => withWholeMarks(child, marks)) } : node;
}

const unwrittenMarks = (marks: readonly PmMark[] | undefined) =>
  (marks ?? []).filter((mark) => !WRITTEN_MARKS.has(mark.type));

/**
 * A small edit to a block with several looks, like a heading in two colours.
 * The words that stayed keep exactly the look they had, and new words take the
 * look of the words just before them, the way typing does.
 */
function withLookOfOldWords(next: PmNode, old: PmNode): PmNode {
  const isPlainRun = (node: PmNode) => node.type === "text";
  if (!next.content?.every(isPlainRun) || !old.content?.every(isPlainRun)) return next;
  const looks: Array<readonly PmMark[]> = [];
  for (const run of old.content) for (const _ of Array.from(run.text ?? "")) looks.push(unwrittenMarks(run.marks));
  const oldChars = old.content.flatMap((run) => Array.from(run.text ?? ""));
  const newChars = next.content.flatMap((run) => Array.from(run.text ?? ""));
  if (!oldChars.length || !newChars.length) return next;
  let prefix = 0;
  while (prefix < oldChars.length && prefix < newChars.length && oldChars[prefix] === newChars[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldChars.length - prefix && suffix < newChars.length - prefix &&
    oldChars[oldChars.length - 1 - suffix] === newChars[newChars.length - 1 - suffix]
  ) suffix += 1;
  const lookAt = (at: number): readonly PmMark[] => {
    if (at < prefix) return looks[at]!;
    if (at >= newChars.length - suffix) return looks[oldChars.length - (newChars.length - at)]!;
    return looks[Math.max(0, prefix - 1)]!;
  };
  const content: PmNode[] = [];
  let at = 0;
  for (const run of next.content) {
    const written = (run.marks ?? []).filter((mark) => WRITTEN_MARKS.has(mark.type));
    for (const char of Array.from(run.text ?? "")) {
      const marks = [...written, ...lookAt(at)];
      at += 1;
      const last = content[content.length - 1];
      if (last && JSON.stringify(last.marks ?? []) === JSON.stringify(marks)) last.text = `${last.text}${char}`;
      else content.push({ type: "text", text: char, ...(marks.length ? { marks } : {}) });
    }
  }
  return { ...next, content };
}

/** Builds document content from Markdown, reusing unchanged nodes of `previous`. */
export function documentFromMarkdown(
  markdown: string,
  previous?: unknown,
  ids: IdFactory = defaultIdFactory(),
) {
  const before = previous ? documentChunks(previous) : [];
  // Markdown does not always read back as it was written: a trailing line break
  // or a Word table comes back reworded, or as several blocks. Each block is
  // known by how its own Markdown reads back, so one nobody touched is always
  // recognised, and stays exactly as it was.
  const readsBackAs = (markdown: string) => parseBlocks(markdown).map(serializeBlock);
  const byMarkdown = new Map<string, DocumentChunk[]>();
  let widest = 1;
  for (const chunk of before) {
    const pieces = KEEP_MARKER.test(chunk.markdown) ? [chunk.markdown] : readsBackAs(chunk.markdown);
    widest = Math.max(widest, pieces.length);
    for (const key of new Set([chunk.markdown, pieces.join(BLOCK_GAP)])) {
      const list = byMarkdown.get(key) ?? [];
      list.push(chunk);
      byMarkdown.set(key, list);
    }
  }
  const byId = new Map(before.map((chunk) => [chunk.id, chunk]));
  const oldIndex = new Map(before.map((chunk, index) => [chunk.id, index]));
  const used = new Set<string>();
  // Unchanged blocks are reused whole; the rest are written fresh for now.
  const entries: Array<{ node: PmNode; reused?: string }> = [];
  const parsedBlocks = parseBlocks(markdown);
  for (let at = 0; at < parsedBlocks.length; at += 1) {
    const parsed = parsedBlocks[at]!;
    if (parsed.type === "__keep") {
      const kept = byId.get(String(parsed.attrs?.id));
      if (!kept)
        throw new AuthoringError(
          `The marker keep:${String(parsed.attrs?.id)} does not match anything in this document. Keep markers can only stay or be deleted.`,
        );
      if (!used.has(kept.id)) {
        used.add(kept.id);
        entries.push({ node: kept.node, reused: kept.id });
      }
      continue;
    }
    let reusable: DocumentChunk | undefined;
    let span = 1;
    for (let width = Math.min(widest, parsedBlocks.length - at); width >= 1 && !reusable; width -= 1) {
      const key = parsedBlocks.slice(at, at + width).map(serializeBlock).join(BLOCK_GAP);
      reusable = byMarkdown.get(key)?.find((chunk) => !used.has(chunk.id));
      if (reusable) span = width;
    }
    if (reusable) {
      used.add(reusable.id);
      entries.push({ node: reusable.node, reused: reusable.id });
      at += span - 1;
      continue;
    }
    entries.push({ node: parsed });
  }
  // A rewritten block is still the block it replaced: the old block of the
  // same kind in the same place between unchanged neighbours keeps its id and
  // what Markdown cannot say, so comments, history and anyone's caret on it
  // stay with it.
  const nodes: PmNode[] = [];
  let lastAnchor = -1;
  entries.forEach((entry, index) => {
    if (entry.reused) {
      lastAnchor = Math.max(lastAnchor, oldIndex.get(entry.reused) ?? lastAnchor);
      nodes.push(entry.node);
      return;
    }
    const nextReused = entries.slice(index + 1).find((later) => later.reused)?.reused;
    const nextAnchor = nextReused !== undefined ? (oldIndex.get(nextReused) ?? before.length) : before.length;
    const end = nextAnchor > lastAnchor ? nextAnchor : before.length;
    const replaced = before
      .slice(lastAnchor + 1, end)
      .find((chunk) => !used.has(chunk.id) && chunk.node.type === entry.node.type);
    if (replaced) {
      used.add(replaced.id);
      lastAnchor = oldIndex.get(replaced.id) ?? lastAnchor;
      const rewritten = { ...entry.node, attrs: { ...(replaced.node.attrs ?? {}), ...(entry.node.attrs ?? {}), blockId: replaced.id } };
      nodes.push(withWholeMarks(withLookOfOldWords(rewritten, replaced.node), wholeUnwrittenMarks(replaced.node)));
      return;
    }
    let id = ids("block");
    while (used.has(id) || byId.has(id)) id = ids("block");
    used.add(id);
    nodes.push({ ...entry.node, attrs: { ...(entry.node.attrs ?? {}), blockId: id } });
  });
  if (!nodes.length) nodes.push({ type: "paragraph", attrs: { blockId: ids("block") } });
  const doc: PmNode & { content: PmNode[] } = { type: "doc", content: nodes };
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
  | { op: "replace"; find?: string; from?: string; to?: string; replace?: string; all?: boolean }
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

/** The Markdown of one section (its heading and everything under it). */
export function documentSectionMarkdown(markdown: string, heading: string) {
  const section = findSection(markdown, heading, "read");
  return markdown.slice(section.start, section.end).trim();
}

/** Where a place named by a heading, or failing that by unique text, begins and ends. */
function anchored(markdown: string, anchor: string, label: string) {
  const all = sections(markdown);
  const wanted = normaliseTitle(anchor);
  const exact = all.filter((section) => normaliseTitle(section.title) === wanted);
  const headed = exact.length ? exact : all.filter((section) => normaliseTitle(section.title).includes(wanted));
  if (headed.length === 1) return headed[0]!;
  const found = locateAll(markdown, anchor, "prose");
  if (found.length === 1) {
    const before = markdown.lastIndexOf("\n\n", found[0]!.start);
    const after = markdown.indexOf("\n\n", found[0]!.end);
    return { start: before < 0 ? 0 : before + 2, end: after < 0 ? markdown.length : after };
  }
  if (headed.length > 1 || found.length > 1)
    throw new AuthoringError(`${label}: "${anchor}" matches more than one place. Quote more of the text, or the full heading.`);
  const closest = closestText(markdown, anchor);
  throw new AuthoringError(
    `${label}: "${anchor}" is neither a heading nor text in the document.${closest ? ` The closest text is: "${closest}".` : ""} Headings: ${all.map((section) => `"${section.title}"`).join(", ") || "none"}.`,
  );
}

function insertionPoint(
  markdown: string,
  target: { after?: string; before?: string; position?: "start" | "end" },
  label: string,
) {
  if (target.after) return anchored(markdown, target.after, label).end;
  if (target.before) return anchored(markdown, target.before, label).start;
  if (target.position === "start") return 0;
  return markdown.length;
}

function spliceBlock(markdown: string, at: number, block: string) {
  const head = markdown.slice(0, at).replace(/\s+$/, "");
  const tail = markdown.slice(at).trim();
  return [head, block.trim(), tail].filter(Boolean).join("\n\n");
}

/** Applies edits to the document's Markdown. Throws naming the failing op. */
export function applyDocumentEdits(markdown: string, ops: DocumentEditOp[]) {
  let text = markdown;
  ops.forEach((op, index) => {
    const label = `Edit ${index + 1} (${op.op})`;
    switch (op.op) {
      case "replace": {
        text = spliceRanges(text, resolveRanges(text, op, label, "prose", "the document"), op.replace ?? "");
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
  // A rewritten block keeps its id, so a change is a block whose text moved on.
  const beforeById = new Map(previous ? documentChunks(previous).map((chunk) => [chunk.id, chunk.markdown]) : []);
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
    const changed = chunks.filter((chunk) => beforeById.get(chunk.id) !== chunk.markdown);
    lines.push(
      changed.length
        ? `Changed or new blocks:\n${truncate(changed.map((chunk) => chunk.markdown).join("\n\n"), 2_400)}`
        : "No block changed.",
    );
  } else lines.push(`Content:\n${truncate(markdown, 2_400)}`);
  return lines.join("\n");
}
