import * as Y from "yjs";
import { enumerateArtifactRegions, validateArtifactContent } from "../../../artifacts/registry";
import type { ArtifactTypeKey, SemanticRegion } from "../../../artifacts/types";
import { normalizeArtifactContent } from "../../../ai/content-normalization";
import { normalizeFoundryContent } from "../../../agents/foundry/foundry-document";
import { normalizePresentationContent } from "../../../presentation/model";
import { sheetCellEntries } from "../../../../../../shared/sheet-cells";
import { sheetCellRegionId } from "../../../../../../shared/sheet-regions.mjs";
import {
  normalizeSheetsContent,
  type SheetCell,
  type SheetsContent,
} from "../../../sheets/model";
import { changedSheetCellAddresses } from "../../../sheets/cell-overlay";
import { sharedTimetableContent } from "../../../timetable/model";
import { normalizeWhiteboardContent } from "../../../whiteboard/model";
import type {
  LegacyWorkSnapshot,
  WorkActorIdentity,
  WorkBinding,
  WorkMigrationResult,
  WorkTransactionOrigin,
  WorkValidationResult,
  WorkYjsAdapter,
  WorkYjsOriginSet,
} from "./contracts";
import { WORK_YJS_SCHEMA_VERSION } from "./contracts";
import { workYjsOrigins } from "./origins";
import {
  assertWorkModelMetadata,
  createHeadlessBinding,
  replaceYArray,
  replaceYText,
  setWorkModelMetadata,
  workRoot,
} from "./shared";

const COLLECTION_MARKER = "$spectraCollection";
const VALUE_MARKER = "$spectraValue";
const SHEET_CELLS_MARKER = "$spectraSheetCells";
const STRUCTURED_ROLLBACK_MAP = "spectra:structured-v2:rollback";

type JsonRecord = Record<string, unknown>;
type Normalizer<T> = (value: unknown) => T;

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

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stableId(value: unknown, index: number) {
  return isRecord(value) && typeof value.id === "string" && value.id.trim()
    ? value.id
    : `item-${index + 1}`;
}

function stringIsText(path: readonly string[]) {
  const key = path.at(-1) ?? "";
  if (ATOMIC_STRING_FIELDS.has(key)) return false;
  return TEXT_STRING_FIELDS.has(key) || /(?:Text|Notes|Description|Prompt|Content)$/i.test(key);
}

function collectionMap() {
  const map = new Y.Map<unknown>();
  return map;
}

function initializeCollection(map: Y.Map<unknown>) {
  if (map.get(COLLECTION_MARKER) === true) return;
  map.set(COLLECTION_MARKER, true);
  map.set("order", new Y.Array<string>());
  map.set("items", new Y.Map<Y.Map<unknown>>());
}

function isCollection(map: Y.Map<unknown>) {
  return map.get(COLLECTION_MARKER) === true;
}

function plainEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => plainEqual(entry, right[index]))
    );
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        plainEqual(left[key], right[key]),
    )
  );
}

/**
 * Keyed lists live in a collection. A list that is emptied stays a collection,
 * so a collaborator adding an item at the same moment is merged rather than
 * lost when one client swaps the whole field for a plain array.
 */
function isKeyedCollectionValue(existing: unknown, values: readonly unknown[]) {
  if (!values.every((entry) => isRecord(entry) && typeof entry.id === "string"))
    return false;
  return values.length > 0 || (existing instanceof Y.Map && isCollection(existing));
}

function syncCollection(
  collection: Y.Map<unknown>,
  values: readonly unknown[],
  path: readonly string[],
) {
  const order = collection.get("order") as Y.Array<string>;
  const items = collection.get("items") as Y.Map<Y.Map<unknown>>;
  const ids = values.map(stableId);
  const keep = new Set(ids);
  for (const id of [...items.keys()]) if (!keep.has(id)) items.delete(id);
  values.forEach((entry, index) => {
    const id = ids[index]!;
    let item = items.get(id);
    if (!item) {
      item = new Y.Map<unknown>();
      items.set(id, item);
    }
    syncRecord(item, isRecord(entry) ? entry : { [VALUE_MARKER]: entry }, [...path, id]);
  });
  replaceYArray(order, ids);
}

function syncArray(
  existing: unknown,
  values: readonly unknown[],
  path: readonly string[],
) {
  const keyed = isKeyedCollectionValue(existing, values);
  if (keyed) {
    if (!(existing instanceof Y.Map && isCollection(existing)))
      throw new Error("STRUCTURED_COLLECTION_MUST_BE_ATTACHED_BEFORE_SYNC");
    const collection = existing;
    syncCollection(collection, values, path);
    return collection;
  }
  const array = existing instanceof Y.Array ? existing : new Y.Array<unknown>();
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
    if (isRecord(entry)) {
      const child = new Y.Map<unknown>();
      array.push([child]);
      syncRecord(child, entry, nextPath);
    } else if (Array.isArray(entry)) {
      const child = new Y.Array<unknown>();
      array.push([child]);
      syncArray(child, entry, nextPath);
    } else {
      array.push([entry]);
    }
  });
  return array;
}

function isSheetCellsPath(path: readonly string[]) {
  return path[0] === "sheets" && path.at(-1) === "cells" && path.length >= 3;
}

function encodeSheetCellValue(cell: JsonRecord) {
  return JSON.stringify(cell);
}

function decodeSheetCellValue(value: unknown): unknown {
  if (value instanceof Y.Map) return projectMap(value);
  if (typeof value !== "string") return projectValue(value);
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : { value };
  } catch {
    return { value };
  }
}

function expandSheetCellsRecord(cells: unknown): JsonRecord {
  // Convex chunked cells must expand before Yjs address sync — otherwise
  // encoding/chunks become fake keys and the studio paints Empty sheet.
  return Object.fromEntries(sheetCellEntries(cells));
}

function syncSheetCells(map: Y.Map<unknown>, cells: JsonRecord) {
  const expanded = expandSheetCellsRecord(cells);
  map.set(SHEET_CELLS_MARKER, true);
  const keep = new Set(Object.keys(expanded));
  keep.add(SHEET_CELLS_MARKER);
  for (const key of [...map.keys()]) if (!keep.has(key)) map.delete(key);
  for (const [address, cell] of Object.entries(expanded)) {
    const encoded = isRecord(cell) ? encodeSheetCellValue(cell) : JSON.stringify({ value: cell });
    if (map.get(address) !== encoded) map.set(address, encoded);
  }
}

function syncRecord(map: Y.Map<unknown>, value: JsonRecord, path: readonly string[]) {
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
      if (!(existing instanceof Y.Text)) map.set(key, text);
      replaceYText(text, entry);
    } else if (Array.isArray(entry)) {
      const keyed = isKeyedCollectionValue(existing, entry);
      let attached = existing;
      if (keyed && !(existing instanceof Y.Map && isCollection(existing))) {
        const collection = collectionMap();
        map.set(key, collection);
        initializeCollection(collection);
        attached = collection;
      } else if (!keyed && !(existing instanceof Y.Array)) {
        const array = new Y.Array<unknown>();
        map.set(key, array);
        attached = array;
      }
      const array = syncArray(attached, entry, nextPath);
      if (array !== attached) map.set(key, array);
    } else if (isRecord(entry)) {
      const child = existing instanceof Y.Map && !isCollection(existing) ? existing : new Y.Map<unknown>();
      if (child !== existing) map.set(key, child);
      syncRecord(child, entry, nextPath);
    } else {
      if (!Object.is(existing, entry)) map.set(key, entry);
    }
  }
}

export type SheetsCellProjectionChange = {
  sheetId: string;
  address: string;
  cell?: SheetCell;
  regionId: string;
};

export type SheetsCellProjectionPlan = {
  content: SheetsContent;
  changes: SheetsCellProjectionChange[];
};

function sheetIdentityMapsCompatible(
  before: Record<string, string>,
  after: Record<string, string>,
  sheetId: string,
  axis: "row" | "column",
) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const previous = before[key];
    const next = after[key];
    if (previous === next) continue;
    if (!/^\d+$/.test(key)) return false;
    const generated = `${sheetId}:${axis}:${Number(key) + 1}`;
    // Normalization materializes stable default row/column identities for
    // axes that gain their first populated cell. Those implicit additions are
    // part of a cell edit, while replacing an existing authored identity is
    // still a structural change.
    if (
      (previous === undefined && next === generated) ||
      (next === undefined && previous === generated)
    )
      continue;
    return false;
  }
  return true;
}

const normalizedSheetsByValue = new WeakMap<object, SheetsContent>();

/**
 * Artifact values are immutable (React state, Yjs projections, parsed JSON),
 * so one normalization per value object is enough. A cell commit used to
 * normalize both sides of every comparison: the studio's region lookup and the
 * live write each re-normalized the previous value they had just produced.
 */
function normalizedSheetsContent(value: unknown) {
  if (!value || typeof value !== "object") return normalizeSheetsContent(value);
  let normalized = normalizedSheetsByValue.get(value);
  if (!normalized) {
    normalized = normalizeSheetsContent(value);
    normalizedSheetsByValue.set(value, normalized);
  }
  return normalized;
}

function rawSheetCells(value: unknown) {
  const sheets = isRecord(value) && Array.isArray(value.sheets) ? value.sheets : null;
  return sheets?.map((sheet) =>
    isRecord(sheet) && isRecord(sheet.cells) ? sheet.cells : undefined,
  );
}

/**
 * The studio writes a cell as an overlay of the previous cells record.
 * Normalization rebuilds every record, which erased that hint, so each plan
 * compared all cells. Read it from the raw values instead: normalization is a
 * per-cell function of the raw cell and the workbook's date system (compared
 * separately), so cells the overlay leaves untouched normalize identically.
 */
function rawChangedSheetAddresses(
  before: Array<Record<string, unknown> | undefined> | undefined,
  after: Array<Record<string, unknown> | undefined> | undefined,
  index: number,
) {
  if (!before || !after || before.length !== after.length) return null;
  const previous = before[index];
  const next = after[index];
  if (!previous || !next) return null;
  const hinted = changedSheetCellAddresses(previous, next);
  return hinted ? [...new Set(hinted.map((address) => address.toUpperCase()))] : null;
}

/**
 * Returns a cell-only plan when workbook and sheet structure are unchanged.
 * Structural changes deliberately fall back to the adapter's complete
 * projection path; the hot formula-input path never decomposes every semantic
 * region in a dense workbook merely to discover that one address changed.
 */
export function planSheetsCellProjection(
  before: unknown,
  after: unknown,
): SheetsCellProjectionPlan | null {
  const previous = normalizedSheetsContent(before);
  const content = normalizedSheetsContent(after);
  const rawBefore = rawSheetCells(before);
  const rawAfter = rawSheetCells(after);
  if (
    previous.activeSheetId !== content.activeSheetId ||
    !plainEqual(previous.workbook, content.workbook) ||
    !plainEqual(previous.nativeBinding, content.nativeBinding) ||
    previous.sheets.length !== content.sheets.length
  )
    return null;
  const changes: SheetsCellProjectionChange[] = [];
  for (let index = 0; index < previous.sheets.length; index += 1) {
    const previousSheet = previous.sheets[index]!;
    const nextSheet = content.sheets[index]!;
    if (previousSheet.id !== nextSheet.id) return null;
    const {
      cells: previousCells,
      rowIdentities: previousRows,
      columnIdentities: previousColumns,
      ...previousStructure
    } = previousSheet;
    const {
      cells: nextCells,
      rowIdentities: nextRows,
      columnIdentities: nextColumns,
      ...nextStructure
    } = nextSheet;
    if (
      !plainEqual(previousStructure, nextStructure) ||
      !sheetIdentityMapsCompatible(
        previousRows ?? {},
        nextRows ?? {},
        nextSheet.id,
        "row",
      ) ||
      !sheetIdentityMapsCompatible(
        previousColumns ?? {},
        nextColumns ?? {},
        nextSheet.id,
        "column",
      )
    )
      return null;
    const hinted =
      rawChangedSheetAddresses(rawBefore, rawAfter, index) ??
      changedSheetCellAddresses(previousCells, nextCells);
    const addresses = hinted
      ? hinted
      : [
          ...new Set([
            ...Object.keys(previousCells),
            ...Object.keys(nextCells),
          ]),
        ];
    for (const address of addresses) {
      if (plainEqual(previousCells[address], nextCells[address])) continue;
      changes.push({
        sheetId: nextSheet.id,
        address,
        ...(nextCells[address] ? { cell: nextCells[address] } : {}),
        regionId: sheetCellRegionId(nextSheet, address),
      });
    }
  }
  return { content, changes };
}

export function applySheetsCellProjection(
  doc: Y.Doc,
  plan: SheetsCellProjectionPlan,
  origin: WorkTransactionOrigin,
) {
  doc.transact(() => {
    const sheets = structuredCollection(doc, ["sheets"]);
    if (!sheets) throw new Error("SHEETS_YJS_COLLECTION_MISSING");
    for (const change of plan.changes) {
      const sheet = sheets.items.get(change.sheetId);
      const cells = sheet?.get("cells");
      if (!(sheet instanceof Y.Map) || !(cells instanceof Y.Map))
        throw new Error("SHEETS_YJS_CELL_MAP_MISSING");
      if (!change.cell) {
        if (cells.has(change.address)) cells.delete(change.address);
        continue;
      }
      cells.set(SHEET_CELLS_MARKER, true);
      const encoded = encodeSheetCellValue(change.cell as JsonRecord);
      if (cells.get(change.address) !== encoded)
        cells.set(change.address, encoded);
    }
    setWorkModelMetadata(doc, "sheets", sheetsYjsAdapter.modelVersion);
  }, origin);
}

function projectCollection(collection: Y.Map<unknown>) {
  const order = collection.get("order");
  const items = collection.get("items");
  if (!(order instanceof Y.Array) || !(items instanceof Y.Map)) return [];
  // Two collaborators moving the same item each insert its id. Both views
  // converge on the first occurrence instead of rendering the item twice.
  const seen = new Set<string>();
  return order.toArray().flatMap((id) => {
    if (seen.has(String(id))) return [];
    seen.add(String(id));
    const item = items.get(String(id));
    if (!(item instanceof Y.Map)) return [];
    const projected = projectMap(item);
    return VALUE_MARKER in projected ? [projected[VALUE_MARKER]] : [projected];
  });
}

function projectValue(value: unknown): unknown {
  if (value instanceof Y.Text) return value.toString();
  if (value instanceof Y.Array) return value.toArray().map(projectValue);
  if (value instanceof Y.Map) return isCollection(value) ? projectCollection(value) : projectMap(value);
  return value;
}

function projectMap(map: Y.Map<unknown>): JsonRecord {
  if (map.get(SHEET_CELLS_MARKER) === true) {
    return Object.fromEntries(
      [...map.entries()]
        .filter(([key]) => key !== SHEET_CELLS_MARKER)
        .map(([key, value]) => [key, decodeSheetCellValue(value)]),
    );
  }
  return Object.fromEntries([...map.entries()].map(([key, value]) => [key, projectValue(value)]));
}

function rollbackUpdate<T>(snapshot: LegacyWorkSnapshot<T>) {
  const rollback = new Y.Doc();
  const map = rollback.getMap<unknown>(STRUCTURED_ROLLBACK_MAP);
  map.set("workType", snapshot.workType);
  map.set("modelVersion", snapshot.modelVersion ?? 1);
  map.set("schemaVersion", snapshot.schemaVersion ?? 1);
  map.set("content", JSON.stringify(snapshot.content));
  return Y.encodeStateAsUpdate(rollback);
}

export class StructuredWorkYjsAdapter<TModel> implements WorkYjsAdapter<TModel> {
  readonly modelVersion = WORK_YJS_SCHEMA_VERSION;

  constructor(
    readonly workType: ArtifactTypeKey,
    private readonly normalize: Normalizer<TModel>,
  ) {}

  createDocument(initial: TModel) {
    const doc = new Y.Doc();
    this.applyProjection(
      doc,
      this.normalize(initial),
      workYjsOrigins({ clientId: "bootstrap", kind: "system" }).migration,
    );
    return doc;
  }

  applyProjection(doc: Y.Doc, model: TModel, origin: WorkTransactionOrigin) {
    const normalized = this.normalize(model);
    if (!isRecord(normalized)) throw new Error("STRUCTURED_WORK_MODEL_NOT_OBJECT");
    doc.transact(() => {
      syncRecord(workRoot(doc), normalized, [this.workType]);
      setWorkModelMetadata(doc, this.workType, this.modelVersion);
    }, origin);
  }

  bind(doc: Y.Doc, _editor: unknown, _actor: WorkActorIdentity): WorkBinding {
    return createHeadlessBinding([workRoot(doc)]);
  }

  project(doc: Y.Doc): TModel {
    assertWorkModelMetadata(doc, this.workType, this.modelVersion);
    return this.normalize(projectMap(workRoot(doc)));
  }

  deriveSemanticRegions(
    doc: Y.Doc,
    projection?: TModel,
  ): readonly SemanticRegion[] {
    return enumerateArtifactRegions(
      this.workType,
      projection ?? this.project(doc),
    );
  }

  validate(doc: Y.Doc, projection?: TModel): WorkValidationResult {
    try {
      const result = validateArtifactContent(
        this.workType,
        projection ?? this.project(doc),
      );
      return result.success
        ? { valid: true }
        : { valid: false, issues: result.error.issues.map((issue) => issue.message) };
    } catch (error) {
      return {
        valid: false,
        issues: [error instanceof Error ? error.message : `${this.workType} model is invalid.`],
      };
    }
  }

  migrateLegacy(snapshot: LegacyWorkSnapshot<TModel>): WorkMigrationResult<TModel> {
    if (snapshot.workType !== this.workType) throw new Error("WORK_YJS_MIGRATION_TYPE_MISMATCH");
    const rollback = snapshot.rollbackUpdate ?? rollbackUpdate(snapshot);
    const document = this.createDocument(snapshot.content);
    const projected = this.project(document);
    const validation = this.validate(document, projected);
    if (!validation.valid)
      throw new Error(`${this.workType.toUpperCase()}_YJS_MIGRATION_INVALID: ${validation.issues.join("; ")}`);
    const migrationId = `${this.workType}:${snapshot.schemaVersion ?? 1}:v${this.modelVersion}`;
    const rollbackMap = document.getMap<unknown>(STRUCTURED_ROLLBACK_MAP);
    rollbackMap.set("migrationId", migrationId);
    rollbackMap.set("rollbackUpdate", rollback);
    return { document, projected, rollbackUpdate: rollback, migrated: true, migrationId };
  }

  createUndoManager(doc: Y.Doc, actor: WorkActorIdentity) {
    const origins = this.origins(actor);
    return new Y.UndoManager(workRoot(doc), {
      trackedOrigins: new Set([origins.localHuman, origins.referenceInsertion]),
    });
  }

  origins(actor: WorkActorIdentity): WorkYjsOriginSet {
    return workYjsOrigins(actor);
  }
}

const normalizeGeneric = (type: ArtifactTypeKey) => (value: unknown) =>
  normalizeArtifactContent(type, value) as JsonRecord;

export type LegacyFlashcardStudySeed = {
  cardId: string;
  confidence?: unknown;
  review?: unknown;
};

export function extractLegacyFlashcardStudyState(
  value: unknown,
): LegacyFlashcardStudySeed[] {
  const content = normalizeArtifactContent("flashcard_deck", value) as JsonRecord;
  // Source normalization intentionally strips personal review state from the
  // shared deck. Extract it from the incoming legacy payload first so the
  // per-account migration does not silently discard a learner's progress.
  const incomingCards =
    isRecord(value) && Array.isArray(value.cards) ? value.cards : content.cards;
  return (Array.isArray(incomingCards) ? incomingCards : []).flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string") return [];
    if (entry.review === undefined && entry.confidence === undefined) return [];
    return [
      {
        cardId: entry.id,
        ...(entry.confidence !== undefined ? { confidence: entry.confidence } : {}),
        ...(entry.review !== undefined ? { review: entry.review } : {}),
      },
    ];
  });
}

function normalizeFlashcardSource(value: unknown) {
  const content = normalizeArtifactContent("flashcard_deck", value) as JsonRecord;
  return {
    ...content,
    cards: (Array.isArray(content.cards) ? content.cards : []).map((entry) => {
      const { review: _review, confidence: _confidence, ...source } = isRecord(entry)
        ? entry
        : {};
      return source;
    }),
  };
}

function normalizeQuizSource(value: unknown) {
  const content = normalizeArtifactContent("quiz", value) as JsonRecord;
  const {
    attempts: _attempts,
    responses: _responses,
    results: _results,
    currentAttempt: _currentAttempt,
    ...source
  } = content;
  return source;
}

/**
 * The Agent Foundry document is the collaborative source of truth: mission,
 * adaptive sections with their history, evidence bindings and skills all live
 * under `foundry`. The legacy fields it also carries are the compiled
 * projection the runtime and publish gates read.
 */
function normalizeAgentCollaborativeContent(value: unknown) {
  return normalizeFoundryContent(value) as unknown as JsonRecord;
}

export const sheetsYjsAdapter = new StructuredWorkYjsAdapter(
  "sheets",
  normalizeSheetsContent,
);
export const presentationYjsAdapter = new StructuredWorkYjsAdapter(
  "presentation",
  normalizePresentationContent,
);
export const whiteboardYjsAdapter = new StructuredWorkYjsAdapter(
  "whiteboard",
  // normalizeWhiteboardContent owns zOrder so React sticky emits and Yjs
  // projections stay comparable (avoids false /content/zOrder conflicts).
  normalizeWhiteboardContent,
);
export const quizYjsAdapter = new StructuredWorkYjsAdapter(
  "quiz",
  normalizeQuizSource,
);
export const flashcardDeckYjsAdapter = new StructuredWorkYjsAdapter(
  "flashcard_deck",
  normalizeFlashcardSource,
);
export const plannerYjsAdapter = new StructuredWorkYjsAdapter(
  "planner_task",
  normalizeGeneric("planner_task"),
);
export const agentYjsAdapter = new StructuredWorkYjsAdapter(
  "agent",
  normalizeAgentCollaborativeContent,
);
export const timetableYjsAdapter = new StructuredWorkYjsAdapter(
  "timetable",
  sharedTimetableContent,
);

export function structuredCollection(
  doc: Y.Doc,
  path: readonly string[],
): { order: Y.Array<string>; items: Y.Map<Y.Map<unknown>> } | null {
  let current: unknown = workRoot(doc);
  for (const segment of path) {
    if (!(current instanceof Y.Map)) return null;
    current = current.get(segment);
  }
  if (!(current instanceof Y.Map) || !isCollection(current)) return null;
  const order = current.get("order");
  const items = current.get("items");
  return order instanceof Y.Array && items instanceof Y.Map
    ? { order, items: items as Y.Map<Y.Map<unknown>> }
    : null;
}

export function structuredText(
  doc: Y.Doc,
  path: readonly string[],
): Y.Text | null {
  let current: unknown = workRoot(doc);
  for (const segment of path) {
    if (!(current instanceof Y.Map)) return null;
    if (isCollection(current)) {
      const items = current.get("items");
      current = items instanceof Y.Map ? items.get(segment) : null;
    } else {
      current = current.get(segment);
    }
  }
  return current instanceof Y.Text ? current : null;
}
