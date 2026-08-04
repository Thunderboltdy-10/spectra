import * as Y from "yjs";
import type { ArtifactTypeKey, SemanticRegion } from "../../../artifacts/types";

export const WORK_YJS_SCHEMA_VERSION = 2;

export type WorkActorIdentity = {
  clientId: string;
  kind: "human" | "ai" | "system";
  accountId?: string;
  name?: string;
  runId?: string;
  operationId?: string;
};

export type WorkTransactionKind =
  | "local_human"
  | "remote_human"
  | "ai_semantic_edit"
  | "import"
  | "normalization"
  | "reference_insertion"
  | "source_update"
  | "migration"
  | "undo"
  | "redo";

/**
 * Object identity, rather than a string label, is what Y.UndoManager tracks.
 * One origin is therefore retained per actor/kind pair for the lifetime of a
 * work session. Remote, AI, import, and normalization origins never enter a
 * human actor's local undo manager.
 */
export class WorkTransactionOrigin {
  constructor(
    readonly kind: WorkTransactionKind,
    readonly actor: WorkActorIdentity,
    readonly operationId?: string,
  ) {}
}

export type WorkYjsOriginSet = {
  localHuman: WorkTransactionOrigin;
  remoteHuman: WorkTransactionOrigin;
  ai: WorkTransactionOrigin;
  import: WorkTransactionOrigin;
  normalization: WorkTransactionOrigin;
  referenceInsertion: WorkTransactionOrigin;
  sourceUpdate: WorkTransactionOrigin;
  migration: WorkTransactionOrigin;
  undo: WorkTransactionOrigin;
  redo: WorkTransactionOrigin;
};

export type WorkBinding = {
  kind: "tiptap" | "codemirror" | "structured" | "headless";
  sharedTypes: readonly unknown[];
  destroy(): void;
};

export type WorkValidationResult =
  | { valid: true }
  | { valid: false; issues: readonly string[] };

export type LegacyWorkSnapshot<TModel> = {
  workType: ArtifactTypeKey;
  modelVersion?: number;
  schemaVersion?: number;
  content: TModel;
  rollbackUpdate?: Uint8Array;
};

export type WorkMigrationResult<TModel> = {
  document: Y.Doc;
  projected: TModel;
  rollbackUpdate: Uint8Array;
  migrated: boolean;
  migrationId: string;
};

export type WorkYjsAdapter<TModel = unknown> = {
  readonly workType: ArtifactTypeKey;
  readonly modelVersion: number;
  createDocument(initial: TModel): Y.Doc;
  applyProjection(doc: Y.Doc, model: TModel, origin: WorkTransactionOrigin): void;
  bind(doc: Y.Doc, editor: unknown, actor: WorkActorIdentity): WorkBinding;
  project(doc: Y.Doc): TModel;
  deriveSemanticRegions(doc: Y.Doc): readonly SemanticRegion[];
  validate(doc: Y.Doc): WorkValidationResult;
  migrateLegacy(snapshot: LegacyWorkSnapshot<TModel>): WorkMigrationResult<TModel>;
  createUndoManager(doc: Y.Doc, actor: WorkActorIdentity): Y.UndoManager;
  origins(actor: WorkActorIdentity): WorkYjsOriginSet;
};

export type NativeWorkModelSnapshot<TModel = unknown> = {
  initialized: boolean;
  validity: "valid" | "invalid" | "uninitialized";
  value: TModel | null;
  regionIds: readonly string[];
  error?: string;
};
