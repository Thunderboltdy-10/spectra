import * as Y from "yjs";
import { canonicalSemanticValue } from "../../../../../../shared/canonical-json";
import type { DocumentJsonNode } from "../../../lenses/document-projection";

/**
 * Bring a y-prosemirror fragment to a ProseMirror JSON document with the
 * smallest structural edit: children are aligned by type and block id, kept
 * nodes are updated in place (attributes and text deltas), and only nodes
 * that really appeared or vanished are inserted or deleted. Collaborators'
 * cursors survive and the Yjs update carries only what changed, so a
 * projection that already matches the room writes nothing at all.
 */
export function syncFragmentToJson(fragment: Y.XmlFragment, document: DocumentJsonNode) {
  syncChildren(fragment, document.content ?? []);
}

type Run = { text: string; attributes: Record<string, unknown> };
type Desired = { kind: "text"; runs: Run[] } | { kind: "element"; node: DocumentJsonNode };
type YChild = Y.XmlText | Y.XmlElement;

/** Above this many cells the alignment table costs more than a rewrite. */
const MAX_ALIGNMENT_CELLS = 1_000_000;

function textAttributes(node: DocumentJsonNode) {
  return Object.fromEntries((node.marks ?? []).map((mark) => [mark.type, mark.attrs ?? {}]));
}

function desiredChildren(content: readonly DocumentJsonNode[]): Desired[] {
  const result: Desired[] = [];
  for (const node of content) {
    if (node.type === "text") {
      const run = { text: node.text ?? "", attributes: textAttributes(node) };
      if (!run.text) continue;
      const last = result.at(-1);
      if (last?.kind === "text") last.runs.push(run);
      else result.push({ kind: "text", runs: [run] });
      continue;
    }
    if (!node.type || node.type === "doc") {
      result.push(...desiredChildren(node.content ?? []));
      continue;
    }
    result.push({ kind: "element", node });
  }
  return result;
}

function blockIdOf(attrs: Record<string, unknown> | undefined) {
  const id = attrs?.blockId;
  return typeof id === "string" && id ? id : "";
}

function desiredKey(child: Desired) {
  return child.kind === "text" ? "#text" : `${child.node.type}#${blockIdOf(child.node.attrs)}`;
}

function currentKey(child: YChild) {
  if (child instanceof Y.XmlText) return "#text";
  const id = child.getAttribute("blockId");
  return `${child.nodeName}#${typeof id === "string" ? id : ""}`;
}

/** Pairs of [current index, desired index] in a longest common subsequence
 * of keys, after trimming the shared prefix and suffix (the usual case is a
 * handful of changed blocks in a long document). */
function alignKeys(current: readonly string[], desired: readonly string[]) {
  const pairs: Array<[number, number]> = [];
  let start = 0;
  while (start < current.length && start < desired.length && current[start] === desired[start]) {
    pairs.push([start, start]);
    start++;
  }
  let end = 0;
  while (end < current.length - start && end < desired.length - start &&
    current[current.length - 1 - end] === desired[desired.length - 1 - end]) end++;
  const rows = current.length - start - end;
  const columns = desired.length - start - end;
  if (rows > 0 && columns > 0 && rows * columns <= MAX_ALIGNMENT_CELLS) {
    const table = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1));
    for (let row = rows - 1; row >= 0; row--)
      for (let column = columns - 1; column >= 0; column--)
        table[row]![column] = current[start + row] === desired[start + column]
          ? table[row + 1]![column + 1]! + 1
          : Math.max(table[row + 1]![column]!, table[row]![column + 1]!);
    let row = 0;
    let column = 0;
    while (row < rows && column < columns) {
      if (current[start + row] === desired[start + column]) {
        pairs.push([start + row, start + column]);
        row++;
        column++;
      } else if (table[row + 1]![column]! >= table[row]![column + 1]!) row++;
      else column++;
    }
  }
  for (let offset = end; offset > 0; offset--)
    pairs.push([current.length - offset, desired.length - offset]);
  return pairs;
}

function syncChildren(parent: Y.XmlFragment | Y.XmlElement, content: readonly DocumentJsonNode[]) {
  const desired = desiredChildren(content);
  const current = parent.toArray().filter((child): child is YChild =>
    child instanceof Y.XmlText || child instanceof Y.XmlElement);
  const pairs = alignKeys(current.map(currentKey), desired.map(desiredKey));
  const keptCurrent = new Set(pairs.map(([index]) => index));
  const matchFor = new Map(pairs.map(([currentIndex, desiredIndex]) => [desiredIndex, current[currentIndex]!]));

  for (let index = current.length - 1; index >= 0; index--)
    if (!keptCurrent.has(index)) parent.delete(index, 1);

  desired.forEach((child, index) => {
    const existing = matchFor.get(index);
    if (existing) {
      if (child.kind === "text") syncText(existing as Y.XmlText, child.runs);
      else syncElement(existing as Y.XmlElement, child.node);
      return;
    }
    if (child.kind === "text") {
      const text = new Y.XmlText();
      parent.insert(index, [text]);
      syncText(text, child.runs);
      return;
    }
    const element = new Y.XmlElement(child.node.type);
    parent.insert(index, [element]);
    syncElement(element, child.node);
  });
}

function sameValue(left: unknown, right: unknown) {
  return left === right ||
    JSON.stringify(canonicalSemanticValue(left)) === JSON.stringify(canonicalSemanticValue(right));
}

function syncElement(element: Y.XmlElement, node: DocumentJsonNode) {
  const desired = Object.entries(node.attrs ?? {}).filter(([, value]) => value !== undefined && value !== null);
  const wanted = new Set(desired.map(([key]) => key));
  const present = element.getAttributes() as Record<string, unknown>;
  for (const key of Object.keys(present))
    if (!wanted.has(key)) element.removeAttribute(key);
  for (const [key, value] of desired)
    if (!sameValue(present[key], value)) element.setAttribute(key, value as string);
  syncChildren(element, node.content ?? []);
}

type Unit = { code: string; key: string; attributes: Record<string, unknown> };

function units(runs: ReadonlyArray<{ text: string; attributes: Record<string, unknown> }>): Unit[] {
  const result: Unit[] = [];
  for (const run of runs) {
    const key = JSON.stringify(canonicalSemanticValue(run.attributes));
    for (let index = 0; index < run.text.length; index++)
      result.push({ code: run.text[index]!, key, attributes: run.attributes });
  }
  return result;
}

const isHighSurrogate = (unit: Unit | undefined) => {
  const code = unit?.code.charCodeAt(0) ?? 0;
  return code >= 0xd800 && code <= 0xdbff;
};
const isLowSurrogate = (unit: Unit | undefined) => {
  const code = unit?.code.charCodeAt(0) ?? 0;
  return code >= 0xdc00 && code <= 0xdfff;
};

/** Replace only the differing middle of a text run. Formatting counts as
 * content, so a bolded word is rewritten while the rest of the paragraph
 * keeps its identity. Never cuts a surrogate pair: Yjs would encode the
 * lone half as a replacement character. */
function syncText(text: Y.XmlText, runs: readonly Run[]) {
  const delta = text.toDelta() as Array<{ insert?: unknown; attributes?: Record<string, unknown> }>;
  const before = units(delta.flatMap((part) =>
    typeof part.insert === "string" ? [{ text: part.insert, attributes: part.attributes ?? {} }] : []));
  const after = units(runs);
  const same = (left: Unit | undefined, right: Unit | undefined) =>
    Boolean(left && right && left.code === right.code && left.key === right.key);
  let start = 0;
  while (start < before.length && start < after.length && same(before[start], after[start])) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start &&
    same(before[before.length - 1 - end], after[after.length - 1 - end])) end++;
  while (start > 0 && (isLowSurrogate(before[start]) || isLowSurrogate(after[start]))) start--;
  while (end > 0 && (isHighSurrogate(before[before.length - end - 1]) || isHighSurrogate(after[after.length - end - 1]))) end--;
  const removed = before.length - start - end;
  if (removed > 0) text.delete(start, removed);
  let position = start;
  let index = start;
  while (index < after.length - end) {
    const first = after[index]!;
    let chunk = "";
    while (index < after.length - end && after[index]!.key === first.key) chunk += after[index++]!.code;
    // Yjs fills unspecified attributes with null in this object; pass a copy.
    text.insert(position, chunk, { ...first.attributes });
    position += chunk.length;
  }
}
