import { yXmlFragmentToProsemirrorJSON } from "y-prosemirror";
import * as Y from "yjs";
import { isIdentityCollection } from "../shared/yjs-collections.mjs";
import { withPlannerCollections } from "../shared/planner-source.mjs";
import { sheetCellRegionId } from "../shared/sheet-regions.mjs";
import {
  documentBlocksFromJson as canonicalDocumentBlocksFromJson,
  documentContentToProseMirrorJson,
} from "../shared/document-projection.mjs";

export const NATIVE_PROJECTION_REGION = "$spectra:native-projection";

const WORK_ROOT_MAP = "spectra:work-v2";
const WORK_META_MAP = "spectra:work-v2:meta";
const WORK_LIVE_META_MAP = "spectra:work-v2:live-meta";
const DOCUMENT_FRAGMENT = "spectra:document-v2";
const CODE_FILES_MAP = "spectra:code-v2:files";
const CODE_FILE_ORDER = "spectra:code-v2:file-order";
const COLLECTION_MARKER = "$spectraCollection";
const VALUE_MARKER = "$spectraValue";
const SHEET_CELLS_MARKER = "$spectraSheetCells";
const WORK_MODEL_VERSION = 2;

const ATOMIC_STRING_FIELDS = new Set([
  "id",
  "type",
  "variant",
  "kind",
  "status",
  "priority",
  "difficulty",
  "language",
  "runtime",
  "runtimeVersion",
  "entryFileId",
  "pageId",
  "layerId",
  "parentId",
  "frameId",
  "sectionId",
  "layoutId",
  "masterId",
  "componentId",
  "sourceRange",
  "range",
  "formula",
  "mediaType",
  "assetId",
  "artifactId",
  "accountId",
  "provider",
  "externalId",
  "timezone",
  "url",
  "mode",
  "approval",
  "tone",
  "responseLength",
  "clarification",
  "versionPolicy",
  "pinnedVersionId",
]);
const TEXT_STRING_FIELDS = new Set([
  "text",
  "title",
  "name",
  "description",
  "prompt",
  "front",
  "back",
  "hint",
  "explanation",
  "correctAnswer",
  "rubric",
  "feedback",
  "instructions",
  "purpose",
  "audienceIntent",
  "releaseNotes",
  "speakerNotes",
  "label",
  "note",
  "taskTitle",
  "progressNote",
  "expected",
  "objective",
  "question",
  "answer",
  "criteria",
  "procedure",
  "releaseSummary",
]);
const TEXT_ARRAY_FIELDS = new Set([
  "options",
  "correctAnswers",
  "acceptedAlternatives",
  "outcomes",
  "examples",
  "negativeExamples",
  "inScope",
  "outOfScope",
  "boundaries",
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
  if (
    array.length === values.length &&
    values.every((value, index) => Object.is(array.get(index), value))
  )
    return;
  if (array.length) array.delete(0, array.length);
  if (values.length) array.push([...values]);
}

function plainEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => plainEqual(entry, right[index]))
    );
  const leftRecord = record(left);
  const rightRecord = record(right);
  if (leftRecord !== left || rightRecord !== right) return false;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) &&
        plainEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function plainToY(value) {
  if (Array.isArray(value)) {
    const array = new Y.Array();
    array.push(value.map(plainToY));
    return array;
  }
  if (value && typeof value === "object") {
    const map = new Y.Map();
    for (const [key, entry] of Object.entries(value))
      map.set(key, plainToY(entry));
    return map;
  }
  return value;
}

function stringIsText(path) {
  const key = path.at(-1) ?? "";
  if (ATOMIC_STRING_FIELDS.has(key)) return false;
  return (
    TEXT_STRING_FIELDS.has(key) ||
    /(?:Text|Notes|Description|Prompt|Content)$/i.test(key)
  );
}

function stableId(value, index) {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.id === "string" &&
    value.id.trim()
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
    syncRecord(
      item,
      record(entry)[VALUE_MARKER] === undefined &&
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry)
        ? entry
        : { [VALUE_MARKER]: entry },
      [...path, id],
    );
  });
  replaceYArray(order, ids);
}

function syncArray(existing, values, path) {
  const keyed = isIdentityCollection(values, path, existing instanceof Y.Map && existing.get(COLLECTION_MARKER) === true);
  if (keyed) {
    syncCollection(existing, values, path);
    return existing;
  }
  const array = existing instanceof Y.Array ? existing : new Y.Array();
  const textArray =
    TEXT_ARRAY_FIELDS.has(path.at(-1) ?? "") &&
    values.every((entry) => typeof entry === "string");
  if (textArray) {
    if (array.length > values.length)
      array.delete(values.length, array.length - values.length);
    values.forEach((entry, index) => {
      const current = array.get(index);
      if (current instanceof Y.Text) {
        replaceYText(current, String(entry));
        return;
      }
      const text = new Y.Text();
      if (index < array.length) array.delete(index, 1);
      array.insert(index, [text]);
      replaceYText(text, String(entry));
    });
    return array;
  }
  if (plainEqual(projectValue(array), values)) return array;
  if (array.length) array.delete(0, array.length);
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

function isSheetCellsPath(path) {
  return path[0] === "sheets" && path.at(-1) === "cells" && path.length >= 3;
}

const SHEET_CELLS_ENCODING = "spectra-sheet-cells-v1";

/**
 * Convex stores dense sheets as bounded chunks. Gateway bootstrap must expand
 * them into address-keyed cells before Yjs sync — otherwise encoding/chunks
 * land as fake addresses and normalizeSheetsContent drops every cell (Empty
 * sheet on Library 200k open).
 */
function expandSheetCellsRecord(cells) {
  if (!cells || typeof cells !== "object" || Array.isArray(cells)) return {};
  if (
    cells.encoding === SHEET_CELLS_ENCODING &&
    Array.isArray(cells.chunks)
  ) {
    const entries = [];
    for (const chunk of cells.chunks) {
      if (!Array.isArray(chunk)) continue;
      for (const candidate of chunk) {
        if (
          Array.isArray(candidate) &&
          candidate.length === 2 &&
          typeof candidate[0] === "string"
        )
          entries.push(candidate);
      }
    }
    return Object.fromEntries(entries);
  }
  return cells;
}

function decodeSheetsContentForYjs(content) {
  const source =
    content && typeof content === "object" && !Array.isArray(content)
      ? content
      : null;
  if (!source || !Array.isArray(source.sheets)) return content;
  return {
    ...source,
    sheets: source.sheets.map((sheet) => {
      if (!sheet || typeof sheet !== "object" || Array.isArray(sheet))
        return sheet;
      return { ...sheet, cells: expandSheetCellsRecord(sheet.cells) };
    }),
  };
}

function encodeSheetCellValue(cell) {
  return JSON.stringify(cell);
}

function decodeSheetCellValue(value) {
  if (value instanceof Y.Map) return projectMap(value);
  if (typeof value !== "string") return projectValue(value);
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : { value };
  } catch {
    return { value };
  }
}

function syncSheetCells(map, cells) {
  const expanded = expandSheetCellsRecord(cells);
  map.set(SHEET_CELLS_MARKER, true);
  const keep = new Set(Object.keys(expanded));
  keep.add(SHEET_CELLS_MARKER);
  for (const key of [...map.keys()]) if (!keep.has(key)) map.delete(key);
  for (const [address, cell] of Object.entries(expanded)) {
    const encoded =
      cell && typeof cell === "object" && !Array.isArray(cell)
        ? encodeSheetCellValue(cell)
        : JSON.stringify({ value: cell });
    if (map.get(address) !== encoded) map.set(address, encoded);
  }
}

function syncRecord(map, value, path) {
  if (isSheetCellsPath(path)) {
    syncSheetCells(map, value);
    return;
  }
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
      const keyed = isIdentityCollection(entry, nextPath, existing instanceof Y.Map && existing.get(COLLECTION_MARKER) === true);
      let attached = existing;
      if (
        keyed &&
        !(existing instanceof Y.Map && existing.get(COLLECTION_MARKER) === true)
      ) {
        attached = new Y.Map();
        map.set(key, attached);
        initializeCollection(attached);
      } else if (!keyed && !(existing instanceof Y.Array)) {
        attached = new Y.Array();
        map.set(key, attached);
      }
      syncArray(attached, entry, nextPath);
    } else if (entry && typeof entry === "object") {
      const child =
        existing instanceof Y.Map && existing.get(COLLECTION_MARKER) !== true
          ? existing
          : new Y.Map();
      if (child !== existing) map.set(key, child);
      syncRecord(child, entry, nextPath);
    } else if (!Object.is(existing, entry)) map.set(key, entry);
  }
}

function appendJsonNode(parent, node) {
  if (node?.type === "text") {
    const text = new Y.XmlText();
    parent.push([text]);
    text.insert(0, node.text ?? "", {
      ...Object.fromEntries(
        (node.marks ?? []).map((mark) => [mark.type, mark.attrs ?? {}]),
      ),
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
  if (meta.get("initialized") !== true) meta.set("initialized", true);
  if (meta.get("workType") !== projection.typeKey)
    meta.set("workType", projection.typeKey);
  if (meta.get("modelVersion") !== WORK_MODEL_VERSION)
    meta.set("modelVersion", WORK_MODEL_VERSION);
  const liveMeta = document.getMap(WORK_LIVE_META_MAP);
  if (liveMeta.get("title") !== projection.title)
    liveMeta.set("title", projection.title);
  if (liveMeta.get("summary") !== (projection.summary ?? ""))
    liveMeta.set("summary", projection.summary ?? "");
  const currentTags = liveMeta.get("tags");
  if (
    !Array.isArray(currentTags) ||
    currentTags.length !== projection.tags.length ||
    currentTags.some((tag, index) => tag !== projection.tags[index])
  )
    liveMeta.set("tags", [...projection.tags]);
}

function initializeDocument(document, content) {
  const value = record(content);
  const {
    blocks: _blocks,
    tiptap: _tiptap,
    outline: _outline,
    ...extras
  } = value;
  document.getMap(WORK_ROOT_MAP).set("extras", plainToY(extras));
  appendJsonNode(
    document.getXmlFragment(DOCUMENT_FRAGMENT),
    documentContentToProseMirrorJson(value),
  );
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
    map.set(
      "lineIds",
      Array.isArray(file.lineIds)
        ? file.lineIds.filter((item) => typeof item === "string")
        : [],
    );
    fileMap.set(id, map);
    order.push([id]);
  }
  const { files: _files, ...project } = value;
  document.getMap(WORK_ROOT_MAP).set("project", plainToY(project));
}

export function initializeNativeArtifactDocument(document, projection) {
  if (isNativeArtifactDocument(document)) return false;
  if (
    !projection ||
    typeof projection !== "object" ||
    Array.isArray(projection)
  )
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
  const bootstrapContent =
    projection.typeKey === "sheets"
      ? decodeSheetsContentForYjs(projection.content)
      : projection.typeKey === "planner_task"
        ? withPlannerCollections(projection.content)
        : projection.content;
  document.transact(() => {
    if (projection.typeKey === "document")
      initializeDocument(document, bootstrapContent);
    else if (projection.typeKey === "code")
      initializeCode(document, bootstrapContent);
    else
      syncRecord(document.getMap(WORK_ROOT_MAP), bootstrapContent, [
        projection.typeKey,
      ]);
    setNativeEnvelope(document, projection);
  }, "gateway-bootstrap");
  return true;
}

function projectCollection(collection) {
  const order = collection.get("order");
  const items = collection.get("items");
  if (!(order instanceof Y.Array) || !(items instanceof Y.Map)) return [];
  // Mirrors the client projection: concurrent moves can leave an id twice.
  const seen = new Set();
  return order.toArray().flatMap((id) => {
    if (seen.has(String(id))) return [];
    seen.add(String(id));
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
  if (map.get(SHEET_CELLS_MARKER) === true) {
    return Object.fromEntries(
      [...map.entries()]
        .filter(([key]) => key !== SHEET_CELLS_MARKER)
        .map(([key, value]) => [key, decodeSheetCellValue(value)]),
    );
  }
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
  const blocks = canonicalDocumentBlocksFromJson(tiptap);
  const projectedExtras = record(extras);
  return {
    ...projectedExtras,
    tiptap,
    blocks: blocks.length
      ? blocks
      : [{ id: "intro", type: "paragraph", text: "" }],
    ...(projectedExtras.nativeBinding
      ? { nativeProjectionComplete: true }
      : {}),
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

function collectEntitySignatures(value, signatures = new Map()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectEntitySignatures(entry, signatures);
    return signatures;
  }
  if (!value || typeof value !== "object") return signatures;
  const node = value;
  if (typeof node.id === "string" && node.id.trim())
    signatures.set(node.id, JSON.stringify(node));
  for (const entry of Object.values(node))
    collectEntitySignatures(entry, signatures);
  return signatures;
}

export function nativeChangedRegionIds(beforeProjection, afterProjection) {
  if (!afterProjection) return [NATIVE_PROJECTION_REGION];
  if (!beforeProjection || beforeProjection.typeKey !== afterProjection.typeKey)
    return ["artifact:structure"];
  const changed = [];
  if (beforeProjection.title !== afterProjection.title)
    changed.push("metadata:title");
  if ((beforeProjection.summary ?? "") !== (afterProjection.summary ?? ""))
    changed.push("metadata:summary");
  if (
    JSON.stringify(beforeProjection.tags) !==
    JSON.stringify(afterProjection.tags)
  )
    changed.push("metadata:tags");
  if (afterProjection.typeKey === "sheets") {
    const { sheets: beforeSheets, ...beforeRoot } = beforeProjection.content;
    const { sheets: afterSheets, ...afterRoot } = afterProjection.content;
    if (JSON.stringify(beforeRoot) !== JSON.stringify(afterRoot) || beforeSheets.length !== afterSheets.length)
      return ["artifact:structure", ...changed];
    for (let index = 0; index < beforeSheets.length; index += 1) {
      const { cells: beforeCells, ...beforeStructure } = beforeSheets[index];
      const { cells: afterCells, ...afterStructure } = afterSheets[index];
      if (JSON.stringify(beforeStructure) !== JSON.stringify(afterStructure))
        return ["artifact:structure", ...changed];
      for (const address of new Set([...Object.keys(beforeCells), ...Object.keys(afterCells)])) {
        if (JSON.stringify(beforeCells[address]) === JSON.stringify(afterCells[address])) continue;
        changed.push(sheetCellRegionId(afterSheets[index], address));
        if (changed.length > 128) return ["artifact:structure"];
      }
    }
    return changed.length ? changed : [NATIVE_PROJECTION_REGION];
  }
  const beforeContent = JSON.stringify(beforeProjection.content);
  const afterContent = JSON.stringify(afterProjection.content);
  if (beforeContent === afterContent)
    return changed.length > 0 ? changed : [NATIVE_PROJECTION_REGION];
  const beforeIds = collectEntitySignatures(beforeProjection.content);
  const afterIds = collectEntitySignatures(afterProjection.content);
  const beforeKeys = [...beforeIds.keys()].sort();
  const afterKeys = [...afterIds.keys()].sort();
  if (
    beforeKeys.length !== afterKeys.length ||
    beforeKeys.some((key, index) => key !== afterKeys[index])
  )
    return ["artifact:structure", ...changed];
  for (const [id, signature] of afterIds)
    if (beforeIds.get(id) !== signature) changed.push(id);
  // A whole-document edit uses the existing structural claim. Never truncate
  // the changed tail or send an unbounded attribution list to the ledger.
  if (changed.length > 128) return ["artifact:structure"];
  return changed.length > 0
    ? [...new Set(changed)]
    : [NATIVE_PROJECTION_REGION];
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
