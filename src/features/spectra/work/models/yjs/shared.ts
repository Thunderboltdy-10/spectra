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

export function replaceYArray<T>(array: Y.Array<T>, values: readonly T[]) {
  if (
    array.length === values.length &&
    values.every((value, index) => Object.is(array.get(index), value))
  )
    return;
  if (array.length) array.delete(0, array.length);
  if (values.length) array.push([...values]);
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
