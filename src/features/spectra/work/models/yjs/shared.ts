import * as Y from "yjs";

export const WORK_ROOT_MAP = "spectra:work-v2";
export const WORK_META_MAP = "spectra:work-v2:meta";

export function workRoot(doc: Y.Doc) {
  return doc.getMap<unknown>(WORK_ROOT_MAP);
}

export function workMeta(doc: Y.Doc) {
  return doc.getMap<unknown>(WORK_META_MAP);
}

export function setWorkModelMetadata(
  doc: Y.Doc,
  workType: string,
  modelVersion: number,
) {
  const meta = workMeta(doc);
  if (meta.get("initialized") !== true) meta.set("initialized", true);
  if (meta.get("workType") !== workType) meta.set("workType", workType);
  if (meta.get("modelVersion") !== modelVersion)
    meta.set("modelVersion", modelVersion);
}

export function assertWorkModelMetadata(
  doc: Y.Doc,
  workType: string,
  modelVersion: number,
) {
  const meta = workMeta(doc);
  if (meta.get("initialized") !== true) throw new Error("WORK_YJS_UNINITIALIZED");
  if (meta.get("workType") !== workType) throw new Error("WORK_YJS_TYPE_MISMATCH");
  const stored = Number(meta.get("modelVersion") ?? 0);
  if (stored > modelVersion) throw new Error("WORK_YJS_MODEL_TOO_NEW");
}

export function replaceYText(text: Y.Text, value: string) {
  const current = text.toString();
  if (current === value) return;
  let prefix = 0;
  const limit = Math.min(current.length, value.length);
  while (prefix < limit && current[prefix] === value[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < current.length - prefix &&
    suffix < value.length - prefix &&
    current[current.length - 1 - suffix] === value[value.length - 1 - suffix]
  )
    suffix += 1;
  const remove = current.length - prefix - suffix;
  if (remove > 0) text.delete(prefix, remove);
  const insert = value.slice(prefix, value.length - suffix);
  if (insert) text.insert(prefix, insert);
}

export function plainToY(value: unknown, textFields = false): unknown {
  if (typeof value === "string" && textFields) return new Y.Text(value);
  if (Array.isArray(value)) {
    const result = new Y.Array<unknown>();
    result.push(value.map((entry) => plainToY(entry, textFields)));
    return result;
  }
  if (value && typeof value === "object") {
    const result = new Y.Map<unknown>();
    for (const [key, entry] of Object.entries(value))
      result.set(key, plainToY(entry, textFields));
    return result;
  }
  return value;
}

export function yToPlain(value: unknown): unknown {
  if (value instanceof Y.Text) return value.toString();
  if (value instanceof Y.XmlText) return value.toString();
  if (value instanceof Y.Array) return value.toArray().map(yToPlain);
  if (value instanceof Y.Map)
    return Object.fromEntries([...value.entries()].map(([key, entry]) => [key, yToPlain(entry)]));
  return value;
}

/** Above this many middle-segment comparisons the order is replaced whole. */
const ARRAY_DIFF_CELL_LIMIT = 4_000_000;

function longestCommonSubsequence<T>(left: readonly T[], right: readonly T[]) {
  const columns = right.length + 1;
  const lengths = new Uint32Array((left.length + 1) * columns);
  for (let i = left.length - 1; i >= 0; i -= 1)
    for (let j = right.length - 1; j >= 0; j -= 1)
      lengths[i * columns + j] = Object.is(left[i], right[j])
        ? lengths[(i + 1) * columns + j + 1]! + 1
        : Math.max(lengths[(i + 1) * columns + j]!, lengths[i * columns + j + 1]!);
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (Object.is(left[i], right[j])) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (lengths[(i + 1) * columns + j]! >= lengths[i * columns + j + 1]!) i += 1;
    else j += 1;
  }
  return pairs;
}

/**
 * Make `array` equal `values` with the smallest edit: entries both sides keep
 * are left in place, so a concurrent insert or delete by another collaborator
 * merges instead of both clients rewriting (and so duplicating) the whole list.
 */
export function replaceYArray<T>(array: Y.Array<T>, values: readonly T[]) {
  const current = array.toArray();
  let start = 0;
  while (
    start < current.length &&
    start < values.length &&
    Object.is(current[start], values[start])
  )
    start += 1;
  let currentEnd = current.length;
  let valuesEnd = values.length;
  while (
    currentEnd > start &&
    valuesEnd > start &&
    Object.is(current[currentEnd - 1], values[valuesEnd - 1])
  ) {
    currentEnd -= 1;
    valuesEnd -= 1;
  }
  if (start === currentEnd && start === valuesEnd) return;
  const removed = current.slice(start, currentEnd);
  const added = values.slice(start, valuesEnd);
  const kept =
    removed.length * added.length <= ARRAY_DIFF_CELL_LIMIT
      ? longestCommonSubsequence(removed, added)
      : [];
  // Walk the kept anchors from the end so earlier indexes stay valid.
  const anchors: Array<[number, number]> = [
    [-1, -1],
    ...kept,
    [removed.length, added.length],
  ];
  for (let index = anchors.length - 1; index > 0; index -= 1) {
    const [previousRemoved, previousAdded] = anchors[index - 1]!;
    const [nextRemoved, nextAdded] = anchors[index]!;
    const at = start + previousRemoved + 1;
    const deleteCount = nextRemoved - previousRemoved - 1;
    if (deleteCount > 0) array.delete(at, deleteCount);
    const inserted = added.slice(previousAdded + 1, nextAdded);
    if (inserted.length) array.insert(at, inserted);
  }
}

export function createHeadlessBinding(
  sharedTypes: readonly unknown[],
) {
  return {
    kind: "headless" as const,
    sharedTypes,
    destroy() {},
  };
}

export function isEmptyYjsUpdate(update: Uint8Array) {
  // An empty v1 update is encoded as two zero-length sections.
  return update.length <= 2;
}
