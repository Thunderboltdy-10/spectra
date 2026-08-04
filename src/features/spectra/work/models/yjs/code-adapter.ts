import * as Y from "yjs";
import { enumerateArtifactRegions, validateArtifactContent } from "../../../artifacts/registry";
import { normalizeCodeContent, type CodeContent, type CodeFile } from "../../../code/model";
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
  replaceYArray,
  replaceYText,
  setWorkModelMetadata,
  workRoot,
  yToPlain,
} from "./shared";

export const CODE_YJS_FILES_MAP = "spectra:code-v2:files";
export const CODE_YJS_FILE_ORDER = "spectra:code-v2:file-order";
const CODE_ROLLBACK_MAP = "spectra:code-v2:rollback";

function codeFiles(doc: Y.Doc) {
  return doc.getMap<Y.Map<unknown>>(CODE_YJS_FILES_MAP);
}

function codeFileOrder(doc: Y.Doc) {
  return doc.getArray<string>(CODE_YJS_FILE_ORDER);
}

export function codeFileMap(doc: Y.Doc, fileId: string) {
  return codeFiles(doc).get(fileId) ?? null;
}

export function codeFileText(doc: Y.Doc, fileId: string) {
  const source = codeFileMap(doc, fileId)?.get("source");
  return source instanceof Y.Text ? source : null;
}

function writeFile(map: Y.Map<unknown>, file: CodeFile) {
  const existing = map.get("source");
  const source = existing instanceof Y.Text ? existing : new Y.Text();
  if (!(existing instanceof Y.Text)) map.set("source", source);
  replaceYText(source, file.source);
  map.set("id", file.id);
  map.set("path", file.path);
  map.set("language", file.language);
  map.set("mediaType", file.mediaType ?? "text/plain");
  map.set("generated", file.generated === true);
  map.set("lineIds", [...(file.lineIds ?? [])]);
}

function projectFile(map: Y.Map<unknown>): CodeFile {
  const source = map.get("source");
  return {
    id: String(map.get("id") ?? ""),
    path: String(map.get("path") ?? "untitled.txt"),
    language: String(map.get("language") ?? "text"),
    source: source instanceof Y.Text ? source.toString() : "",
    ...(Array.isArray(map.get("lineIds"))
      ? { lineIds: (map.get("lineIds") as unknown[]).filter((entry): entry is string => typeof entry === "string") }
      : {}),
    ...(typeof map.get("mediaType") === "string"
      ? { mediaType: String(map.get("mediaType")) }
      : {}),
    ...(map.get("generated") === true ? { generated: true } : {}),
  };
}

function rollbackUpdate(snapshot: LegacyWorkSnapshot<CodeContent>) {
  const rollback = new Y.Doc();
  const map = rollback.getMap<unknown>(CODE_ROLLBACK_MAP);
  map.set("workType", "code");
  map.set("modelVersion", snapshot.modelVersion ?? 1);
  map.set("schemaVersion", snapshot.schemaVersion ?? 1);
  map.set("content", JSON.stringify(snapshot.content));
  return Y.encodeStateAsUpdate(rollback);
}

export class CodeYjsAdapter implements WorkYjsAdapter<CodeContent> {
  readonly workType = "code" as const;
  readonly modelVersion = WORK_YJS_SCHEMA_VERSION;

  createDocument(initial: CodeContent) {
    const doc = new Y.Doc();
    this.applyProjection(
      doc,
      normalizeCodeContent(initial),
      workYjsOrigins({ clientId: "bootstrap", kind: "system" }).migration,
    );
    return doc;
  }

  applyProjection(doc: Y.Doc, model: CodeContent, origin: WorkTransactionOrigin) {
    const content = normalizeCodeContent(model);
    doc.transact(() => {
      const files = codeFiles(doc);
      const order = codeFileOrder(doc);
      const nextIds = new Set(content.files.map((file) => file.id));
      for (const fileId of [...files.keys()]) if (!nextIds.has(fileId)) files.delete(fileId);
      for (const file of content.files) {
        let map = files.get(file.id);
        if (!map) {
          map = new Y.Map<unknown>();
          files.set(file.id, map);
        }
        writeFile(map, file);
      }
      replaceYArray(order, content.files.map((file) => file.id));
      const root = workRoot(doc);
      const { files: _files, ...project } = content;
      root.set("project", plainToY(project));
      setWorkModelMetadata(doc, this.workType, this.modelVersion);
    }, origin);
  }

  bind(doc: Y.Doc, editor: unknown, _actor: WorkActorIdentity): WorkBinding {
    const fileId =
      editor && typeof editor === "object" && typeof (editor as { fileId?: unknown }).fileId === "string"
        ? (editor as { fileId: string }).fileId
        : String(workRoot(doc).get("entryFileId") ?? codeFileOrder(doc).get(0) ?? "");
    const text = codeFileText(doc, fileId);
    return createHeadlessBinding(text ? [text] : []);
  }

  project(doc: Y.Doc): CodeContent {
    assertWorkModelMetadata(doc, this.workType, this.modelVersion);
    const root = workRoot(doc);
    const project = yToPlain(root.get("project"));
    const files = codeFiles(doc);
    const ordered = codeFileOrder(doc)
      .toArray()
      .flatMap((fileId) => {
        const map = files.get(fileId);
        return map ? [projectFile(map)] : [];
      });
    return normalizeCodeContent({ ...(project as Record<string, unknown>), files: ordered });
  }

  deriveSemanticRegions(doc: Y.Doc): readonly SemanticRegion[] {
    return enumerateArtifactRegions("code", this.project(doc));
  }

  validate(doc: Y.Doc): WorkValidationResult {
    try {
      const result = validateArtifactContent("code", this.project(doc));
      return result.success
        ? { valid: true }
        : { valid: false, issues: result.error.issues.map((issue) => issue.message) };
    } catch (error) {
      return {
        valid: false,
        issues: [error instanceof Error ? error.message : "Code model is invalid."],
      };
    }
  }

  migrateLegacy(snapshot: LegacyWorkSnapshot<CodeContent>): WorkMigrationResult<CodeContent> {
    const rollback = snapshot.rollbackUpdate ?? rollbackUpdate(snapshot);
    const document = this.createDocument(snapshot.content);
    const projected = this.project(document);
    const validation = this.validate(document);
    if (!validation.valid) throw new Error(`CODE_YJS_MIGRATION_INVALID: ${validation.issues.join("; ")}`);
    const migrationId = `code:${snapshot.schemaVersion ?? 1}:v${this.modelVersion}`;
    const rollbackMap = document.getMap<unknown>(CODE_ROLLBACK_MAP);
    rollbackMap.set("migrationId", migrationId);
    rollbackMap.set("rollbackUpdate", rollback);
    return { document, projected, rollbackUpdate: rollback, migrated: true, migrationId };
  }

  createUndoManager(doc: Y.Doc, actor: WorkActorIdentity) {
    const origins = this.origins(actor);
    const texts = [...codeFiles(doc).values()].flatMap((map) => {
      const source = map.get("source");
      return source instanceof Y.Text ? [source] : [];
    });
    return new Y.UndoManager(texts, { trackedOrigins: new Set([origins.localHuman]) });
  }

  origins(actor: WorkActorIdentity): WorkYjsOriginSet {
    return workYjsOrigins(actor);
  }
}

export const codeYjsAdapter = new CodeYjsAdapter();
