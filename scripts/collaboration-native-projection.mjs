import { yXmlFragmentToProsemirrorJSON } from "y-prosemirror";
import * as Y from "yjs";

export const NATIVE_PROJECTION_REGION = "$spectra:native-projection";

const WORK_ROOT_MAP = "spectra:work-v2";
const WORK_META_MAP = "spectra:work-v2:meta";
const WORK_LIVE_META_MAP = "spectra:work-v2:live-meta";
const DOCUMENT_FRAGMENT = "spectra:document-v2";
const CODE_FILES_MAP = "spectra:code-v2:files";
const CODE_FILE_ORDER = "spectra:code-v2:file-order";
const COLLECTION_MARKER = "$spectraCollection";
const VALUE_MARKER = "$spectraValue";
const WORK_MODEL_VERSION = 2;

const ATOMIC_STRING_FIELDS = new Set([
  "id", "type", "variant", "kind", "status", "priority", "difficulty",
  "language", "runtime", "runtimeVersion", "entryFileId", "pageId",
  "layerId", "parentId", "frameId", "sectionId", "layoutId", "masterId",
  "componentId", "sourceRange", "range", "formula", "mediaType", "assetId",
  "artifactId", "accountId", "provider", "externalId", "timezone", "url",
  "mode", "approval", "tone", "responseLength", "clarification",
  "versionPolicy", "pinnedVersionId",
]);
const TEXT_STRING_FIELDS = new Set([
  "text", "title", "name", "description", "prompt", "front", "back",
  "hint", "explanation", "correctAnswer", "rubric", "feedback",
  "instructions", "purpose", "audienceIntent", "releaseNotes",
  "speakerNotes", "label", "note", "taskTitle", "progressNote", "expected",
  "objective", "question", "answer", "criteria", "procedure",
  "releaseSummary",
]);
const TEXT_ARRAY_FIELDS = new Set([
  "options", "correctAnswers", "acceptedAlternatives", "outcomes", "examples",
  "negativeExamples", "inScope", "outOfScope", "boundaries",
]);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function replaceYText(text, value) {
  const current = text.toString();
  if (current === value) return;
  if (current.length) text.delete(0, current.length);
  if (value) text.insert(0, value);
}

function replaceYArray(array, values) {
  if (array.length) array.delete(0, array.length);
  if (values.length) array.push([...values]);
}

function plainToY(value) {
  if (Array.isArray(value)) {
    const array = new Y.Array();
    array.push(value.map(plainToY));
    return array;
  }
  if (value && typeof value === "object") {
    const map = new Y.Map();
    for (const [key, entry] of Object.entries(value)) map.set(key, plainToY(entry));
    return map;
  }
  return value;
}

function stringIsText(path) {
  const key = path.at(-1) ?? "";
  if (ATOMIC_STRING_FIELDS.has(key)) return false;
  return TEXT_STRING_FIELDS.has(key) || /(?:Text|Notes|Description|Prompt|Content)$/i.test(key);
}

function stableId(value, index) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    typeof value.id === "string" && value.id.trim()
    ? value.id
    : `item-${index + 1}`;
}

function initializeCollection(map) {
  map.set(COLLECTION_MARKER, true);
  map.set("order", new Y.Array());
  map.set("items", new Y.Map());
}

function syncCollection(collection, values, path) {
  const order = collection.get("order");
  const items = collection.get("items");
  const ids = values.map(stableId);
  const keep = new Set(ids);
  for (const id of [...items.keys()]) if (!keep.has(id)) items.delete(id);
  values.forEach((entry, index) => {
    const id = ids[index];
    let item = items.get(id);
    if (!(item instanceof Y.Map)) {
      item = new Y.Map();
      items.set(id, item);
    }
    syncRecord(item, record(entry)[VALUE_MARKER] === undefined &&
      entry && typeof entry === "object" && !Array.isArray(entry)
      ? entry
      : { [VALUE_MARKER]: entry }, [...path, id]);
  });
  replaceYArray(order, ids);
}

function syncArray(existing, values, path) {
  const keyed = values.length > 0 && values.every((entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry) &&
    typeof entry.id === "string");
  if (keyed) {
    syncCollection(existing, values, path);
    return existing;
  }
  const array = existing instanceof Y.Array ? existing : new Y.Array();
  const textArray = TEXT_ARRAY_FIELDS.has(path.at(-1) ?? "") &&
    values.every((entry) => typeof entry === "string");
  if (array.length) array.delete(0, array.length);
  if (textArray) {
    for (const entry of values) array.push([new Y.Text(String(entry))]);
    return array;
  }
  values.forEach((entry, index) => {
    const nextPath = [...path, String(index)];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const child = new Y.Map();
      array.push([child]);
      syncRecord(child, entry, nextPath);
    } else if (Array.isArray(entry)) {
      const child = new Y.Array();
      array.push([child]);
      syncArray(child, entry, nextPath);
    } else array.push([entry]);
  });
  return array;
}

function syncRecord(map, value, path) {
  const keys = new Set(Object.keys(value));
  for (const key of [...map.keys()]) if (!keys.has(key)) map.delete(key);
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = [...path, key];
    const existing = map.get(key);
    if (typeof entry === "string" && stringIsText(nextPath)) {
      const text = existing instanceof Y.Text ? existing : new Y.Text();
      if (text !== existing) map.set(key, text);
      replaceYText(text, entry);
    } else if (Array.isArray(entry)) {
      const keyed = entry.length > 0 && entry.every((candidate) =>
        candidate && typeof candidate === "object" && !Array.isArray(candidate) &&
        typeof candidate.id === "string");
      let attached = existing;
      if (keyed && !(existing instanceof Y.Map && existing.get(COLLECTION_MARKER) === true)) {
        attached = new Y.Map();
        map.set(key, attached);
        initializeCollection(attached);
      } else if (!keyed && !(existing instanceof Y.Array)) {
        attached = new Y.Array();
        map.set(key, attached);
      }
      syncArray(attached, entry, nextPath);
    } else if (entry && typeof entry === "object") {
      const child = existing instanceof Y.Map && existing.get(COLLECTION_MARKER) !== true
        ? existing
        : new Y.Map();
      if (child !== existing) map.set(key, child);
      syncRecord(child, entry, nextPath);
    } else map.set(key, entry);
  }
}

function textContent(node) {
  if (typeof node?.text === "string") return node.text;
  return (node?.content ?? [])
    .map(textContent)
    .join(node?.type === "listItem" ? "" : "\n");
}

function blocksFromJson(json) {
  const seen = new Set();
  return (json?.content ?? []).map((node, index) => {
    let id =
      typeof node?.attrs?.blockId === "string" && node.attrs.blockId
        ? node.attrs.blockId
        : `block-${index + 1}`;
    if (seen.has(id)) {
      let suffix = 2;
      while (seen.has(`${id}~${suffix}`)) suffix += 1;
      id = `${id}~${suffix}`;
    }
    seen.add(id);
    const text = textContent(node).trimEnd();
    if (node?.type === "heading")
      return {
        id,
        type: "heading",
        text,
        attrs: {
          level: Number(node.attrs?.level) || 2,
          styleId: `Heading${Number(node.attrs?.level) || 2}`,
        },
      };
    if (node?.type === "blockquote") return { id, type: "quote", text };
    if (node?.type === "bulletList" || node?.type === "orderedList")
      return { id, type: "list", text };
    if (node?.type === "callout")
      return {
        id,
        type: "callout",
        text,
        attrs: { tone: node.attrs?.type ?? "info" },
      };
    if (node?.type === "equation")
      return {
        id,
        type: "equation",
        text: String(node.attrs?.latex ?? ""),
        latex: String(node.attrs?.latex ?? ""),
        attrs: {
          display: node.attrs?.display ?? "block",
          alignment: node.attrs?.alignment ?? "center",
        },
      };
    if (node?.type === "codeBlock")
      return {
        id,
        type: "code",
        text,
        attrs: { language: node.attrs?.language ?? undefined },
      };
    if (node?.type === "spectraReference")
      return {
        id,
        type: "paragraph",
        text: String(node.attrs?.label ?? "Referenced work"),
        reference: node.attrs,
      };
    if (node?.type === "spectraCitation")
      return {
        id,
        type: "paragraph",
        text: String(node.attrs?.label ?? "Citation"),
        citation: node.attrs,
      };
    return { id, type: "paragraph", text };
  });
}

function inlineText(value) {
  return value ? [{ type: "text", text: value }] : undefined;
}

function blockToJson(block, index) {
  const id = typeof block?.id === "string" && block.id.trim()
    ? block.id
    : `block-${index + 1}`;
  const value = typeof block?.text === "string" ? block.text : "";
  const attrs = record(block?.attrs);
  if (block?.type === "heading")
    return {
      type: "heading",
      attrs: { blockId: id, level: [1, 2, 3].includes(Number(attrs.level)) ? Number(attrs.level) : 2 },
      content: inlineText(value),
    };
  if (block?.type === "quote")
    return { type: "blockquote", attrs: { blockId: id }, content: [{ type: "paragraph", content: inlineText(value) }] };
  if (block?.type === "list")
    return {
      type: "bulletList",
      attrs: { blockId: id },
      content: (value.split(/\r?\n/).filter(Boolean).length ? value.split(/\r?\n/).filter(Boolean) : [""])
        .map((entry) => ({ type: "listItem", content: [{ type: "paragraph", content: inlineText(entry) }] })),
    };
  if (block?.type === "callout")
    return { type: "callout", attrs: { blockId: id, type: attrs.tone ?? "info" }, content: [{ type: "paragraph", content: inlineText(value) }] };
  if (block?.type === "math" || block?.type === "equation")
    return {
      type: "equation",
      attrs: {
        blockId: id,
        latex: typeof block?.latex === "string" ? block.latex : value,
        display: attrs.display ?? "block",
        alignment: attrs.alignment ?? "center",
      },
    };
  if (block?.type === "code")
    return { type: "codeBlock", attrs: { blockId: id, language: attrs.language ?? null }, content: inlineText(value) };
  return { type: "paragraph", attrs: { blockId: id }, content: inlineText(value) };
}

function documentContentToJson(content) {
  const existing = record(content?.tiptap);
  if (existing.type === "doc") return existing;
  const blocks = Array.isArray(content?.blocks)
    ? content.blocks.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    : [];
  return {
    type: "doc",
    content: (blocks.length ? blocks : [{ id: "intro", type: "paragraph", text: "" }])
      .map(blockToJson),
  };
}

function appendJsonNode(parent, node) {
  if (node?.type === "text") {
    const text = new Y.XmlText();
    parent.push([text]);
    text.insert(0, node.text ?? "", {
      ...Object.fromEntries((node.marks ?? []).map((mark) => [mark.type, mark.attrs ?? {}])),
    });
    return;
  }
  if (!node?.type || node.type === "doc") {
    for (const child of node?.content ?? []) appendJsonNode(parent, child);
    return;
  }
  const element = new Y.XmlElement(node.type);
  parent.push([element]);
  for (const [key, value] of Object.entries(node.attrs ?? {}))
    if (value !== undefined) element.setAttribute(key, value);
  for (const child of node.content ?? []) appendJsonNode(element, child);
}

function setNativeEnvelope(document, projection) {
  const meta = document.getMap(WORK_META_MAP);
  meta.set("initialized", true);
  meta.set("workType", projection.typeKey);
  meta.set("modelVersion", WORK_MODEL_VERSION);
  const liveMeta = document.getMap(WORK_LIVE_META_MAP);
  liveMeta.set("title", projection.title);
  liveMeta.set("summary", projection.summary ?? "");
  liveMeta.set("tags", [...projection.tags]);
}

function initializeDocument(document, content) {
  const value = record(content);
  const { blocks: _blocks, tiptap: _tiptap, outline: _outline, ...extras } = value;
  document.getMap(WORK_ROOT_MAP).set("extras", plainToY(extras));
  appendJsonNode(document.getXmlFragment(DOCUMENT_FRAGMENT), documentContentToJson(value));
}

function initializeCode(document, content) {
  const value = record(content);
  const files = Array.isArray(value.files) ? value.files : [];
  const fileMap = document.getMap(CODE_FILES_MAP);
  const order = document.getArray(CODE_FILE_ORDER);
  for (const entry of files) {
    const file = record(entry);
    const id = String(file.id ?? "");
    if (!id) continue;
    const map = new Y.Map();
    map.set("source", new Y.Text(String(file.source ?? "")));
    map.set("id", id);
    map.set("path", String(file.path ?? "untitled.txt"));
    map.set("language", String(file.language ?? "text"));
    map.set("mediaType", String(file.mediaType ?? "text/plain"));
    map.set("generated", file.generated === true);
    map.set("lineIds", Array.isArray(file.lineIds) ? file.lineIds.filter((item) => typeof item === "string") : []);
    fileMap.set(id, map);
    order.push([id]);
  }
  const { files: _files, ...project } = value;
  document.getMap(WORK_ROOT_MAP).set("project", plainToY(project));
}

export function initializeNativeArtifactDocument(document, projection) {
  if (isNativeArtifactDocument(document)) return false;
  if (!projection || typeof projection !== "object" || Array.isArray(projection))
    throw new Error("COLLABORATION_NATIVE_BOOTSTRAP_INVALID");
  if (
    typeof projection.typeKey !== "string" ||
    typeof projection.title !== "string" ||
    !Array.isArray(projection.tags) ||
    !projection.tags.every((tag) => typeof tag === "string") ||
    !projection.content ||
    typeof projection.content !== "object" ||
    Array.isArray(projection.content)
  )
    throw new Error("COLLABORATION_NATIVE_BOOTSTRAP_INVALID");
  document.transact(() => {
    if (projection.typeKey === "document") initializeDocument(document, projection.content);
    else if (projection.typeKey === "code") initializeCode(document, projection.content);
    else syncRecord(document.getMap(WORK_ROOT_MAP), projection.content, [projection.typeKey]);
    setNativeEnvelope(document, projection);
  }, "gateway-bootstrap");
  return true;
}

function projectCollection(collection) {
  const order = collection.get("order");
  const items = collection.get("items");
  if (!(order instanceof Y.Array) || !(items instanceof Y.Map)) return [];
  return order.toArray().flatMap((id) => {
    const item = items.get(String(id));
    if (!(item instanceof Y.Map)) return [];
    const projected = projectMap(item);
    return Object.prototype.hasOwnProperty.call(projected, VALUE_MARKER)
      ? [projected[VALUE_MARKER]]
      : [projected];
  });
}

function projectValue(value) {
  if (value instanceof Y.Text || value instanceof Y.XmlText)
    return value.toString();
  if (value instanceof Y.Array) return value.toArray().map(projectValue);
  if (value instanceof Y.Map)
    return value.get(COLLECTION_MARKER) === true
      ? projectCollection(value)
      : projectMap(value);
  return value;
}

function projectMap(map) {
  return Object.fromEntries(
    [...map.entries()].map(([key, value]) => [key, projectValue(value)]),
  );
}

function projectDocument(document) {
  const root = document.getMap(WORK_ROOT_MAP);
  const extras = projectValue(root.get("extras"));
  const tiptap = yXmlFragmentToProsemirrorJSON(
    document.getXmlFragment(DOCUMENT_FRAGMENT),
  );
  const blocks = blocksFromJson(tiptap);
  return {
    ...record(extras),
    tiptap,
    blocks: blocks.length
      ? blocks
      : [{ id: "intro", type: "paragraph", text: "" }],
    outline: blocks
      .filter((block) => block.type === "heading")
      .map((block) => ({
        id: block.id,
        title: block.text,
        level: Number(record(block.attrs).level) || 2,
      })),
  };
}

function projectCodeFile(map) {
  const source = map.get("source");
  return {
    id: String(map.get("id") ?? ""),
    path: String(map.get("path") ?? "untitled.txt"),
    language: String(map.get("language") ?? "text"),
    source: source instanceof Y.Text ? source.toString() : "",
    ...(Array.isArray(map.get("lineIds"))
      ? {
          lineIds: map
            .get("lineIds")
            .filter((entry) => typeof entry === "string"),
        }
      : {}),
    ...(typeof map.get("mediaType") === "string"
      ? { mediaType: String(map.get("mediaType")) }
      : {}),
    ...(map.get("generated") === true ? { generated: true } : {}),
  };
}

function projectCode(document) {
  const root = document.getMap(WORK_ROOT_MAP);
  const project = projectValue(root.get("project"));
  const files = document.getMap(CODE_FILES_MAP);
  const ordered = document
    .getArray(CODE_FILE_ORDER)
    .toArray()
    .flatMap((fileId) => {
      const map = files.get(fileId);
      return map instanceof Y.Map ? [projectCodeFile(map)] : [];
    });
  return { ...record(project), files: ordered };
}

export function isNativeArtifactDocument(document) {
  return document.getMap(WORK_META_MAP).get("initialized") === true;
}

export function nativeArtifactProjection(document, schemaVersion) {
  const meta = document.getMap(WORK_META_MAP);
  if (meta.get("initialized") !== true) return null;
  const typeKey = meta.get("workType");
  const modelVersion = meta.get("modelVersion");
  const liveMeta = document.getMap(WORK_LIVE_META_MAP);
  const title = liveMeta.get("title");
  const summary = liveMeta.get("summary");
  const tags = liveMeta.get("tags");
  if (
    typeof typeKey !== "string" ||
    typeof modelVersion !== "number" ||
    typeof title !== "string" ||
    !Array.isArray(tags) ||
    !tags.every((tag) => typeof tag === "string") ||
    !Number.isSafeInteger(schemaVersion) ||
    schemaVersion < 1
  )
    throw new Error("COLLABORATION_NATIVE_PROJECTION_INVALID");
  const content =
    typeKey === "document"
      ? projectDocument(document)
      : typeKey === "code"
        ? projectCode(document)
        : projectMap(document.getMap(WORK_ROOT_MAP));
  return {
    title,
    ...(typeof summary === "string" && summary ? { summary } : {}),
    tags,
    typeKey,
    schemaVersion,
    content,
  };
}
