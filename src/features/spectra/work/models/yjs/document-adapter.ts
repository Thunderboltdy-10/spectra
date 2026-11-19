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
import { syncFragmentToJson } from "./document-fragment-sync";
import { semanticallyEqual } from "../../../../../../shared/canonical-json";
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

export type DocumentParagraphTextSplice = {
  blockId: string;
  expectedText: string;
  /** UTF-16 offsets, as used by Yjs and the editor. */
  index: number;
  deleteCount: number;
  insertText: string;
};

function splitsSurrogate(text: string, index: number): boolean {
  const left = text.charCodeAt(index - 1);
  const right = text.charCodeAt(index);
  return left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff;
}

/** Apply one plain, top-level paragraph splice to the caller's Y.Doc.
 * This is a semantic delta builder, not a write permit or durable receipt:
 * the AI writer runs it on a scratch replay and admits the exact bytes under
 * the current room fence. Marks, references and inline atoms require their
 * own lossless edit contract; never flatten them through the block mirror. */
export function applyDocumentParagraphTextSplice(
  document: Y.Doc,
  splice: DocumentParagraphTextSplice,
  origin: WorkTransactionOrigin,
): { blockId: string; beforeText: string; afterText: string; changed: boolean } {
  assertWorkModelMetadata(document, "document", WORK_YJS_SCHEMA_VERSION);
  if (!splice.blockId || typeof splice.expectedText !== "string" || typeof splice.insertText !== "string" ||
    !Number.isSafeInteger(splice.index) || !Number.isSafeInteger(splice.deleteCount) ||
    splice.index < 0 || splice.deleteCount < 0 || splice.index + splice.deleteCount > splice.expectedText.length ||
    splitsSurrogate(splice.expectedText, splice.index) || splitsSurrogate(splice.expectedText, splice.index + splice.deleteCount))
    throw new Error("DOCUMENT_TEXT_SPLICE_INVALID");

  const fragment = document.getXmlFragment(DOCUMENT_YJS_FRAGMENT);
  const matches = fragment.toArray().filter((node): node is Y.XmlElement =>
    node instanceof Y.XmlElement && node.getAttribute("blockId") === splice.blockId,
  );
  if (matches.length !== 1) throw new Error("DOCUMENT_TEXT_SPLICE_TARGET");
  const paragraph = matches[0]!;
  const children = paragraph.toArray();
  if (paragraph.nodeName !== "paragraph" || children.length > 1 ||
    (children.length === 1 && !(children[0] instanceof Y.XmlText)))
    throw new Error("DOCUMENT_TEXT_SPLICE_UNSUPPORTED");
  const text = children[0] as Y.XmlText | undefined;
  const delta: Array<{ insert?: unknown; attributes?: Record<string, unknown> }> = text?.toDelta() ?? [];
  if (delta.some((part) => typeof part.insert !== "string" || Object.keys(part.attributes ?? {}).length > 0))
    throw new Error("DOCUMENT_TEXT_SPLICE_UNSUPPORTED");
  const beforeText = delta.map((part) => part.insert as string).join("");
  if (beforeText !== splice.expectedText) throw new Error("DOCUMENT_TEXT_SPLICE_STALE");
  const afterText = beforeText.slice(0, splice.index) + splice.insertText + beforeText.slice(splice.index + splice.deleteCount);
  if (afterText === beforeText) return { blockId: splice.blockId, beforeText, afterText, changed: false };

  document.transact(() => {
    const target = text ?? new Y.XmlText();
    if (!text) paragraph.push([target]);
    if (splice.deleteCount) target.delete(splice.index, splice.deleteCount);
    if (splice.insertText) target.insert(splice.index, splice.insertText);
  }, origin);
  return { blockId: splice.blockId, beforeText, afterText, changed: true };
}

function adoptProjectionFragment(
  fragment: Y.XmlFragment,
  currentDocument: ProseMirrorJson,
  nextDocument: ProseMirrorJson,
) {
  if (semanticallyEqual(currentDocument, nextDocument)) return;
  syncFragmentToJson(fragment, nextDocument);
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
      // Rewriting an unchanged map would ship it to every peer on each apply.
      if (!semanticallyEqual(yToPlain(root.get("extras")), extras))
        root.set("extras", plainToY(extras));
      const nextDocument = documentContentToProseMirrorJson(model);
      const currentDocument = yXmlFragmentToProsemirrorJSON(
        fragment,
      ) as ProseMirrorJson;
      // Metadata first: in-place paragraph splices assert the model version.
      setWorkModelMetadata(doc, this.workType, this.modelVersion);
      adoptProjectionFragment(fragment, currentDocument, nextDocument);
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
