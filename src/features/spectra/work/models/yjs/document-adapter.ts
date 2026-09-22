import * as Y from "yjs";
import { yXmlFragmentToProsemirrorJSON } from "y-prosemirror";
import {
  enumerateArtifactRegions,
  validateArtifactContent,
} from "../../../artifacts/registry";
import type { SemanticRegion } from "../../../artifacts/types";
import {
  documentBlocksFromJson,
  documentContentToProseMirrorJson as projectDocumentContentToProseMirrorJson,
  type DocumentJsonNode,
} from "../../../lenses/document-projection";
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
  plainToY,
  setWorkModelMetadata,
  workRoot,
  yToPlain,
} from "./shared";

export const DOCUMENT_YJS_FRAGMENT = "spectra:document-v2";
const DOCUMENT_ROLLBACK_MAP = "spectra:document-v2:rollback";

export type DocumentWorkContent = Record<string, unknown> & {
  blocks?: Array<Record<string, unknown>>;
  tiptap?: Record<string, unknown>;
};

type ProseMirrorJson = DocumentJsonNode;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function documentContentToProseMirrorJson(
  content: DocumentWorkContent,
): ProseMirrorJson {
  return projectDocumentContentToProseMirrorJson(content);
}

function textMarks(node: ProseMirrorJson) {
  return Object.fromEntries(
    (node.marks ?? []).map((mark) => [mark.type, mark.attrs ?? {}]),
  );
}

function nodeBlockId(node: ProseMirrorJson | undefined) {
  const blockId = node?.attrs?.blockId;
  return typeof blockId === "string" && blockId ? blockId : null;
}

function isDefaultPlaceholderDocument(document: ProseMirrorJson) {
  const blocks = documentBlocksFromJson(document);
  if (blocks.length !== 1 || blocks[0]?.id !== "intro") return false;
  const text = typeof blocks[0]?.text === "string" ? blocks[0].text.trim() : "";
  return text === "" || text === "Start writing here.";
}

function appendJsonNode(
  parent: Y.XmlFragment | Y.XmlElement,
  node: ProseMirrorJson,
) {
  if (node.type === "text") {
    const text = new Y.XmlText();
    parent.push([text]);
    text.insert(0, node.text ?? "", textMarks(node));
    return;
  }
  if (!node.type || node.type === "doc") {
    for (const child of node.content ?? []) appendJsonNode(parent, child);
    return;
  }
  const element = new Y.XmlElement(node.type);
  parent.push([element]);
  for (const [key, value] of Object.entries(node.attrs ?? {}))
    if (value !== undefined) element.setAttribute(key, value as string);
  for (const child of node.content ?? []) appendJsonNode(element, child);
}

function insertJsonNode(
  fragment: Y.XmlFragment,
  index: number,
  node: ProseMirrorJson,
) {
  if (!node.type || node.type === "doc") {
    let cursor = index;
    for (const child of node.content ?? []) {
      insertJsonNode(fragment, cursor, child);
      cursor += 1;
    }
    return;
  }
  if (node.type === "text") {
    const text = new Y.XmlText();
    fragment.insert(index, [text]);
    text.insert(0, node.text ?? "", textMarks(node));
    return;
  }
  const element = new Y.XmlElement(node.type);
  fragment.insert(index, [element]);
  for (const [key, value] of Object.entries(node.attrs ?? {}))
    if (value !== undefined) element.setAttribute(key, value as string);
  for (const child of node.content ?? []) appendJsonNode(element, child);
}

function populateFragment(fragment: Y.XmlFragment, json: ProseMirrorJson) {
  if (fragment.length) fragment.delete(0, fragment.length);
  appendJsonNode(fragment, json);
}

function adoptProjectionFragment(
  fragment: Y.XmlFragment,
  currentDocument: ProseMirrorJson,
  nextDocument: ProseMirrorJson,
) {
  if (JSON.stringify(currentDocument) === JSON.stringify(nextDocument)) return;
  const currentNodes = currentDocument.content ?? [];
  const nextNodes = nextDocument.content ?? [];
  const currentIds = currentNodes.map(nodeBlockId);
  const nextIds = nextNodes.map(nodeBlockId);
  // A single semantic command can edit existing paragraphs and insert a
  // bibliography. Preserve unchanged Yjs nodes while applying both effects;
  // insert-only shortcuts must never silently drop the paragraph edits.
  if (currentNodes.length === fragment.length && currentIds.every(Boolean) && nextIds.every(Boolean) && new Set(currentIds).size === currentIds.length && new Set(nextIds).size === nextIds.length) {
    const desiredIds = new Set(nextIds);
    for (let index = currentIds.length - 1; index >= 0; index--) {
      if (!desiredIds.has(currentIds[index]!)) { fragment.delete(index, 1); currentIds.splice(index, 1); currentNodes.splice(index, 1); }
    }
    for (let index = 0; index < nextNodes.length; index++) {
      if (currentIds[index] === nextIds[index]) {
        if (JSON.stringify(currentNodes[index]) !== JSON.stringify(nextNodes[index])) {
          fragment.delete(index, 1); insertJsonNode(fragment, index, nextNodes[index]!);
          currentNodes[index] = nextNodes[index]!;
        }
        continue;
      }
      const previous = currentIds.indexOf(nextIds[index]!);
      if (previous >= 0) { fragment.delete(previous, 1); currentIds.splice(previous, 1); currentNodes.splice(previous, 1); }
      insertJsonNode(fragment, index, nextNodes[index]!);
      currentIds.splice(index, 0, nextIds[index]!); currentNodes.splice(index, 0, nextNodes[index]!);
    }
    return;
  }
  // A newly-created document is seeded with one editable placeholder so the
  // editor is never visually empty. Once AI has authored real blocks, that
  // shell must be replaced rather than treated as a user-authored paragraph.
  if (isDefaultPlaceholderDocument(currentDocument)) {
    populateFragment(fragment, nextDocument);
    return;
  }
  const currentIdSet = new Set(
    currentIds.filter((id): id is string => Boolean(id)),
  );
  const extraCount = nextNodes.length - currentNodes.length;
  const currentText = JSON.stringify(currentDocument);
  if (extraCount > 0 && currentNodes.length === fragment.length) {
    const extras = nextNodes.slice(-extraCount);
    const extrasAreNew = extras.every((node) => {
      const id = nodeBlockId(node);
      if (id && !currentIdSet.has(id)) return true;
      const nested = JSON.stringify(node.content ?? node.text ?? "");
      return nested.length > 2 && !currentText.includes(nested);
    });
    if (extrasAreNew) {
      for (const node of extras) appendJsonNode(fragment, node);
      return;
    }
  }
  const trailingInsert =
    extraCount > 0 &&
    currentNodes.length === fragment.length &&
    currentIds.every((id, index) => id === nextIds[index]);
  if (trailingInsert) {
    for (const node of nextNodes.slice(currentNodes.length))
      appendJsonNode(fragment, node);
    return;
  }
  const missingIndexes = nextIds.flatMap((id, index) =>
    id && !currentIdSet.has(id) ? [index] : [],
  );
  const presentCurrentIds = currentIds.filter((id): id is string => Boolean(id));
  const insertOnly =
    missingIndexes.length > 0 &&
    missingIndexes.length === extraCount &&
    presentCurrentIds.every((id) => nextIds.includes(id));
  if (insertOnly) {
    for (const index of missingIndexes)
      insertJsonNode(
        fragment,
        Math.min(index, fragment.length),
        nextNodes[index]!,
      );
    return;
  }
  populateFragment(fragment, nextDocument);
}

function documentProjection(doc: Y.Doc): DocumentWorkContent {
  assertWorkModelMetadata(doc, "document", WORK_YJS_SCHEMA_VERSION);
  const root = workRoot(doc);
  const extras = yToPlain(root.get("extras"));
  const fragment = doc.getXmlFragment(DOCUMENT_YJS_FRAGMENT);
  const tiptap = yXmlFragmentToProsemirrorJSON(fragment) as ProseMirrorJson;
  const blocks = documentBlocksFromJson(tiptap);
  return {
    ...record(extras),
    tiptap,
    blocks: blocks.length
      ? blocks
      : [{ id: "intro", type: "paragraph", text: "" }],
    ...(record(extras).nativeBinding
      ? { nativeProjectionComplete: true as const }
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

function rollbackUpdate(snapshot: LegacyWorkSnapshot<DocumentWorkContent>) {
  const rollback = new Y.Doc();
  const map = rollback.getMap<unknown>(DOCUMENT_ROLLBACK_MAP);
  map.set("workType", "document");
  map.set("modelVersion", snapshot.modelVersion ?? 1);
  map.set("schemaVersion", snapshot.schemaVersion ?? 1);
  map.set("content", JSON.stringify(snapshot.content));
  return Y.encodeStateAsUpdate(rollback);
}

export class DocumentYjsAdapter implements WorkYjsAdapter<DocumentWorkContent> {
  readonly workType = "document" as const;
  readonly modelVersion = WORK_YJS_SCHEMA_VERSION;

  createDocument(initial: DocumentWorkContent) {
    const doc = new Y.Doc();
    this.applyProjection(
      doc,
      initial,
      workYjsOrigins({ clientId: "bootstrap", kind: "system" }).migration,
    );
    return doc;
  }

  applyProjection(
    doc: Y.Doc,
    model: DocumentWorkContent,
    origin: WorkTransactionOrigin,
  ) {
    doc.transact(() => {
      const fragment = doc.getXmlFragment(DOCUMENT_YJS_FRAGMENT);
      const root = workRoot(doc);
      const {
        blocks: _blocks,
        tiptap: _tiptap,
        outline: _outline,
        nativeIntent: _nativeIntent,
        ...extras
      } = model;
      root.set("extras", plainToY(extras));
      const nextDocument = documentContentToProseMirrorJson(model);
      const currentDocument = yXmlFragmentToProsemirrorJSON(
        fragment,
      ) as ProseMirrorJson;
      if (JSON.stringify(currentDocument) !== JSON.stringify(nextDocument))
        adoptProjectionFragment(fragment, currentDocument, nextDocument);
      if (typeof globalThis !== "undefined") {
        const target = globalThis as typeof globalThis & {
          __spectraNativeProjection?: Array<Record<string, unknown>>;
        };
        const nextText = JSON.stringify(nextDocument);
        if (nextText.includes("RCV1WORDNATIVE")) {
          const log = (target.__spectraNativeProjection ??= []);
          log.push({
            event: "applyProjection",
            currentNodes: currentDocument.content?.length ?? 0,
            nextNodes: nextDocument.content?.length ?? 0,
            fragmentLength: fragment.length,
            native7InNext: nextText.includes("RCV1WORDNATIVE7"),
            native7InCurrent: JSON.stringify(currentDocument).includes(
              "RCV1WORDNATIVE7",
            ),
            at: Date.now(),
          });
          if (log.length > 40) log.splice(0, log.length - 40);
        }
      }
      setWorkModelMetadata(doc, this.workType, this.modelVersion);
    }, origin);
  }

  bind(doc: Y.Doc, _editor: unknown, _actor: WorkActorIdentity): WorkBinding {
    return createHeadlessBinding([doc.getXmlFragment(DOCUMENT_YJS_FRAGMENT)]);
  }

  project(doc: Y.Doc) {
    return documentProjection(doc);
  }

  deriveSemanticRegions(
    doc: Y.Doc,
    projection?: DocumentWorkContent,
  ): readonly SemanticRegion[] {
    return enumerateArtifactRegions(
      "document",
      projection ?? this.project(doc),
    );
  }

  validate(
    doc: Y.Doc,
    projection?: DocumentWorkContent,
  ): WorkValidationResult {
    try {
      const result = validateArtifactContent(
        "document",
        projection ?? this.project(doc),
      );
      return result.success
        ? { valid: true }
        : {
            valid: false,
            issues: result.error.issues.map((issue) => issue.message),
          };
    } catch (error) {
      return {
        valid: false,
        issues: [
          error instanceof Error ? error.message : "Document model is invalid.",
        ],
      };
    }
  }

  migrateLegacy(
    snapshot: LegacyWorkSnapshot<DocumentWorkContent>,
  ): WorkMigrationResult<DocumentWorkContent> {
    const rollback = snapshot.rollbackUpdate ?? rollbackUpdate(snapshot);
    const document = this.createDocument(snapshot.content);
    const projected = this.project(document);
    const validation = this.validate(document, projected);
    if (!validation.valid)
      throw new Error(
        `DOCUMENT_YJS_MIGRATION_INVALID: ${validation.issues.join("; ")}`,
      );
    const meta = document.getMap<unknown>(DOCUMENT_ROLLBACK_MAP);
    meta.set(
      "migrationId",
      `document:${snapshot.schemaVersion ?? 1}:v${this.modelVersion}`,
    );
    meta.set("rollbackUpdate", rollback);
    return {
      document,
      projected,
      rollbackUpdate: rollback,
      migrated: true,
      migrationId: `document:${snapshot.schemaVersion ?? 1}:v${this.modelVersion}`,
    };
  }

  createUndoManager(doc: Y.Doc, actor: WorkActorIdentity) {
    const origins = this.origins(actor);
    return new Y.UndoManager(doc.getXmlFragment(DOCUMENT_YJS_FRAGMENT), {
      trackedOrigins: new Set([origins.localHuman, origins.referenceInsertion]),
    });
  }

  origins(actor: WorkActorIdentity): WorkYjsOriginSet {
    return workYjsOrigins(actor);
  }
}

export const documentYjsAdapter = new DocumentYjsAdapter();
