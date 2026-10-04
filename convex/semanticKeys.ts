/**
 * Partition keys of the semantic index (pure; no database access, no registered functions).
 *
 * Every chunk carries the keys of the audiences that may find it: its owner, the workspaces it is
 * projected to, the item itself (for direct grants) and a school audience. A viewer's keys are
 * computed at read time from live grants (./semanticSources), so sharing or revoking never needs
 * a re-index. Keys only narrow candidates; every result is re-checked against the source item.
 */
import { v, type Validator } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { INDEXED_SEMANTIC_KINDS, type IndexedSemanticKind } from "../shared/semantic-types";

/** Validator of an indexed kind, derived from the one list of kinds. */
export const vSemanticKind = v.union(...INDEXED_SEMANTIC_KINDS.map((kind) => v.literal(kind))) as unknown as
  Validator<IndexedSemanticKind, "required", never>;

/** Vector filter terms per search call; more partitions run as parallel searches. */
export const VECTOR_FILTER_TERMS = 48;
export const MAX_VECTOR_PARTITIONS = VECTOR_FILTER_TERMS * 4;

export const itemKeyOf = (kind: IndexedSemanticKind, itemId: string) => `${kind}:${itemId}`;
export function parseItemKey(key: string): { kind: IndexedSemanticKind; itemId: string } | null {
  const at = key.indexOf(":");
  const kind = key.slice(0, at) as IndexedSemanticKind;
  return at > 0 && INDEXED_SEMANTIC_KINDS.includes(kind) ? { kind, itemId: key.slice(at + 1) } : null;
}

/** Plain partition facts of an item; versioned vector keys are derived from them. */
export type ItemScope = {
  ownerAccountId?: Id<"accounts">;
  schoolId?: Id<"schools">;
  /** Up to two workspace audiences the item is projected to. */
  workspaceKeys: string[];
  audienceKey?: string;
  /** Artifacts: direct grants on the item reach it through its item key. */
  grantable?: boolean;
};

export const ownerKeyOf = (kind: IndexedSemanticKind, accountId: string) => `${kind}|a:${accountId}`;
/** Shared workspace audience (artifacts projected to the workspace). */
export const workspaceKeyOf = (kind: IndexedSemanticKind, workspaceId: string) => `${kind}|w:${workspaceId}`;
/** Private items filed in a workspace (threads, events): only their owner, inside that workspace. */
export const ownerWorkspaceKeyOf = (kind: IndexedSemanticKind, workspaceId: string, accountId: string) =>
  `${kind}|w:${workspaceId}|a:${accountId}`;
export const grantKeyOf = (kind: IndexedSemanticKind, itemId: string) => `${kind}|i:${itemId}`;
export const audienceKeys = {
  school: (schoolId: string) => `school|s:${schoolId}`,
  staff: (schoolId: string) => `school|staff:${schoolId}`,
  klass: (integrationId: string, classId: string, period?: string) => `school|c:${integrationId}|${classId}|${period ?? ""}`,
};

export type VectorKeys = {
  vOwnerKey?: string; vWorkspaceKey?: string; vWorkspaceKey2?: string; vItemKey?: string; vAudienceKey?: string;
};

/**
 * Versioned vector keys. An owner-only passage carries only the owner key. Without a version
 * (no vector) every key is cleared, so the row is invisible to vector search.
 */
export function vectorKeysFor(version: string | undefined, kind: IndexedSemanticKind, itemId: string, scope: ItemScope,
  ownerOnly = false): VectorKeys {
  if (!version) return { vOwnerKey: undefined, vWorkspaceKey: undefined, vWorkspaceKey2: undefined, vItemKey: undefined, vAudienceKey: undefined };
  const shared = !ownerOnly;
  return {
    vOwnerKey: scope.ownerAccountId ? `${version}|${ownerKeyOf(kind, scope.ownerAccountId)}` : undefined,
    vWorkspaceKey: shared && scope.workspaceKeys[0] ? `${version}|${scope.workspaceKeys[0]}` : undefined,
    vWorkspaceKey2: shared && scope.workspaceKeys[1] ? `${version}|${scope.workspaceKeys[1]}` : undefined,
    vItemKey: shared && scope.grantable ? `${version}|${grantKeyOf(kind, itemId)}` : undefined,
    vAudienceKey: shared && scope.audienceKey ? `${version}|${scope.audienceKey}` : undefined,
  };
}

export type VectorKeyField = keyof VectorKeys;
export type VectorTerm = { field: VectorKeyField; value: string };

/** Which vector filter fields a plain viewer key can appear in. */
export function vectorFieldsForKey(key: string): VectorKeyField[] {
  if (key.includes("|w:")) return ["vWorkspaceKey", "vWorkspaceKey2"];
  if (key.includes("|i:")) return ["vItemKey"];
  if (key.startsWith("school|s:") || key.startsWith("school|staff:") || key.startsWith("school|c:")) return ["vAudienceKey"];
  return ["vOwnerKey"];
}

/**
 * The viewer's keys as OR-ed vector filter terms, versioned and split into groups of at most
 * VECTOR_FILTER_TERMS terms; each group is one vector search, run in parallel.
 */
export function vectorFilterGroups(version: string, keys: string[]): VectorTerm[][] {
  const groups: VectorTerm[][] = [];
  let current: VectorTerm[] = [];
  for (const key of keys) {
    const terms = vectorFieldsForKey(key).map((field) => ({ field, value: `${version}|${key}` }));
    if (current.length + terms.length > VECTOR_FILTER_TERMS) { groups.push(current); current = []; }
    current.push(...terms);
  }
  if (current.length) groups.push(current);
  return groups;
}

/** Full-text filter fields of a chunk. Owner-only passages are found through the owner only. */
export function lexicalKeysFor(scope: ItemScope, ownerOnly = false) {
  return {
    ownerAccountId: scope.ownerAccountId,
    schoolId: scope.schoolId,
    workspaceKey: ownerOnly ? undefined : scope.workspaceKeys[0],
    audienceKey: ownerOnly ? undefined : scope.audienceKey,
  };
}

/** One full-text search: AND-ed equality filters on the chunk's lexical keys. */
export type LexicalScope = {
  itemKind?: IndexedSemanticKind;
  ownerAccountId?: Id<"accounts">;
  workspaceKey?: string;
  audienceKey?: string;
};
