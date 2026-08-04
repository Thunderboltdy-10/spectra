import * as Y from "yjs";
import { yXmlFragmentToProsemirrorJSON } from "y-prosemirror";
import { enumerateArtifactRegions, validateArtifactContent } from "../../../artifacts/registry";
import type { SemanticRegion } from "../../../artifacts/types";
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

type ProseMirrorJson = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: ProseMirrorJson[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textContent(node: ProseMirrorJson): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(textContent).join(node.type === "listItem" ? "" : "\n");
}

function inlineText(value: string): ProseMirrorJson[] | undefined {
  return value ? [{ type: "text", text: value }] : undefined;
}

function blockToJson(block: Record<string, unknown>, index: number): ProseMirrorJson {
  const id =
    typeof block.id === "string" && block.id.trim()
      ? block.id
      : `block-${index + 1}`;
  const value = typeof block.text === "string" ? block.text : "";
  const attrs = record(block.attrs);
  if (block.type === "heading")
    return {
      type: "heading",
      attrs: {
        blockId: id,
        level: [1, 2, 3].includes(Number(attrs.level)) ? Number(attrs.level) : 2,
      },
      content: inlineText(value),
    };
  if (block.type === "quote")
    return {
      type: "blockquote",
      attrs: { blockId: id },
      content: [{ type: "paragraph", content: inlineText(value) }],
    };
  if (block.type === "list")
    return {
      type: "bulletList",
      attrs: { blockId: id },
      content: (value.split(/\r?\n/).filter(Boolean).length
        ? value.split(/\r?\n/).filter(Boolean)
        : [""]
      ).map((entry) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: inlineText(entry) }],
      })),
    };
  if (block.type === "callout")
    return {
      type: "callout",
      attrs: { blockId: id, type: attrs.tone ?? "info" },
      content: [{ type: "paragraph", content: inlineText(value) }],
    };
  if (block.type === "math" || block.type === "equation")
    return {
      type: "equation",
      attrs: {
        blockId: id,
        latex: typeof block.latex === "string" ? block.latex : value,
        display: attrs.display ?? "block",
        alignment: attrs.alignment ?? "center",
      },
    };
  if (block.type === "code")
    return {
      type: "codeBlock",
      attrs: { blockId: id, language: attrs.language ?? null },
      content: inlineText(value),
    };
  return {
    type: "paragraph",
    attrs: { blockId: id },
    content: inlineText(value),
  };
}

export function documentContentToProseMirrorJson(
  content: DocumentWorkContent,
): ProseMirrorJson {
  const existing = record(content.tiptap);
  if (existing.type === "doc") return existing as ProseMirrorJson;
  const blocks = Array.isArray(content.blocks)
    ? content.blocks.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  return {
    type: "doc",
    content: (blocks.length ? blocks : [{ id: "intro", type: "paragraph", text: "" }]).map(
      blockToJson,
    ),
  };
}

function appendJsonNode(parent: Y.XmlFragment | Y.XmlElement, node: ProseMirrorJson) {
  if (node.type === "text") {
    const text = new Y.XmlText();
    parent.push([text]);
    text.insert(0, node.text ?? "", {
      ...Object.fromEntries((node.marks ?? []).map((mark) => [mark.type, mark.attrs ?? {}])),
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

function blocksFromJson(json: ProseMirrorJson) {
  const seen = new Set<string>();
  return (json.content ?? []).map((node, index) => {
    let id =
      typeof node.attrs?.blockId === "string" && node.attrs.blockId
        ? node.attrs.blockId
        : `block-${index + 1}`;
    if (seen.has(id)) {
      let suffix = 2;
      while (seen.has(`${id}~${suffix}`)) suffix += 1;
      id = `${id}~${suffix}`;
    }
    seen.add(id);
    const text = textContent(node).trimEnd();
    if (node.type === "heading")
      return { id, type: "heading", text, attrs: { level: Number(node.attrs?.level) || 2 } };
    if (node.type === "blockquote") return { id, type: "quote", text };
    if (node.type === "bulletList" || node.type === "orderedList")
      return { id, type: "list", text };
    if (node.type === "callout")
      return { id, type: "callout", text, attrs: { tone: node.attrs?.type ?? "info" } };
    if (node.type === "equation")
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
    if (node.type === "codeBlock")
      return { id, type: "code", text, attrs: { language: node.attrs?.language ?? undefined } };
    if (node.type === "spectraReference")
      return {
        id,
        type: "paragraph",
        text: String(node.attrs?.label ?? "Referenced work"),
        reference: node.attrs,
      };
    if (node.type === "spectraCitation")
      return {
        id,
        type: "paragraph",
        text: String(node.attrs?.label ?? "Citation"),
        citation: node.attrs,
      };
    return { id, type: "paragraph", text };
  });
}

function documentProjection(doc: Y.Doc): DocumentWorkContent {
  assertWorkModelMetadata(doc, "document", WORK_YJS_SCHEMA_VERSION);
  const root = workRoot(doc);
  const extras = yToPlain(root.get("extras"));
  const fragment = doc.getXmlFragment(DOCUMENT_YJS_FRAGMENT);
  const tiptap = yXmlFragmentToProsemirrorJSON(fragment) as ProseMirrorJson;
  const blocks = blocksFromJson(tiptap);
  return {
    ...record(extras),
    tiptap,
    blocks: blocks.length ? blocks : [{ id: "intro", type: "paragraph", text: "" }],
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
      const { blocks: _blocks, tiptap: _tiptap, outline: _outline, ...extras } = model;
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

  deriveSemanticRegions(doc: Y.Doc): readonly SemanticRegion[] {
    return enumerateArtifactRegions("document", this.project(doc));
  }

  validate(doc: Y.Doc): WorkValidationResult {
    try {
      const result = validateArtifactContent("document", this.project(doc));
      return result.success
        ? { valid: true }
        : { valid: false, issues: result.error.issues.map((issue) => issue.message) };
    } catch (error) {
      return {
        valid: false,
        issues: [error instanceof Error ? error.message : "Document model is invalid."],
      };
    }
  }

  migrateLegacy(
    snapshot: LegacyWorkSnapshot<DocumentWorkContent>,
  ): WorkMigrationResult<DocumentWorkContent> {
    const rollback = snapshot.rollbackUpdate ?? rollbackUpdate(snapshot);
    const document = this.createDocument(snapshot.content);
    const projected = this.project(document);
    const validation = this.validate(document);
    if (!validation.valid) throw new Error(`DOCUMENT_YJS_MIGRATION_INVALID: ${validation.issues.join("; ")}`);
    const meta = document.getMap<unknown>(DOCUMENT_ROLLBACK_MAP);
    meta.set("migrationId", `document:${snapshot.schemaVersion ?? 1}:v${this.modelVersion}`);
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
