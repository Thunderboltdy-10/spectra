import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { queueDeletionDispatch } from "./artifactDeletionScheduling";
import {
  FIRST_ORDER_KEY,
  between,
  compareOrderKeys,
  nextOrderKey,
  normalizeOrderKey,
} from "../src/features/spectra/organization/order-key";

/**
 * The organizational tree (ARCHITECTURE-STORAGE §3).
 *
 * Every write goes through this module so the invariants hold server-side and
 * cannot be bypassed by a client: one primary placement per work or thread
 * (I1), moves are single-row metadata transactions (I4), no cycles (I5), and
 * `workspaceContextId` is always the nearest ancestor workspace — a nested
 * workspace's subtree carries its own id, never its parent's (D32).
 */

export type OrgCtx = QueryCtx | MutationCtx;
export type OrgWriteCtx = MutationCtx;
type SummaryWriteCtx = Pick<MutationCtx, "db">;
export type OrgNode = Doc<"orgNodes">;
export type OrgNodeKind = OrgNode["kind"];

const ARTIFACT_SUMMARY_SEARCH_CHARS = 1_400;
const ARTIFACT_SUMMARY_TITLE_CHARS = 240;
const ARTIFACT_SUMMARY_DESCRIPTION_CHARS = 600;
const ARTIFACT_SUMMARY_TAGS = 12;
const ARTIFACT_SUMMARY_TAG_CHARS = 48;
const ARTIFACT_SUMMARY_EFFECTS = 4;
const ARTIFACT_SUMMARY_EFFECT_PATHS = 4;
const ARTIFACT_SUMMARY_EFFECT_PATH_CHARS = 80;
const ARTIFACT_SUMMARY_EFFECT_TITLE_CHARS = 120;
const ARTIFACT_SUMMARY_EFFECT_DETAIL_CHARS = 180;
const ARTIFACT_SUMMARY_PROVENANCE_ITEMS = 8;
const ARTIFACT_SUMMARY_PROVENANCE_CHARS = 120;
const ARTIFACT_SUMMARY_CONTEXT_CHARS = 400;

/**
 * Version of the small artifact record used by list, tree and authority
 * reads.  Keep this separate from the artifact content/schema version: a
 * content migration must not silently make a list reader hydrate the body.
 */
export const ARTIFACT_SUMMARY_READ_MODEL_VERSION = 2;
const ARTIFACT_REVISION_FACTS_READ_MODEL_VERSION = 1;

function boundedSummaryText(value: string | undefined, limit: number) {
  return value?.slice(0, limit);
}

function boundedSummaryStrings(
  values: string[] | undefined,
  count: number,
  chars: number,
) {
  return values?.slice(0, count).map((value) => value.slice(0, chars));
}

/**
 * The only artifact shape Library and board readers may hydrate. Keep this an
 * explicit allowlist: spreading the source document previously sent content,
 * protected bases and preview payloads through a supposedly "summary" query.
 */
export function artifactSummaryProjection(
  artifact: Doc<"spectraArtifacts">,
) {
  const aiPreview = artifact.aiPreview
    ? {
        title: boundedSummaryText(
          artifact.aiPreview.title,
          ARTIFACT_SUMMARY_TITLE_CHARS,
        ),
        summary: boundedSummaryText(
          artifact.aiPreview.summary,
          ARTIFACT_SUMMARY_DESCRIPTION_CHARS,
        ),
        tags: boundedSummaryStrings(
          artifact.aiPreview.tags,
          ARTIFACT_SUMMARY_TAGS,
          ARTIFACT_SUMMARY_TAG_CHARS,
        ),
        changedPaths: boundedSummaryStrings(
          artifact.aiPreview.changedPaths,
          ARTIFACT_SUMMARY_EFFECT_PATHS,
          ARTIFACT_SUMMARY_EFFECT_PATH_CHARS,
        ),
        effectTitle: boundedSummaryText(
          artifact.aiPreview.effectTitle,
          ARTIFACT_SUMMARY_EFFECT_TITLE_CHARS,
        ),
        effectDetail: boundedSummaryText(
          artifact.aiPreview.effectDetail,
          ARTIFACT_SUMMARY_EFFECT_DETAIL_CHARS,
        ),
        effectActivity: artifact.aiPreview.effectActivity,
        effectRegionHint: boundedSummaryText(
          artifact.aiPreview.effectRegionHint,
          ARTIFACT_SUMMARY_EFFECT_TITLE_CHARS,
        ),
        effectOperationIndex: artifact.aiPreview.effectOperationIndex,
        startedAt: artifact.aiPreview.startedAt,
      }
    : undefined;
  const aiEffects = artifact.aiEffects
    ?.slice(-ARTIFACT_SUMMARY_EFFECTS)
    .map((effect) => ({
      effectId: effect.effectId,
      runId: effect.runId,
      executionId: effect.executionId,
      operationIndex: effect.operationIndex,
      title: effect.title.slice(0, ARTIFACT_SUMMARY_EFFECT_TITLE_CHARS),
      detail: boundedSummaryText(
        effect.detail,
        ARTIFACT_SUMMARY_EFFECT_DETAIL_CHARS,
      ),
      activity: effect.activity,
      regionHint: boundedSummaryText(
        effect.regionHint,
        ARTIFACT_SUMMARY_EFFECT_TITLE_CHARS,
      ),
      regionIds: boundedSummaryStrings(
        effect.regionIds,
        ARTIFACT_SUMMARY_EFFECT_PATHS,
        ARTIFACT_SUMMARY_EFFECT_PATH_CHARS,
      )!,
      changedPaths: boundedSummaryStrings(
        effect.changedPaths,
        ARTIFACT_SUMMARY_EFFECT_PATHS,
        ARTIFACT_SUMMARY_EFFECT_PATH_CHARS,
      )!,
      state: effect.state,
      startedAt: effect.startedAt,
      updatedAt: effect.updatedAt,
      expiresAt: effect.expiresAt,
    }));
  const createdFrom = artifact.createdFrom
    ? {
        source: artifact.createdFrom.source,
        threadId: artifact.createdFrom.threadId,
        runId: artifact.createdFrom.runId,
        workspaceId: artifact.createdFrom.workspaceId,
        sourceArtifactIds: artifact.createdFrom.sourceArtifactIds?.slice(
          0,
          ARTIFACT_SUMMARY_PROVENANCE_ITEMS,
        ),
        sourceThreadIds: artifact.createdFrom.sourceThreadIds?.slice(
          0,
          ARTIFACT_SUMMARY_PROVENANCE_ITEMS,
        ),
        sourceAttachmentNames: boundedSummaryStrings(
          artifact.createdFrom.sourceAttachmentNames,
          ARTIFACT_SUMMARY_PROVENANCE_ITEMS,
          ARTIFACT_SUMMARY_PROVENANCE_CHARS,
        ),
        contextSummary: boundedSummaryText(
          artifact.createdFrom.contextSummary,
          ARTIFACT_SUMMARY_CONTEXT_CHARS,
        ),
      }
    : undefined;
  return {
    _id: artifact._id,
    _creationTime: artifact._creationTime,
    ownerAccountId: artifact.ownerAccountId,
    schoolId: artifact.schoolId,
    resourceClass: artifact.resourceClass,
    nativeFormat: artifact.nativeFormat,
    compatibilityProfile: artifact.compatibilityProfile,
    blueprintKey: artifact.blueprintKey,
    ...(artifact.storageHome ? { storageHome: artifact.storageHome, storageStoreId: artifact.storageStoreId } : {}),
    ...(artifact.storageEpoch ? { storageEpoch: artifact.storageEpoch } : {}),
    title: artifact.title.slice(0, ARTIFACT_SUMMARY_TITLE_CHARS),
    ...(artifact.renamedFromTitle ? { renamedFromTitle: artifact.renamedFromTitle.slice(0, ARTIFACT_SUMMARY_TITLE_CHARS) } : {}),
    summary: boundedSummaryText(
      artifact.summary,
      ARTIFACT_SUMMARY_DESCRIPTION_CHARS,
    ),
    tags: boundedSummaryStrings(
      artifact.tags,
      ARTIFACT_SUMMARY_TAGS,
      ARTIFACT_SUMMARY_TAG_CHARS,
    )!,
    status: artifact.status,
    aiState: artifact.aiState,
    aiRunId: artifact.aiRunId,
    aiExecutionId: artifact.aiExecutionId,
    aiProgress: artifact.aiProgress,
    aiStateExpiresAt: artifact.aiStateExpiresAt,
    aiPreview,
    aiEffects,
    createdFrom,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  };
}

export function artifactSummarySearchText(
  artifact: Doc<"spectraArtifacts">,
) {
  return `${artifact.title}\n${artifact.summary ?? ""}\n${artifact.tags.join(" ")}\n${artifact.blueprintKey}\n${artifact.textIndex ?? ""}`
    .slice(0, ARTIFACT_SUMMARY_SEARCH_CHARS)
    .toLowerCase();
}

async function upsertArtifactRevisionFacts(
  ctx: SummaryWriteCtx,
  artifact: Doc<"spectraArtifacts">,
) {
  const existing = await ctx.db
    .query("spectraArtifactRevisionFacts")
    .withIndex("by_artifact", (q) => q.eq("artifactId", artifact._id))
    .unique();
  const value = {
    readModelVersion: ARTIFACT_REVISION_FACTS_READ_MODEL_VERSION,
    artifactId: artifact._id,
    ownerAccountId: artifact.ownerAccountId,
    schoolId: artifact.schoolId,
    currentVersionId: artifact.currentVersionId,
    contentHash: artifact.contentHash,
    schemaVersion: artifact.schemaVersion,
    deletionGeneration: artifact.deletionGeneration,
    updatedAt: artifact.updatedAt,
  };
  if (
    existing &&
    existing.readModelVersion === value.readModelVersion &&
    existing.artifactId === value.artifactId &&
    existing.ownerAccountId === value.ownerAccountId &&
    existing.schoolId === value.schoolId &&
    existing.currentVersionId === value.currentVersionId &&
    existing.contentHash === value.contentHash &&
    existing.schemaVersion === value.schemaVersion &&
    existing.deletionGeneration === value.deletionGeneration &&
    existing.updatedAt === value.updatedAt
  )
    return;
  if (existing) await ctx.db.patch(existing._id, value);
  else await ctx.db.insert("spectraArtifactRevisionFacts", value);
}

export async function upsertArtifactSummary(
  ctx: SummaryWriteCtx,
  artifact: Doc<"spectraArtifacts">,
) {
  await upsertArtifactRevisionFacts(ctx, artifact);
  const existing = await ctx.db
    .query("spectraArtifactSummaries")
    .withIndex("by_artifact", (q) => q.eq("artifactId", artifact._id))
    .unique();
  const value = {
    readModelVersion: ARTIFACT_SUMMARY_READ_MODEL_VERSION,
    artifactId: artifact._id,
    ownerAccountId: artifact.ownerAccountId,
    schoolId: artifact.schoolId,
    blueprintKey: artifact.blueprintKey,
    status: artifact.status,
    updatedAt: artifact.updatedAt,
    searchText: artifactSummarySearchText(artifact),
    createdAt: artifact.createdAt,
    createdFromThreadId: artifact.createdFrom?.threadId,
    createdFromWorkspaceId: artifact.createdFrom?.workspaceId,
    aiRunId: artifact.aiRunId,
    // Kept explicitly undefined so old rows shed these revision-only fields
    // on their first post-migration write instead of retaining hot-row churn.
    currentVersionId: undefined,
    contentHash: undefined,
    schemaVersion: undefined,
    deletionGeneration: undefined,
    projection: artifactSummaryProjection(artifact),
  };
  if (existing) {
    // A trigger and an explicit writer can both see the same artifact change.
    // Avoid a second summary invalidation when the first seam already wrote the
    // exact authoritative value.
    const unchanged =
      existing.readModelVersion === value.readModelVersion &&
      existing.artifactId === value.artifactId &&
      existing.ownerAccountId === value.ownerAccountId &&
      existing.schoolId === value.schoolId &&
      existing.blueprintKey === value.blueprintKey &&
      existing.status === value.status &&
      existing.updatedAt === value.updatedAt &&
      existing.searchText === value.searchText &&
      existing.createdAt === value.createdAt &&
      existing.createdFromThreadId === value.createdFromThreadId &&
      existing.createdFromWorkspaceId === value.createdFromWorkspaceId &&
      existing.aiRunId === value.aiRunId &&
      existing.currentVersionId === value.currentVersionId &&
      existing.contentHash === value.contentHash &&
      existing.schemaVersion === value.schemaVersion &&
      existing.deletionGeneration === value.deletionGeneration &&
      JSON.stringify(existing.projection) === JSON.stringify(value.projection);
    if (!unchanged) await ctx.db.patch(existing._id, value);
  } else await ctx.db.insert("spectraArtifactSummaries", value);
}

export async function deleteArtifactSummary(
  ctx: SummaryWriteCtx,
  artifactId: Id<"spectraArtifacts">,
) {
  const existing = await ctx.db
    .query("spectraArtifactSummaries")
    .withIndex("by_artifact", (q) => q.eq("artifactId", artifactId))
    .unique();
  if (existing) await ctx.db.delete(existing._id);
  const revisionFacts = await ctx.db
    .query("spectraArtifactRevisionFacts")
    .withIndex("by_artifact", (q) => q.eq("artifactId", artifactId))
    .unique();
  if (revisionFacts) await ctx.db.delete(revisionFacts._id);
}

export async function artifactRevisionFactsFor(
  ctx: OrgCtx,
  artifactId: Id<"spectraArtifacts">,
) {
  return ctx.db
    .query("spectraArtifactRevisionFacts")
    .withIndex("by_artifact", (q) => q.eq("artifactId", artifactId))
    .unique();
}

export async function syncArtifactSummary(
  ctx: OrgWriteCtx,
  artifactId: Id<"spectraArtifacts">,
) {
  const artifact = await ctx.db.get(artifactId);
  if (!artifact) {
    await deleteArtifactSummary(ctx, artifactId);
    return null;
  }
  await upsertArtifactSummary(ctx, artifact);
  return artifactSummaryProjection(artifact);
}

export async function artifactSummaryFor(
  ctx: OrgCtx,
  artifactId: Id<"spectraArtifacts">,
) {
  return ctx.db
    .query("spectraArtifactSummaries")
    .withIndex("by_artifact", (q) => q.eq("artifactId", artifactId))
    .unique();
}

export const ORG_NODE_KINDS = [
  "folder",
  "workspace",
  "work",
  "thread",
  "link",
] as const;

/** Kinds that may hold children. Everything else is a leaf. */
export const CONTAINER_KINDS: readonly OrgNodeKind[] = ["folder", "workspace"];

/** Kinds whose identity lives elsewhere and which must have exactly one node. */
export const PLACED_KINDS: readonly OrgNodeKind[] = ["work", "thread"];

/** Guards the recursive walks and keeps breadcrumbs readable. */
export const MAX_TREE_DEPTH = 32;
export const MAX_NODE_NAME_LENGTH = 200;
export const GENERAL_STARTER_KEY = "general";
export const GENERAL_WORKSPACE_TITLE = "General";
export const GENERAL_WORKSPACE_DESCRIPTION =
  "Everything that has no other home. Always here, never deleted.";

/** Characters a later local mirror could not put in a filename (N3). */
const RESERVED_NAME_CHARACTERS = /[/\\:*?"<>|]/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/**
 * What a reader would call this thing. Work carries its blueprint key; every
 * other kind is its own type, because a folder is a folder and a thread is a
 * thread whatever it contains.
 *
 * Cached on the node so a board column of one type is an indexed range instead
 * of a scan of the account (CANON D42). A link reports the type it points at,
 * so a reference to a quiz files under quizzes.
 */
export function typeKeyFor(kind: OrgNodeKind, blueprintKey?: unknown) {
  if (kind !== "work") return kind;
  return typeof blueprintKey === "string" && blueprintKey.length > 0
    ? blueprintKey
    : "document";
}

/**
 * The blueprint key of a work source, read once at placement time. Threads and
 * containers need no read: their kind *is* their type.
 */
export async function typeKeyForSource(
  ctx: OrgCtx,
  kind: OrgNodeKind,
  sourceId: string,
) {
  if (kind !== "work") return typeKeyFor(kind);
  const artifactId = ctx.db.normalizeId("spectraArtifacts", sourceId);
  if (!artifactId) return typeKeyFor(kind);
  const artifact = await ctx.db.get(artifactId);
  return typeKeyFor(kind, artifact?.blueprintKey);
}

export function isContainerKind(kind: OrgNodeKind) {
  return CONTAINER_KINDS.includes(kind);
}

/**
 * Maintain the direct-live-child projection after a structural write. Rows
 * created before the projection existed stay uncounted here: recounting
 * General (or any large parent) inside a user mutation is a Convex byte
 * bomb. Migrated rows take the constant-read delta path. Missing counts
 * are repaired by `backfillChildCounts`, never by a sibling scan.
 */
async function adjustChildCount(
  ctx: OrgWriteCtx,
  parentId: Id<"orgNodes"> | null,
  delta: number,
) {
  if (!parentId || delta === 0) return;
  const parent = await ctx.db.get(parentId);
  if (!parent || !isContainerKind(parent.kind)) return;
  if (parent.childCount === undefined) return;
  await ctx.db.patch(parentId, {
    childCount: Math.max(0, parent.childCount + delta),
  });
}

/** Names derived from a source title: repaired, never rejected. */
export function sanitizeNodeName(raw: unknown, fallback = "Untitled") {
  const text = (typeof raw === "string" ? raw : "")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (text || fallback).slice(0, MAX_NODE_NAME_LENGTH);
}

/** Names the user types into the tree: validated, with a reason on failure. */
export function assertUserNodeName(raw: unknown) {
  const text = (typeof raw === "string" ? raw : "")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) throw new Error("A name is required.");
  if (text.length > MAX_NODE_NAME_LENGTH)
    throw new Error(`Names are limited to ${MAX_NODE_NAME_LENGTH} characters.`);
  if (RESERVED_NAME_CHARACTERS.test(text))
    throw new Error('A name cannot contain / \\ : * ? " < > or |.');
  if (text === "." || text === "..") throw new Error("That name is reserved.");
  return text;
}

export async function requireNode(ctx: OrgCtx, nodeId: Id<"orgNodes">) {
  const node = await ctx.db.get(nodeId);
  if (!node) throw new Error("That item is no longer in your library.");
  return node;
}

export function assertOwnNode(node: OrgNode, accountId: Id<"accounts">) {
  if (node.accountId !== accountId)
    throw new Error("That item is not in your library.");
  return node;
}

export async function requireOwnNode(
  ctx: OrgCtx,
  nodeId: Id<"orgNodes">,
  accountId: Id<"accounts">,
) {
  return assertOwnNode(await requireNode(ctx, nodeId), accountId);
}

/* ------------------------------------------------------------------ reads */

/** Live children of a parent (`null` = Library root), in tree order. */
export async function listChildNodes(
  ctx: OrgCtx,
  accountId: Id<"accounts">,
  parentId: Id<"orgNodes"> | null,
  options?: { includeTrashed?: boolean; limit?: number },
) {
  const query = ctx.db
    .query("orgNodes")
    .withIndex("by_account_parent_order", (q) =>
      q.eq("accountId", accountId).eq("parentId", parentId),
    );
  const rows = options?.limit
    ? await query.take(options.limit)
    : await query.collect();
  return options?.includeTrashed
    ? rows
    : rows.filter((row) => row.deletedAt === undefined);
}

export async function lastChildOrderKey(
  ctx: OrgCtx,
  accountId: Id<"accounts">,
  parentId: Id<"orgNodes"> | null,
) {
  const rows = await ctx.db
    .query("orgNodes")
    .withIndex("by_account_parent_order", (q) =>
      q.eq("accountId", accountId).eq("parentId", parentId),
    )
    .order("desc")
    .take(1);
  return normalizeOrderKey(rows[0]?.orderKey);
}

/**
 * The order key for a node appended to a parent. Trashed siblings still hold
 * their keys so a restore lands where it was.
 */
export async function appendOrderKey(
  ctx: OrgCtx,
  accountId: Id<"accounts">,
  parentId: Id<"orgNodes"> | null,
) {
  return nextOrderKey(await lastChildOrderKey(ctx, accountId, parentId));
}

/** The single node that *is* a work's or thread's placement, if it exists. */
export async function findPrimaryNode(
  ctx: OrgCtx,
  accountId: Id<"accounts">,
  kind: OrgNodeKind,
  sourceId: string,
) {
  const rows = await ctx.db
    .query("orgNodes")
    .withIndex("by_account_kind_source", (q) =>
      q.eq("accountId", accountId).eq("kind", kind).eq("sourceId", sourceId),
    )
    .collect();
  return (
    rows.find((row) => row.deletedAt === undefined) ??
    rows.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))[0] ??
    null
  );
}

/** Every node for a source across accounts — used by migration counts. */
export async function findNodesForSource(
  ctx: OrgCtx,
  kind: OrgNodeKind,
  sourceId: string,
) {
  return ctx.db
    .query("orgNodes")
    .withIndex("by_kind_source", (q) =>
      q.eq("kind", kind).eq("sourceId", sourceId),
    )
    .collect();
}

/**
 * Live nodes inside a workspace's context, in tree order. The context id is
 * stamped on every descendant, so this is one indexed read rather than a walk.
 */
export async function workspaceContextNodes(
  ctx: OrgCtx,
  workspaceId: Id<"spectraWorkspaces">,
  kind?: OrgNodeKind,
) {
  const nodes = await ctx.db
    .query("orgNodes")
    .withIndex("by_workspace_context", (q) =>
      q.eq("workspaceContextId", workspaceId),
    )
    .collect();
  return nodes
    .filter(
      (node) =>
        node.deletedAt === undefined && (kind === undefined || node.kind === kind),
    )
    .sort((a, b) => compareOrderKeys(a.orderKey, b.orderKey));
}

export async function ancestorChain(ctx: OrgCtx, node: OrgNode) {
  const chain: OrgNode[] = [];
  let current: OrgNode | null = node;
  for (let depth = 0; depth < MAX_TREE_DEPTH + 1; depth += 1) {
    if (!current?.parentId) return chain;
    const parent: OrgNode | null = await ctx.db.get(current.parentId);
    if (!parent) return chain;
    chain.push(parent);
    current = parent;
  }
  throw new Error("This folder is nested too deeply.");
}

/** Root-first path to a node, excluding the node itself. */
export async function breadcrumbNodes(ctx: OrgCtx, node: OrgNode) {
  return (await ancestorChain(ctx, node)).reverse();
}

/**
 * The folder names between a node and the workspace holding it, outermost
 * first. This is what makes a workspace's shape portable (N1 §export).
 */
export async function relativeFolderPath(ctx: OrgCtx, node: OrgNode) {
  const path: string[] = [];
  for (const ancestor of await ancestorChain(ctx, node)) {
    if (ancestor.kind !== "folder") break;
    path.unshift(ancestor.name);
  }
  return path;
}

export async function nodeDepth(ctx: OrgCtx, node: OrgNode) {
  return (await ancestorChain(ctx, node)).length;
}

/**
 * Node ids in a subtree, node first. Stops at nested workspace boundaries when
 * `stopAtWorkspaces` is set, which is what context stamping needs (D32).
 */
export async function subtreeNodes(
  ctx: OrgCtx,
  root: OrgNode,
  options?: { stopAtWorkspaces?: boolean; includeTrashed?: boolean },
) {
  const collected: OrgNode[] = [root];
  let frontier: OrgNode[] = [root];
  for (
    let depth = 0;
    depth < MAX_TREE_DEPTH && frontier.length > 0;
    depth += 1
  ) {
    const next: OrgNode[] = [];
    for (const parent of frontier) {
      if (!isContainerKind(parent.kind)) continue;
      if (
        options?.stopAtWorkspaces &&
        parent._id !== root._id &&
        parent.kind === "workspace"
      )
        continue;
      const children = await ctx.db
        .query("orgNodes")
        .withIndex("by_parent", (q) => q.eq("parentId", parent._id))
        .collect();
      for (const child of children) {
        if (!options?.includeTrashed && child.deletedAt !== undefined) continue;
        collected.push(child);
        next.push(child);
      }
    }
    frontier = next;
  }
  return collected;
}

/* ------------------------------------------------------------- validation */

/** A leaf can never be a parent; a link is never a container. */
export function assertParentAcceptsChild(
  parent: OrgNode | null,
  childKind: OrgNodeKind,
) {
  if (!parent) return;
  if (!isContainerKind(parent.kind))
    throw new Error(
      parent.kind === "link"
        ? "A reference cannot contain items. Open the original to organize it."
        : "Only folders and workspaces can contain items.",
    );
  if (parent.deletedAt !== undefined)
    throw new Error("That destination is in the trash.");
  void childKind;
}

/** I5: `parentId` chains are validated on every move. */
export async function assertNoCycle(
  ctx: OrgCtx,
  nodeId: Id<"orgNodes">,
  parentId: Id<"orgNodes"> | null,
) {
  let current = parentId;
  for (let depth = 0; depth < MAX_TREE_DEPTH + 1; depth += 1) {
    if (!current) return;
    if (current === nodeId)
      throw new Error("A folder cannot be moved inside itself.");
    const parent: OrgNode | null = await ctx.db.get(current);
    if (!parent) return;
    current = parent.parentId;
  }
  throw new Error("This folder is nested too deeply.");
}

export async function assertDepthFits(
  ctx: OrgCtx,
  parentId: Id<"orgNodes"> | null,
  subtreeHeightValue = 1,
) {
  if (!parentId) return;
  const parent = await requireNode(ctx, parentId);
  const depth = await nodeDepth(ctx, parent);
  if (depth + 1 + subtreeHeightValue > MAX_TREE_DEPTH)
    throw new Error("This folder is nested too deeply.");
}

async function subtreeHeight(ctx: OrgCtx, root: OrgNode) {
  const nodes = await subtreeNodes(ctx, root, { includeTrashed: true });
  const depths = new Map<string, number>([[root._id, 0]]);
  let max = 0;
  for (const node of nodes) {
    if (node._id === root._id) continue;
    const parentDepth = node.parentId ? depths.get(node.parentId) : undefined;
    const depth = (parentDepth ?? 0) + 1;
    depths.set(node._id, depth);
    if (depth > max) max = depth;
  }
  return max;
}

/* --------------------------------------------------- workspace context */

/** The workspace a child of `parent` belongs to. Root-level = no workspace. */
export function workspaceContextForParent(parent: OrgNode | null) {
  if (!parent) return undefined;
  if (parent.kind === "workspace" && parent.sourceId)
    return parent.sourceId as Id<"spectraWorkspaces">;
  return parent.workspaceContextId;
}

async function assertWorkspaceWritable(
  ctx: OrgWriteCtx,
  workspaceId: Id<"spectraWorkspaces"> | undefined,
) {
  if (!workspaceId) return;
  const workspace = await ctx.db.get(workspaceId);
  if (workspace?.permanentDeleteJobId)
    throw new Error(
      "WORKSPACE_DELETE_IN_PROGRESS: This workspace is being removed.",
    );
}

async function assertNodeWorkspaceWritable(ctx: OrgWriteCtx, node: OrgNode) {
  const workspaceId =
    node.kind === "workspace" && node.sourceId
      ? ctx.db.normalizeId("spectraWorkspaces", node.sourceId) ?? undefined
      : node.workspaceContextId;
  await assertWorkspaceWritable(ctx, workspaceId);
}

async function assertParentWorkspaceWritable(
  ctx: OrgWriteCtx,
  parent: OrgNode | null,
) {
  await assertWorkspaceWritable(ctx, workspaceContextForParent(parent));
}

export function ownWorkspaceContext(node: OrgNode) {
  return node.kind === "workspace" && node.sourceId
    ? (node.sourceId as Id<"spectraWorkspaces">)
    : undefined;
}

/**
 * Re-stamp `workspaceContextId` across a moved subtree. Descent stops at nested
 * workspaces: their context did not change, and neither did their contents
 * (D32).
 */
export async function stampSubtreeContext(
  ctx: OrgWriteCtx,
  root: OrgNode,
  context: Id<"spectraWorkspaces"> | undefined,
) {
  const rootContext = ownWorkspaceContext(root) ?? context;
  const nodes = await subtreeNodes(ctx, root, {
    stopAtWorkspaces: true,
    includeTrashed: true,
  });
  const now = Date.now();
  for (const node of nodes) {
    /* A workspace is its own context wherever it sits, so a nested one keeps
       its id while everything around it takes the moved subtree's (D32). */
    const value = ownWorkspaceContext(node) ?? rootContext;
    if (node.workspaceContextId === value) continue;
    // A work that changes workspace starts over there: shared only if that
    // workspace shares new work and the work is its filer's own to share.
    const artifactId =
      node.kind === "work" && node.sourceId
        ? ctx.db.normalizeId("spectraArtifacts", node.sourceId)
        : null;
    const owned =
      artifactId !== null &&
      (await artifactSummaryFor(ctx, artifactId))?.ownerAccountId === node.accountId;
    const projection =
      node.kind === "work" ? await startingProjection(ctx, value, owned) : undefined;
    await ctx.db.patch(node._id, {
      workspaceContextId: value,
      ...(node.kind === "work" && projection !== node.accessProjection
        ? { accessProjection: projection }
        : {}),
      updatedAt: now,
    });
  }
  return rootContext;
}

/* ------------------------------------------------------------- General */

/**
 * The account's General workspace: a real, undeletable workspace so nothing is
 * ever contextless (D31). Created on demand, never duplicated.
 */
export async function ensureGeneralWorkspace(
  ctx: OrgWriteCtx,
  accountId: Id<"accounts">,
  schoolId?: Id<"schools">,
) {
  const existing = await ctx.db
    .query("spectraWorkspaces")
    .withIndex("by_account_starter", (q) =>
      q.eq("ownerAccountId", accountId).eq("starterKey", GENERAL_STARTER_KEY),
    )
    .collect();
  const live = existing.find((row) => row.status === "active") ?? existing[0];
  if (live) {
    if (live.status !== "active")
      await ctx.db.patch(live._id, { status: "active", updatedAt: Date.now() });
    return (await ctx.db.get(live._id))!;
  }
  const now = Date.now();
  const workspaceId = await ctx.db.insert("spectraWorkspaces", {
    ownerAccountId: accountId,
    schoolId,
    title: GENERAL_WORKSPACE_TITLE,
    description: GENERAL_WORKSPACE_DESCRIPTION,
    starterKey: GENERAL_STARTER_KEY,
    status: "active",
    defaultView: "library",
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  });
  return (await ctx.db.get(workspaceId))!;
}

export function isGeneralWorkspace(workspace: Doc<"spectraWorkspaces">) {
  return workspace.starterKey === GENERAL_STARTER_KEY;
}

/** A class is a workspace like any other, marked as one; a ManageBac class's starts marked. */
export function workspaceIsClass(workspace: Pick<Doc<"spectraWorkspaces">, "isClass" | "starterKey">) {
  return workspace.isClass ?? workspace.starterKey === "managebac-class";
}

/** The tree node for a workspace, created at the Library root if missing. */
export async function ensureWorkspaceNode(
  ctx: OrgWriteCtx,
  workspace: Doc<"spectraWorkspaces">,
) {
  if (workspace.permanentDeleteJobId)
    throw new Error(
      "WORKSPACE_DELETE_IN_PROGRESS: This workspace is being removed.",
    );
  const accountId = workspace.ownerAccountId;
  const existing = await findPrimaryNode(
    ctx,
    accountId,
    "workspace",
    workspace._id,
  );
  if (existing) {
    const name = sanitizeNodeName(workspace.title, GENERAL_WORKSPACE_TITLE);
    const patch: Record<string, unknown> = {};
    if (existing.name !== name) patch.name = name;
    if (existing.deletedAt !== undefined && isGeneralWorkspace(workspace)) {
      patch.deletedAt = undefined;
      patch.trashedRootId = undefined;
    }
    if (Object.keys(patch).length > 0)
      await ctx.db.patch(existing._id, { ...patch, updatedAt: Date.now() });
    return (await ctx.db.get(existing._id))!;
  }
  const now = Date.now();
  const nodeId = await ctx.db.insert("orgNodes", {
    accountId,
    schoolId: workspace.schoolId,
    parentId: null,
    kind: "workspace",
    name: sanitizeNodeName(workspace.title, GENERAL_WORKSPACE_TITLE),
    sourceId: workspace._id,
    typeKey: typeKeyFor("workspace"),
    activityAt: now,
    orderKey: await appendOrderKey(ctx, accountId, null),
    workspaceContextId: workspace._id,
    placedByAccountId: accountId,
    childCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  return (await ctx.db.get(nodeId))!;
}

/** The General workspace and its node, both guaranteed to exist. */
export async function ensureGeneralNode(
  ctx: OrgWriteCtx,
  accountId: Id<"accounts">,
  schoolId?: Id<"schools">,
) {
  const workspace = await ensureGeneralWorkspace(ctx, accountId, schoolId);
  const node = await ensureWorkspaceNode(ctx, workspace);
  return { workspace, node };
}

export async function assertNotGeneralWorkspaceNode(
  ctx: OrgCtx,
  node: OrgNode,
  action: "delete" | "move",
) {
  if (node.kind !== "workspace" || !node.sourceId) return;
  const workspaceId = ctx.db.normalizeId("spectraWorkspaces", node.sourceId);
  const workspace = workspaceId ? await ctx.db.get(workspaceId) : null;
  if (!workspace || !isGeneralWorkspace(workspace)) return;
  if (action === "delete")
    throw new Error(
      "General cannot be deleted — it is where work with no other home lives.",
    );
}

/* ------------------------------------------------------------------ writes */

export type PlacementTarget = {
  /** Explicit destination. Wins over `workspaceId`. */
  parentId?: Id<"orgNodes"> | null;
  /** Place directly inside this workspace's node. */
  workspaceId?: Id<"spectraWorkspaces">;
};

async function resolveTargetParent(
  ctx: OrgWriteCtx,
  accountId: Id<"accounts">,
  target: PlacementTarget,
  schoolId?: Id<"schools">,
) {
  if (target.parentId !== undefined) {
    if (target.parentId === null) return null;
    return await requireOwnNode(ctx, target.parentId, accountId);
  }
  if (target.workspaceId) {
    const workspace = await ctx.db.get(target.workspaceId);
    if (workspace && workspace.ownerAccountId === accountId)
      return await ensureWorkspaceNode(ctx, workspace);
  }
  /* D31's floor: the answer is never "nothing". */
  return (await ensureGeneralNode(ctx, accountId, schoolId)).node;
}

/**
 * Whether a placement shares its work with the people its workspace is shared
 * with. Only an explicit share does: a work in a shared workspace is private
 * to its author until they share it.
 */
export function sharesWithWorkspace(node: { accessProjection?: boolean }) {
  return node.accessProjection === true;
}

/**
 * How a work filed in a workspace starts out: shared when the workspace shares
 * new work and the person filing it may share it, private otherwise.
 */
async function startingProjection(
  ctx: OrgCtx,
  workspaceId: Id<"spectraWorkspaces"> | undefined,
  mayShare: boolean | undefined,
) {
  if (!mayShare || !workspaceId) return undefined;
  const workspace = await ctx.db.get(workspaceId);
  return workspace?.shareNewWork === true ? true : undefined;
}

export type PlaceSourceParams = {
  accountId: Id<"accounts">;
  schoolId?: Id<"schools">;
  kind: "work" | "thread";
  sourceId: string;
  name: unknown;
  target?: PlacementTarget;
  placedByAccountId?: Id<"accounts">;
  /** The person filing it may share the work, so it follows the workspace's default for new work. */
  mayShare?: boolean;
  pinned?: boolean;
  /** Leave an existing placement where it is; only create when absent. */
  keepExistingPlacement?: boolean;
  /**
   * The source's type, when the caller already knows it. Omitted, it is read
   * from the source once — placement is rare, so the read is cheap and being
   * wrong here would file the work in the wrong board column forever.
   */
  typeKey?: string;
  /**
   * The source's home genuinely changed, so an existing node moves rather than
   * standing pat. Naming no workspace then means General, not "wherever it is".
   */
  relocate?: boolean;
};

async function syncWorkSummaryForSource(
  ctx: OrgWriteCtx,
  kind: "work" | "thread",
  sourceId: string,
) {
  if (kind !== "work") return;
  const artifactId = ctx.db.normalizeId("spectraArtifacts", sourceId);
  if (!artifactId) return;
  // Placement/name/move writes do not alter artifact metadata.  The summary
  // is already maintained by artifact writers; only hydrate a legacy/missing
  // row when a one-time repair is actually needed.
  const summary = await artifactSummaryFor(ctx, artifactId);
  if (!summary || summary.readModelVersion !== ARTIFACT_SUMMARY_READ_MODEL_VERSION)
    await syncArtifactSummary(ctx, artifactId);
}

/**
 * The single creation-time placement entry point (D31). Guarantees exactly one
 * primary node per source (I1): an existing placement is moved or left alone,
 * never duplicated.
 */
export async function placeSourceNode(
  ctx: OrgWriteCtx,
  params: PlaceSourceParams,
) {
  const target = params.target ?? {};
  const name = sanitizeNodeName(params.name);
  const existing = await findPrimaryNode(
    ctx,
    params.accountId,
    params.kind,
    params.sourceId,
  );
  const now = Date.now();

  /* An existing live placement is authoritative unless the caller names a new
     destination. Re-running a creation path must not relocate a user's work. */
  const keepInPlace =
    existing !== null &&
    existing.deletedAt === undefined &&
    (params.keepExistingPlacement === true ||
      (target.parentId === undefined &&
        (target.workspaceId
          ? /* Already inside that workspace — including in one of its folders,
               which a re-assert of the same workspace must not flatten. */
            existing.workspaceContextId === target.workspaceId
          : /* No destination named. A relocation means "out of the workspace it
               was in", and out of a workspace is General (D31), so it moves. */
            params.relocate !== true)));

  if (existing) await assertNodeWorkspaceWritable(ctx, existing);

  if (existing && keepInPlace) {
    const patch: Record<string, unknown> = { updatedAt: now };
    if (existing.name !== name) patch.name = name;
    if (existing.typeKey === undefined)
      patch.typeKey =
        params.typeKey ??
        (await typeKeyForSource(ctx, params.kind, params.sourceId));
    if (existing.activityAt === undefined) patch.activityAt = now;
    if (params.pinned !== undefined && existing.pinned !== params.pinned)
      patch.pinned = params.pinned;
    if (params.placedByAccountId && !existing.placedByAccountId)
      patch.placedByAccountId = params.placedByAccountId;
    await ctx.db.patch(existing._id, patch);
    await syncWorkSummaryForSource(ctx, params.kind, params.sourceId);
    return (await ctx.db.get(existing._id))!;
  }

  const parent = await resolveTargetParent(
    ctx,
    params.accountId,
    target,
    params.schoolId,
  );
  await assertParentWorkspaceWritable(ctx, parent);
  assertParentAcceptsChild(parent, params.kind);
  const context = workspaceContextForParent(parent);
  const typeKey =
    params.typeKey ??
    existing?.typeKey ??
    (await typeKeyForSource(ctx, params.kind, params.sourceId));

  if (existing) {
    const oldParentId = existing.parentId;
    const wasLive = existing.deletedAt === undefined;
    const nextParentId = parent?._id ?? null;
    await assertNoCycle(ctx, existing._id, parent?._id ?? null);
    await ctx.db.patch(existing._id, {
      parentId: nextParentId,
      name,
      typeKey,
      activityAt: existing.activityAt ?? now,
      workspaceContextId: context,
      orderKey:
        existing.parentId === (parent?._id ?? null) &&
        existing.deletedAt === undefined
          ? existing.orderKey
          : await appendOrderKey(ctx, params.accountId, parent?._id ?? null),
      accessProjection:
        existing.workspaceContextId === context && existing.deletedAt === undefined
          ? existing.accessProjection
          : await startingProjection(ctx, context, params.mayShare),
      pinned: params.pinned ?? existing.pinned,
      placedByAccountId: existing.placedByAccountId ?? params.placedByAccountId,
      deletedAt: undefined,
      trashedRootId: undefined,
      updatedAt: now,
    });
    if (wasLive && oldParentId !== nextParentId) {
      await adjustChildCount(ctx, oldParentId, -1);
      await adjustChildCount(ctx, nextParentId, 1);
    } else if (!wasLive) {
      await adjustChildCount(ctx, nextParentId, 1);
    }
    await syncWorkSummaryForSource(ctx, params.kind, params.sourceId);
    return (await ctx.db.get(existing._id))!;
  }

  const nodeId = await ctx.db.insert("orgNodes", {
    accountId: params.accountId,
    schoolId: params.schoolId,
    parentId: parent?._id ?? null,
    kind: params.kind,
    name,
    sourceId: params.sourceId,
    typeKey,
    activityAt: now,
    orderKey: await appendOrderKey(ctx, params.accountId, parent?._id ?? null),
    workspaceContextId: context,
    placedByAccountId: params.placedByAccountId ?? params.accountId,
    accessProjection: await startingProjection(ctx, context, params.mayShare),
    pinned: params.pinned,
    createdAt: now,
    updatedAt: now,
  });
  await adjustChildCount(ctx, parent?._id ?? null, 1);
  await syncWorkSummaryForSource(ctx, params.kind, params.sourceId);
  return (await ctx.db.get(nodeId))!;
}

/** Keep a node's cached name in step with its source (W5 relies on this). */
/**
 * Push a source's current truth onto its nodes: the cached title, and the fact
 * that something happened to it just now.
 *
 * Every caller is a real event — a content commit, a retitle, a run finishing —
 * so `activityAt` is stamped whether or not the title moved. That is the whole
 * point: a document edited all morning without being renamed must still rise to
 * the top of a recency-ordered column, and the column reads an index, not the
 * source rows (CANON D42). `updatedAt` stays what it says it is, the moment the
 * *placement* last changed.
 *
 * W5 relies on the name half of this: a rename is one write that every open
 * surface sees, because they are all subscribed to these rows.
 */
export async function syncSourceNodes(
  ctx: OrgWriteCtx,
  kind: OrgNodeKind,
  sourceId: string,
  title: unknown,
) {
  const name = sanitizeNodeName(title);
  const nodes = await findNodesForSource(ctx, kind, sourceId);
  const now = Date.now();
  for (const node of nodes) {
    const patch: Record<string, unknown> = { activityAt: now };
    if (node.name !== name) patch.name = name;
    if (node.typeKey === undefined) patch.typeKey = typeKeyFor(node.kind);
    if (patch.name !== undefined) patch.updatedAt = now;
    await ctx.db.patch(node._id, patch);
    /* References show the target's name and its activity, so they follow both. */
    for (const link of await findNodesForSource(ctx, "link", node._id))
      await ctx.db.patch(link._id, {
        ...(link.name === name ? {} : { name, updatedAt: now }),
        ...(link.typeKey === undefined
          ? { typeKey: node.typeKey ?? typeKeyFor(node.kind) }
          : {}),
        activityAt: now,
      });
  }
  if (kind === "work") {
    // Artifact writes already maintain the summary through the canonical
    // spectraArtifacts trigger. A node/title/activity write must only repair a
    // missing or old row; rereading the canonical body here doubled the hot
    // write cost for every content checkpoint.
    await syncWorkSummaryForSource(ctx, "work", sourceId);
  }
  return name;
}

export async function createFolderNode(
  ctx: OrgWriteCtx,
  params: {
    accountId: Id<"accounts">;
    schoolId?: Id<"schools">;
    name: unknown;
    parentId?: Id<"orgNodes"> | null;
  },
) {
  const name = assertUserNodeName(params.name);
  const parent =
    params.parentId != null
      ? await requireOwnNode(ctx, params.parentId, params.accountId)
      : null;
  await assertParentWorkspaceWritable(ctx, parent);
  assertParentAcceptsChild(parent, "folder");
  await assertDepthFits(ctx, parent?._id ?? null);
  const now = Date.now();
  const nodeId = await ctx.db.insert("orgNodes", {
    accountId: params.accountId,
    schoolId: params.schoolId,
    parentId: parent?._id ?? null,
    kind: "folder",
    name,
    typeKey: typeKeyFor("folder"),
    activityAt: now,
    orderKey: await appendOrderKey(ctx, params.accountId, parent?._id ?? null),
    workspaceContextId: workspaceContextForParent(parent),
    placedByAccountId: params.accountId,
    childCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  await adjustChildCount(ctx, parent?._id ?? null, 1);
  return (await ctx.db.get(nodeId))!;
}

/** A cross-reference. Links never own identity and never contain children. */
export async function createLinkNode(
  ctx: OrgWriteCtx,
  params: {
    accountId: Id<"accounts">;
    schoolId?: Id<"schools">;
    targetNodeId: Id<"orgNodes">;
    parentId?: Id<"orgNodes"> | null;
  },
) {
  const target = await requireOwnNode(
    ctx,
    params.targetNodeId,
    params.accountId,
  );
  if (target.kind === "link")
    throw new Error("Reference the original item, not another reference.");
  if (target.deletedAt !== undefined)
    throw new Error("That item is in the trash.");
  const parent =
    params.parentId != null
      ? await requireOwnNode(ctx, params.parentId, params.accountId)
      : null;
  await assertParentWorkspaceWritable(ctx, parent);
  assertParentAcceptsChild(parent, "link");
  if (parent && parent._id === target._id)
    throw new Error("An item cannot reference itself.");
  // Already here, as itself: placing it here again has nothing left to do.
  if ((target.parentId ?? null) === (parent?._id ?? null)) return target;
  const duplicate = (
    await listChildNodes(ctx, params.accountId, parent?._id ?? null)
  ).find((row) => row.kind === "link" && row.sourceId === target._id);
  if (duplicate) return duplicate;
  const now = Date.now();
  const nodeId = await ctx.db.insert("orgNodes", {
    accountId: params.accountId,
    schoolId: params.schoolId,
    parentId: parent?._id ?? null,
    kind: "link",
    name: target.name,
    sourceId: target._id,
    /* A reference files under whatever it points at, so a link to a quiz sits in
       the quizzes column rather than in a column of links. */
    typeKey: target.typeKey ?? typeKeyFor(target.kind),
    activityAt: now,
    orderKey: await appendOrderKey(ctx, params.accountId, parent?._id ?? null),
    workspaceContextId: workspaceContextForParent(parent),
    placedByAccountId: params.accountId,
    createdAt: now,
    updatedAt: now,
  });
  await adjustChildCount(ctx, parent?._id ?? null, 1);
  return (await ctx.db.get(nodeId))!;
}

export async function renameNode(
  ctx: OrgWriteCtx,
  node: OrgNode,
  rawName: unknown,
) {
  await assertNodeWorkspaceWritable(ctx, node);
  const name = assertUserNodeName(rawName);
  if (node.kind === "link")
    throw new Error("Rename the original item; references follow it.");
  const now = Date.now();
  await ctx.db.patch(node._id, { name, updatedAt: now });
  /* One identity (I1): the tree row and the source carry the same name, and
     every reference to it follows. */
  if (node.kind === "workspace" && node.sourceId) {
    const workspaceId = ctx.db.normalizeId("spectraWorkspaces", node.sourceId);
    if (workspaceId)
      await ctx.db.patch(workspaceId, { title: name, updatedAt: now });
  }
  if (node.kind === "work" && node.sourceId) {
    const artifactId = ctx.db.normalizeId("spectraArtifacts", node.sourceId);
    if (artifactId) {
      const artifact = await ctx.db.get(artifactId);
      // A personal placement is its owner's name. Only the artifact owner
      // controls the shared artifact title; a reader may rename their node.
      if (artifact?.ownerAccountId === node.accountId) {
        // A native file's listing name is its own thing; see listingNameForNativeWork.
        const from = artifact.renamedFromTitle ?? artifact.title;
        await ctx.db.patch(artifactId, {
          title: name,
          updatedAt: now,
          ...(artifact.nativeFormat ? {} : { renamedFromTitle: from === name ? undefined : from }),
        });
      }
    }
  }
  if (node.kind === "thread" && node.sourceId) {
    const threadId = ctx.db.normalizeId("spectraThreads", node.sourceId);
    if (threadId)
      await ctx.db.patch(threadId, {
        title: name,
        titleSetByOwner: true,
        updatedAt: now,
        readSchemaVersion: 1,
      });
  }
  for (const link of await findNodesForSource(ctx, "link", node._id))
    if (link.name !== name)
      await ctx.db.patch(link._id, { name, updatedAt: now });
  return (await ctx.db.get(node._id))!;
}

export type MoveTarget = {
  parentId: Id<"orgNodes"> | null;
  /** Insert between these siblings; both omitted = append. */
  beforeSiblingId?: Id<"orgNodes"> | null;
  afterSiblingId?: Id<"orgNodes"> | null;
};

async function resolveInsertionKey(
  ctx: OrgCtx,
  node: OrgNode,
  parentId: Id<"orgNodes"> | null,
  target: MoveTarget,
) {
  if (!target.afterSiblingId && !target.beforeSiblingId)
    return await appendOrderKey(ctx, node.accountId, parentId);
  const siblings = (
    await listChildNodes(ctx, node.accountId, parentId, {
      includeTrashed: true,
    })
  ).filter((row) => row._id !== node._id);
  const keyOf = (id: Id<"orgNodes"> | null | undefined) => {
    if (!id) return null;
    const sibling = siblings.find((row) => row._id === id);
    return sibling ? normalizeOrderKey(sibling.orderKey) : null;
  };
  const afterKey = keyOf(target.afterSiblingId);
  const beforeKey = keyOf(target.beforeSiblingId);
  const ordered = siblings
    .map((row) => normalizeOrderKey(row.orderKey))
    .filter((key): key is string => Boolean(key))
    .sort();
  if (afterKey || beforeKey) {
    /* Derive the missing side from the sibling list so the drop lands exactly
       where the user let go, even if the client sent only one neighbour. */
    const low =
      afterKey ??
      (beforeKey
        ? (ordered.filter((key) => key < beforeKey).pop() ?? null)
        : null);
    const high =
      beforeKey ??
      (afterKey ? (ordered.find((key) => key > afterKey) ?? null) : null);
    if (low && high && low >= high) return between(low, null);
    return between(low, high);
  }
  const last = ordered.pop();
  return last ? nextOrderKey(last) : FIRST_ORDER_KEY;
}

/**
 * I4: a move is one metadata transaction. Content is never touched and open
 * surfaces are never closed; only `parentId`, `orderKey` and the subtree's
 * `workspaceContextId` change.
 */
export async function moveNode(
  ctx: OrgWriteCtx,
  node: OrgNode,
  target: MoveTarget,
  options?: { allowDeletingSourceWorkspace?: boolean },
) {
  const parent =
    target.parentId != null
      ? await requireOwnNode(ctx, target.parentId, node.accountId)
      : null;
  if (!options?.allowDeletingSourceWorkspace)
    await assertNodeWorkspaceWritable(ctx, node);
  await assertParentWorkspaceWritable(ctx, parent);
  assertParentAcceptsChild(parent, node.kind);
  await assertNoCycle(ctx, node._id, parent?._id ?? null);
  if (isContainerKind(node.kind))
    await assertDepthFits(
      ctx,
      parent?._id ?? null,
      (await subtreeHeight(ctx, node)) + 1,
    );

  const orderKey = await resolveInsertionKey(
    ctx,
    node,
    parent?._id ?? null,
    target,
  );
  const context = workspaceContextForParent(parent);
  const oldParentId = node.parentId;
  const nextParentId = parent?._id ?? null;
  await ctx.db.patch(node._id, {
    parentId: nextParentId,
    orderKey,
    updatedAt: Date.now(),
  });
  if (node.deletedAt === undefined && oldParentId !== nextParentId) {
    await adjustChildCount(ctx, oldParentId, -1);
    await adjustChildCount(ctx, nextParentId, 1);
  }
  const moved = (await ctx.db.get(node._id))!;
  await stampSubtreeContext(ctx, moved, context);
  return (await ctx.db.get(node._id))!;
}

/** Soft delete with the whole subtree; one restore undoes it. */
export async function trashNode(ctx: OrgWriteCtx, node: OrgNode) {
  await assertNodeWorkspaceWritable(ctx, node);
  await assertNotGeneralWorkspaceNode(ctx, node, "delete");
  if (node.deletedAt !== undefined) return { trashed: 0, nodeId: node._id };
  const nodes = await subtreeNodes(ctx, node, { includeTrashed: false });
  const now = Date.now();
  let trashed = 0;
  for (const row of nodes) {
    if (row.deletedAt !== undefined) continue;
    /* General survives a parent folder's deletion rather than disappearing
       with it — it is the floor everything else falls back to. */
    if (row._id !== node._id && row.kind === "workspace") {
      const workspaceId = row.sourceId
        ? ctx.db.normalizeId("spectraWorkspaces", row.sourceId)
        : null;
      const workspace = workspaceId ? await ctx.db.get(workspaceId) : null;
      if (workspace && isGeneralWorkspace(workspace)) {
        await ctx.db.patch(row._id, {
          parentId: null,
          orderKey: await appendOrderKey(ctx, row.accountId, null),
          workspaceContextId: workspace._id,
          updatedAt: now,
        });
        await adjustChildCount(ctx, row.parentId, -1);
        continue;
      }
    }
    await ctx.db.patch(row._id, {
      deletedAt: now,
      trashedRootId: node._id,
      isTrashRoot: row._id === node._id ? true : undefined,
      updatedAt: now,
    });
    await adjustChildCount(ctx, row.parentId, -1);
    trashed += 1;
  }
  return { trashed, nodeId: node._id };
}

export async function restoreTrashedNode(ctx: OrgWriteCtx, node: OrgNode) {
  await assertNodeWorkspaceWritable(ctx, node);
  const rows = await ctx.db
    .query("orgNodes")
    .withIndex("by_trashed_root", (q) => q.eq("trashedRootId", node._id))
    .collect();
  const now = Date.now();
  /* If the original parent is gone or still trashed, restore to the root so
     the work is reachable rather than invisibly buried. */
  const parent = node.parentId ? await ctx.db.get(node.parentId) : null;
  const parentUsable = Boolean(parent && parent.deletedAt === undefined);
  if (parentUsable) await assertParentWorkspaceWritable(ctx, parent);
  let restored = 0;
  for (const row of rows) {
    const patch: Record<string, unknown> = {
      deletedAt: undefined,
      trashedRootId: undefined,
      isTrashRoot: undefined,
      updatedAt: now,
    };
    if (row._id === node._id && !parentUsable && node.parentId) {
      patch.parentId = null;
      patch.orderKey = await appendOrderKey(ctx, node.accountId, null);
    }
    const restoredParentId = Object.prototype.hasOwnProperty.call(
      patch,
      "parentId",
    )
      ? (patch.parentId as Id<"orgNodes"> | null)
      : row.parentId;
    await ctx.db.patch(row._id, patch);
    await adjustChildCount(ctx, restoredParentId, 1);
    restored += 1;
  }
  const refreshed = (await ctx.db.get(node._id))!;
  await stampSubtreeContext(
    ctx,
    refreshed,
    workspaceContextForParent(
      refreshed.parentId ? await ctx.db.get(refreshed.parentId) : null,
    ),
  );
  return { restored, nodeId: node._id };
}

/**
 * A workspace is going away for good. It organized its contents and never owned
 * them, so everything inside moves to General rather than vanishing with the
 * container. Folders move whole, so the shape a reader built survives. One
 * mutation cannot reparent a crowded class shelf: each move rewrites
 * TableAggregate btrees against the shared 16 MB read budget. Callers repeat
 * until `remaining` is 0, then delete the workspace row.
 */
export const DISSOLVE_CHILD_BATCH = 20;

export async function dissolveWorkspaceNode(
  ctx: OrgWriteCtx,
  workspace: Doc<"spectraWorkspaces">,
  options?: {
    limit?: number;
    preserveWorkspaceNode?: boolean;
    allowDeletingWorkspace?: boolean;
  },
) {
  if (!options?.allowDeletingWorkspace)
    await assertWorkspaceWritable(ctx, workspace._id);
  if (isGeneralWorkspace(workspace))
    throw new Error(
      "General cannot be deleted — it is where work with no other home lives.",
    );
  const node = await findPrimaryNode(
    ctx,
    workspace.ownerAccountId,
    "workspace",
    workspace._id,
  );
  if (!node) return { moved: 0, purged: 0, remaining: 0 };
  const general = await ensureGeneralNode(
    ctx,
    workspace.ownerAccountId,
    workspace.schoolId,
  );
  const children = await listChildNodes(ctx, node.accountId, node._id, {
    includeTrashed: true,
    limit:
      Math.max(
        1,
        Math.min(options?.limit ?? DISSOLVE_CHILD_BATCH, DISSOLVE_CHILD_BATCH),
      ) + 1,
  });
  const limit = Math.max(
    1,
    Math.min(options?.limit ?? DISSOLVE_CHILD_BATCH, DISSOLVE_CHILD_BATCH),
  );
  const batch = children.slice(0, limit);
  for (const child of batch) {
    if (child.deletedAt === undefined) {
      await moveNode(
        ctx,
        child,
        { parentId: general.node._id },
        { allowDeletingSourceWorkspace: options?.allowDeletingWorkspace === true },
      );
      continue;
    }
    /* A trashed child keeps its own restore root, so re-parent it directly:
       restoring later must land in General, not at a node that is gone. */
    await ctx.db.patch(child._id, {
      parentId: general.node._id,
      orderKey: await appendOrderKey(ctx, child.accountId, general.node._id),
      updatedAt: Date.now(),
    });
    await stampSubtreeContext(
      ctx,
      (await ctx.db.get(child._id))!,
      general.workspace._id,
    );
  }
  const remaining = children.length > batch.length ? 1 : 0;
  if (remaining > 0) return { moved: batch.length, purged: 0, remaining };
  const purged = options?.preserveWorkspaceNode
    ? 0
    : await purgeSourceNodes(ctx, "workspace", workspace._id);
  return { moved: children.length, purged, remaining: 0 };
}

/**
 * Remove one account's placement of a source. Used when access is revoked: the
 * recipient's own filing of a shared artifact goes with the access, while the
 * owner's placement — and everybody else's — is untouched.
 */
export async function purgeAccountSourceNodes(
  ctx: OrgWriteCtx,
  accountId: Id<"accounts">,
  kind: OrgNodeKind,
  sourceId: string,
  options?: { keepProjecting?: boolean },
) {
  const nodes = await ctx.db
    .query("orgNodes")
    .withIndex("by_account_kind_source", (q) =>
      q.eq("accountId", accountId).eq("kind", kind).eq("sourceId", sourceId),
    )
    .collect();
  let purged = 0;
  for (const node of nodes) {
    if (options?.keepProjecting && node.accessProjection === true) continue;
    await purgeNode(ctx, node);
    purged += 1;
  }
  return purged;
}

/** Retain embed identity while removing any live source/container reference. */
export async function tombstoneArtifactEmbeds(
  ctx: OrgWriteCtx,
  artifactId: Id<"spectraArtifacts">,
  resolvedByAccountId: Id<"accounts">,
  now = Date.now(),
) {
  const [sourceEmbeds, containerEmbeds] = await Promise.all([
    ctx.db
      .query("artifactEmbeds")
      .withIndex("by_source", (q) => q.eq("sourceArtifactId", artifactId))
      .take(40),
    ctx.db
      .query("artifactEmbeds")
      .withIndex("by_container", (q) =>
        q.eq("containerType", "artifact").eq("containerId", String(artifactId)),
      )
      .take(40),
  ]);
  const containerEmbedIds = new Set(containerEmbeds.map((embed) => embed._id));
  const embedRows = [
    ...new Map(
      [...sourceEmbeds, ...containerEmbeds].map((embed) => [embed._id, embed]),
    ).values(),
  ];
  for (const embed of embedRows) {
    const isContainerRemoval = containerEmbedIds.has(embed._id);
    await ctx.db.patch(embed._id, {
      ...(sourceEmbeds.some((sourceEmbed) => sourceEmbed._id === embed._id)
        ? {
            sourceUnavailableAt: embed.sourceUnavailableAt ?? now,
            // A persisted pinned placement remains the owner of its version
            // even when the source is deleted before the editor's canonical
            // confirmation arrives. Do not let the old provisional-expiry
            // timer erase that lifetime anchor.
            placementExpiresAt: undefined,
          }
        : {}),
      ...(isContainerRemoval
        ? { removedAt: embed.removedAt ?? now }
        : {}),
      updatedAt: now,
      ...(isContainerRemoval ? { placementState: "removed" as const } : {}),
    });
  }
  const pendingEmbedRequests = [] as Array<Doc<"artifactAccessRequests">>;
  for (const embed of embedRows) {
    const rows = await ctx.db
      .query("artifactAccessRequests")
      .withIndex("by_embed_status", (q) =>
        q.eq("embedId", embed._id).eq("status", "pending"),
      )
      .take(40);
    pendingEmbedRequests.push(...rows);
  }
  const pendingSourceRequests = await ctx.db
    .query("artifactAccessRequests")
    .withIndex("by_source_status", (q) =>
      q.eq("sourceArtifactId", artifactId).eq("status", "pending"),
    )
    .take(40);
  const requests = [
    ...new Map(
      [...pendingEmbedRequests, ...pendingSourceRequests].map((request) => [
        request._id,
        request,
      ]),
    ).values(),
  ];
  for (const request of requests) {
    await ctx.db.patch(request._id, {
      status: "cancelled",
      updatedAt: now,
      resolvedAt: now,
      resolvedByAccountId,
    });
  }
  return { embedCount: embedRows.length, requestCount: requests.length };
}

/** Remove a source's nodes outright — for a real artifact/thread deletion. */
export async function purgeSourceNodes(
  ctx: OrgWriteCtx,
  kind: OrgNodeKind,
  sourceId: string,
) {
  const nodes = await findNodesForSource(ctx, kind, sourceId);
  for (const node of nodes) await purgeNode(ctx, node);
  return nodes.length;
}

/** Delete one node and the links that target it, keeping live child counts.
 * Returns the number of rows deleted. */
export async function purgeNode(ctx: OrgWriteCtx, node: OrgNode) {
  const links = await findNodesForSource(ctx, "link", node._id);
  for (const link of links) {
    await ctx.db.delete(link._id);
    if (link.deletedAt === undefined)
      await adjustChildCount(ctx, link.parentId, -1);
  }
  await ctx.db.delete(node._id);
  if (node.deletedAt === undefined)
    await adjustChildCount(ctx, node.parentId, -1);
  return links.length + 1;
}

const TRASH_PURGE_BATCH = 200;
const INDEX_DRAIN_PAGE = 100;

export const TRASH_PURGE_EMPTY =
  "Select something in Trash to delete forever.";
export const TRASH_PURGE_TOO_MANY =
  "Delete at most 200 items at a time.";
export const TRASH_PURGE_NOT_TRASHED =
  "Only items in Trash can be deleted forever.";
export const TRASH_PURGE_GENERAL =
  "General cannot be deleted. It is where work with no other home lives.";
export const TRASH_PURGE_TIMETABLE =
  "Your Timetable stays in General and cannot be deleted.";

export type TrashedPurgeItem = {
  nodeId: Id<"orgNodes">;
  kind: OrgNodeKind;
  name: string;
  sourceId?: string;
};

export type TrashedPurgeResult = {
  purged: TrashedPurgeItem[];
};

function isProtectedTimetableArtifact(artifact: Doc<"spectraArtifacts">) {
  if (artifact.blueprintKey !== "timetable") return false;
  const tags = artifact.tags ?? [];
  return (
    tags.includes("system-timetable") ||
    tags.includes("managebac") ||
    artifact.createdFrom?.contextSummary ===
      "Automatic ManageBac timetable bootstrap" ||
    artifact.createdFrom?.contextSummary === "Personal Spectra timetable"
  );
}

/**
 * Refuse the whole mixed selection before any write. Partial silent success is
 * the forbidden third option (P6.I4).
 */
export async function refuseTrashedPurge(
  ctx: OrgCtx,
  roots: OrgNode[],
): Promise<string | null> {
  if (roots.length === 0) return TRASH_PURGE_EMPTY;
  if (roots.length > TRASH_PURGE_BATCH) return TRASH_PURGE_TOO_MANY;
  for (const node of roots) {
    if (node.deletedAt === undefined) return TRASH_PURGE_NOT_TRASHED;
    const subtree = await subtreeNodes(ctx, node, { includeTrashed: true });
    for (const row of subtree) {
      if (row.kind === "workspace" && row.sourceId) {
        const workspaceId = ctx.db.normalizeId(
          "spectraWorkspaces",
          row.sourceId,
        );
        const workspace = workspaceId ? await ctx.db.get(workspaceId) : null;
        if (workspace && isGeneralWorkspace(workspace))
          return TRASH_PURGE_GENERAL;
      }
      if (row.kind === "work" && row.sourceId) {
        const artifactId = ctx.db.normalizeId("spectraArtifacts", row.sourceId);
        const artifact = artifactId ? await ctx.db.get(artifactId) : null;
        if (artifact && isProtectedTimetableArtifact(artifact))
          return TRASH_PURGE_TIMETABLE;
      }
    }
  }
  return null;
}

async function drainIndexPage<T extends { _id: string }>(
  takePage: () => Promise<T[]>,
  visit: (row: T) => Promise<void>,
) {
  for (;;) {
    const page = await takePage();
    if (page.length === 0) return;
    for (const row of page) await visit(row);
  }
}

async function deleteTrashedOrgNode(ctx: OrgWriteCtx, node: OrgNode) {
  if (!(await ctx.db.get(node._id))) return;
  await ctx.db.delete(node._id);
  if (node.deletedAt === undefined)
    await adjustChildCount(ctx, node.parentId, -1);
}

async function purgeOwnedThread(
  ctx: OrgWriteCtx,
  thread: Doc<"spectraThreads">,
) {
  await drainIndexPage(
    () =>
      ctx.db
        .query("spectraMessages")
        .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
        .take(INDEX_DRAIN_PAGE),
    (row) => ctx.db.delete(row._id),
  );
  await purgeSourceNodes(ctx, "thread", thread._id);
  if (await ctx.db.get(thread._id)) await ctx.db.delete(thread._id);
}

async function purgeOwnedWorkRecord(
  ctx: OrgWriteCtx,
  artifact: Doc<"spectraArtifacts">,
) {
  const now = Date.now();
  // The deletion coordinator owns tombstoning, placement traversal, and all
  // descendants. Trash purge must enqueue the same durable job rather than
  // draining source nodes synchronously in this front-door mutation.
  if (artifact.status !== "deleted")
    await ctx.db.patch(artifact._id, {
      status: "deleted",
      // The coordinator assigns the generation together with its job. Do not
      // advance the tombstone here or the older Trash path creates a job whose
      // generation can never pass the worker's claim check.
      deletionRequestedAt: now,
      updatedAt: now,
    });
  await tombstoneArtifactEmbeds(ctx, artifact._id, artifact.ownerAccountId, now);
  // Keep the deleted owner row as the durable authorization/retry anchor.
  // The coordinator removes descendants and releases bytes only after proof.
  const existing = await ctx.db
    .query("artifactDeletionJobs")
    .withIndex("by_artifact_generation", (q) => q.eq("artifactId", artifact._id))
    .order("desc")
    .first();
  if (!existing || existing.phase === "complete" || existing.phase === "failed") {
    const generation = Math.max(existing?.generation ?? 0, artifact.deletionGeneration ?? 0) + 1;
    await ctx.db.patch(artifact._id, { deletionGeneration: generation, updatedAt: now });
    const jobId = await ctx.db.insert("artifactDeletionJobs", {
      artifactId: artifact._id,
      ownerAccountId: artifact.ownerAccountId,
      schoolId: artifact.schoolId,
      generation,
      phase: "placements",
      cursor: undefined,
      deletedRows: 0,
      releasedBytes: 0,
      createdAt: now,
      updatedAt: now,
    });
    await queueDeletionDispatch(ctx, jobId, generation);
  }
}

/**
 * Permanently remove a mixed Trash selection. Callers must refuse first.
 * Convex mutations are one transaction, so a throw after this starts rolls
 * the whole batch back.
 */
export async function purgeTrashedNodes(
  ctx: OrgWriteCtx,
  roots: OrgNode[],
): Promise<TrashedPurgeResult> {
  const expanded = new Map<string, OrgNode>();
  for (const root of roots) {
    const subtree = await subtreeNodes(ctx, root, { includeTrashed: true });
    for (const row of subtree) expanded.set(row._id, row);
  }
  const items = [...expanded.values()];
  for (const node of items) await assertNodeWorkspaceWritable(ctx, node);
  const requested = new Map(
    roots.map((root) => [
      root._id,
      {
        nodeId: root._id,
        kind: root.kind,
        name: root.name,
        sourceId: root.sourceId,
      } satisfies TrashedPurgeItem,
    ]),
  );

  for (const node of items) {
    if (node.kind !== "work" || !node.sourceId) continue;
    const artifactId = ctx.db.normalizeId("spectraArtifacts", node.sourceId);
    const artifact = artifactId ? await ctx.db.get(artifactId) : null;
    if (!artifact) {
      await purgeSourceNodes(ctx, "work", node.sourceId);
      continue;
    }
    if (artifact.ownerAccountId === node.accountId)
      await purgeOwnedWorkRecord(ctx, artifact);
    else
      await purgeAccountSourceNodes(
        ctx,
        node.accountId,
        "work",
        artifact._id,
      );
  }

  for (const node of items) {
    if (node.kind !== "thread" || !node.sourceId) continue;
    const threadId = ctx.db.normalizeId("spectraThreads", node.sourceId);
    const thread = threadId ? await ctx.db.get(threadId) : null;
    if (!thread) {
      await purgeSourceNodes(ctx, "thread", node.sourceId);
      continue;
    }
    if (thread.ownerAccountId === node.accountId)
      await purgeOwnedThread(ctx, thread);
    else
      await purgeAccountSourceNodes(
        ctx,
        node.accountId,
        "thread",
        thread._id,
      );
  }

  for (const node of items) {
    if (node.kind !== "workspace" || !node.sourceId) continue;
    const workspaceId = ctx.db.normalizeId("spectraWorkspaces", node.sourceId);
    const workspace = workspaceId ? await ctx.db.get(workspaceId) : null;
    if (workspace) await dissolveWorkspaceNode(ctx, workspace);
    else await purgeSourceNodes(ctx, "workspace", node.sourceId);
  }

  for (const node of items) {
    if (node.kind === "work") {
      // A peer's placement is removed here; the owner coordinator separately
      // traverses every placement for the tombstoned artifact.
      await deleteTrashedOrgNode(ctx, node);
      continue;
    }
    if (node.kind === "thread" || node.kind === "workspace")
      continue;
    await deleteTrashedOrgNode(ctx, node);
  }

  return { purged: [...requested.values()] };
}

/* ------------------------------------------------------- placement reads */

/**
 * A work's or thread's placement as the product talks about it: which workspace
 * holds it, and the tree node that *is* that placement. Derived from the tree,
 * so there is one source of truth for "where does this live".
 */
export type PlacementProjection = {
  workspaceId: Id<"spectraWorkspaces">;
  workspaceTitle: string;
  nodeId: Id<"orgNodes">;
  pinned: boolean;
};

function projectionFor(
  node: OrgNode,
  workspace: Doc<"spectraWorkspaces">,
): PlacementProjection {
  return {
    workspaceId: workspace._id,
    workspaceTitle: workspace.title,
    nodeId: node._id,
    pinned: node.pinned === true,
  };
}

/**
 * Placements of one source, limited to workspaces the caller may see. A shared
 * work placed in someone else's workspace lives in *their* tree, so the lookup
 * is global by (kind, sourceId) and then filtered by visibility.
 */
export async function placementsForSource(
  ctx: OrgCtx,
  kind: "work" | "thread",
  sourceId: string,
  visibleWorkspaces: Map<string, Doc<"spectraWorkspaces">>,
) {
  const nodes = await findNodesForSource(ctx, kind, sourceId);
  const placements: PlacementProjection[] = [];
  for (const node of nodes) {
    if (node.deletedAt !== undefined) continue;
    if (!node.workspaceContextId) continue;
    const workspace = visibleWorkspaces.get(node.workspaceContextId);
    if (!workspace || workspace.status !== "active") continue;
    placements.push(projectionFor(node, workspace));
  }
  return placements;
}

/**
 * Placements for many sources at once, keyed by source id — one pass per
 * workspace instead of one query per work, which is what a Library list needs.
 */
export async function placementsByWorkspaceScan(
  ctx: OrgCtx,
  workspaces: Doc<"spectraWorkspaces">[],
  kind: "work" | "thread",
) {
  const bySource = new Map<string, PlacementProjection[]>();
  for (const workspace of workspaces) {
    if (workspace.status !== "active") continue;
    const nodes = await ctx.db
      .query("orgNodes")
      .withIndex("by_workspace_context", (q) =>
        q.eq("workspaceContextId", workspace._id),
      )
      .collect();
    for (const node of nodes) {
      if (node.kind !== kind || node.deletedAt !== undefined) continue;
      if (!node.sourceId) continue;
      bySource.set(node.sourceId, [
        ...(bySource.get(node.sourceId) ?? []),
        projectionFor(node, workspace),
      ]);
    }
  }
  return bySource;
}

/**
 * The status the Library shows for a work. With the tree in place every live
 * work has a placement, so `inbox` only ever describes a work whose placement
 * is in a workspace the caller cannot see.
 */
export function placementStatusFor(
  placements: PlacementProjection[],
  ownership: "owned" | "shared",
) {
  if (placements.length > 0) return "workspace" as const;
  return ownership === "shared" ? ("shared" as const) : ("inbox" as const);
}
