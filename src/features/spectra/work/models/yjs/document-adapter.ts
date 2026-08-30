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

function appendJsonNode(
  parent: Y.XmlFragment | Y.XmlElement,
  node: ProseMirrorJson,
) {
  if (node.type === "text") {
    const text = new Y.XmlText();
    parent.push([text]);
    text.insert(0, node.text ?? "", {
      ...Object.fromEntries(
        (node.marks ?? []).map((mark) => [mark.type, mark.attrs ?? {}]),
      ),
    });
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

function populateFragment(fragment: Y.XmlFragment, json: ProseMirrorJson) {
  if (fragment.length) fragment.delete(0, fragment.length);
  appendJsonNode(fragment, json);
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
      // Envelope-only changes (title, tags, sources) must not rewrite a live
      // focused editor. Full fragment replacement is reserved for explicit
      // import/migration/whole-document semantic operations.
      if (JSON.stringify(currentDocument) !== JSON.stringify(nextDocument))
        populateFragment(fragment, nextDocument);
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
