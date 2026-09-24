import { storageHasOtherBinding } from "./durableStorageBindings";
import { decodeBase64Url, encodeBase64Url } from "./artifactDeletionScheduling";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { recordMeterEvent } from "./metering";
import { loadVersionAfter } from "./artifactSnapshots";
import { isSurvivingPinnedEmbed } from "./artifactEmbedOwnership";
import { normalizeMediaType, normalizeSha256 } from "../shared/intake-integrity";

const PAGE_SIZE = 40;
const CURSOR_VERSION = "d01:v2";
export type IntakeCursor = { version: string; family: "assets" | "imports"; cursor: string | null };

export function decodeIntakeCursor(cursor: string | null): IntakeCursor {
  if (!cursor) return { version: CURSOR_VERSION, family: "assets", cursor: null };
  try {
    const parsed = JSON.parse(decodeBase64Url(cursor)) as IntakeCursor;
    if (parsed.version !== CURSOR_VERSION || !["assets", "imports"].includes(parsed.family) || (parsed.cursor !== null && typeof parsed.cursor !== "string")) throw new Error();
    return parsed;
  } catch { throw new Error("INTAKE_CURSOR_INVALID"); }
}

export function encodeIntakeCursor(cursor: IntakeCursor) {
  return encodeBase64Url(JSON.stringify(cursor));
}

type StorageExpectation = { bytes: number; sha256?: string; mediaType?: string };

function storageMatches(
  metadata: { size: number; sha256?: string; contentType?: string } | null,
  expected: StorageExpectation,
) {
  if (!metadata || metadata.size !== expected.bytes) return false;
  if (!expected.sha256 || normalizeSha256(metadata.sha256) !== normalizeSha256(expected.sha256)) return false;
  if (metadata.contentType && expected.mediaType && normalizeMediaType(metadata.contentType) !== normalizeMediaType(expected.mediaType)) return false;
  return true;
}

async function storageState(ctx: MutationCtx, storageId: Id<"_storage">, expected: StorageExpectation) {
  const receipt = await ctx.db.query("artifactIntakeReleaseReceipts").withIndex("by_storage", (q) => q.eq("storageId", storageId)).unique();
  if (receipt) return "released" as const;
  const metadata = await ctx.db.system.get("_storage", storageId);
  return storageMatches(metadata, expected) ? "safe" as const : "unknown" as const;
}

async function releaseOnce(ctx: MutationCtx, input: { artifactId: Id<"spectraArtifacts">; ownerAccountId: Id<"accounts">; storageId: Id<"_storage">; expected: StorageExpectation; family: string; sourceId: string; schoolId?: Id<"schools"> }) {
  const existing = await ctx.db.query("artifactIntakeReleaseReceipts").withIndex("by_storage", (q) => q.eq("storageId", input.storageId)).unique();
  if (existing) return 0;
  const metadata = await ctx.db.system.get("_storage", input.storageId);
  // The row's trusted storage binding and the verified object facts must agree.
  // Size alone cannot distinguish another owner's same-sized object.
  if (!storageMatches(metadata, input.expected)) return 0;
  if (await storageHasOtherBinding(ctx, input.storageId, {table: input.family === "asset" ? "artifactAssets" : "artifactImportJobs", id: input.sourceId})) return 0;
  await ctx.storage.delete(input.storageId);
  await ctx.db.insert("artifactIntakeReleaseReceipts", { artifactId: input.artifactId, ownerAccountId: input.ownerAccountId, storageId: input.storageId, bytes: input.expected.bytes, family: input.family, sourceId: input.sourceId, releasedAt: Date.now() });
  if (input.schoolId && input.expected.bytes > 0) await recordMeterEvent(ctx, { schoolId: input.schoolId, accountId: input.ownerAccountId, category: "storage_bytes", quantity: -input.expected.bytes, sourceType: "artifact_intake_release", sourceId: input.sourceId, idempotencyKey: `intake-release:${String(input.storageId)}`, dimensions: { family: input.family }, occurredAt: Date.now() });
  return input.expected.bytes;
}

type IntakeRow = { _id: string; storageId?: Id<"_storage">; candidateStorageId?: Id<"_storage">; originalStorageId?: Id<"_storage">; originalBytes?: number; originalSha256?: string; originalMimeType?: string; bytes?: number; sha256?: string; mediaType?: string };

function referenceKeys(row: IntakeRow) {
  const values = [row._id, row.storageId, row.candidateStorageId, row.originalStorageId, row.originalSha256].filter((value): value is string => Boolean(value));
  return new Set(values.flatMap((value) => [value, `asset:${value}`, `storage:${value}`]));
}

/** False means ownership could not be fully inspected, never "unreferenced". */
function collectReferenceValues(value: unknown, result: Set<string>, depth = 0, budget = { remaining: 12_000 }): boolean {
  if (value === null || value === undefined) return true;
  if (depth > 10 || budget.remaining <= 0) return false;
  budget.remaining -= 1;
  if (typeof value === "string") { result.add(value); return true; }
  if (Array.isArray(value)) {
    for (const entry of value) if (!collectReferenceValues(entry, result, depth + 1, budget)) return false;
    return true;
  }
  if (typeof value !== "object") return true;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result.add(key);
    if (!collectReferenceValues(entry, result, depth + 1, budget)) return false;
  }
  return true;
}

/** Build one bounded retention index for the whole intake page. */
async function retainedReferences(ctx: MutationCtx, artifactId: Id<"spectraArtifacts">, rows: IntakeRow[]) {
  const retained = new Map<string, string>();
  const pins = await ctx.db.query("artifactEmbeds").withIndex("by_source", (q) => q.eq("sourceArtifactId", artifactId)).collect();
  const pinnedVersionIds = new Set(pins.filter(isSurvivingPinnedEmbed).flatMap((pin) => pin.pinnedVersionId ? [String(pin.pinnedVersionId)] : []));
  if (!pinnedVersionIds.size) return retained;
  // A source can have many large historical checkpoints. Loading every
  // version/build just to find a handful of pinned owners turns deletion of a
  // large workbook into an unbounded read (and can time out the cleanup page).
  // The pin index is the ownership authority, so fetch only its exact versions
  // and their native builds.
  const pinnedVersionRows = await Promise.all(
    [...pinnedVersionIds].map((value) => {
      const versionId = ctx.db.normalizeId("spectraArtifactVersions", value);
      return versionId ? ctx.db.get(versionId) : null;
    }),
  );
  const versions = pinnedVersionRows.filter(
    (version): version is NonNullable<typeof version> =>
      version?.artifactId === artifactId,
  );
  const builds = (
    await Promise.all(
      versions.map((version) =>
        ctx.db
          .query("spectraRuntimeBuilds")
          .withIndex("by_artifact_version", (q) =>
            q.eq("artifactId", artifactId).eq("artifactVersionId", version._id),
          )
          .collect(),
      ),
    )
  ).flat();
  const rowKeys = rows.map((row) => [row._id, referenceKeys(row)] as const);
  for (const version of versions) {
    const values = new Set<string>();
    let complete = false;
    try {
      complete = collectReferenceValues(await loadVersionAfter(ctx, version), values);
    } catch {
      // An unreadable pinned snapshot is unresolved ownership. Preserve the
      // page's intake bytes until its snapshot is repaired or its pin removed.
    }
    for (const [rowId, keys] of rowKeys) {
      if (!complete || [...keys].some((key) => values.has(key))) {
        retained.set(rowId, `${complete ? "pinned-version" : "pinned-version-unresolved"}:${String(version._id)}`);
      }
    }
  }
  for (const build of builds) {
    if (!build.artifactVersionId || !pinnedVersionIds.has(String(build.artifactVersionId))) continue;
    for (const assetId of build.assetIds ?? []) retained.set(String(assetId), `native-package:${String(build._id)}`);
  }
  return retained;
}

type IntakePageResult = { cursor: string | null; done: boolean; deletedRows: number; retainedRows: number; releasedBytes: number };

export async function releaseArtifactIntakePage(ctx: MutationCtx, args: { artifactId: Id<"spectraArtifacts">; ownerAccountId: Id<"accounts">; cursor: string | null }): Promise<IntakePageResult> {
  const artifact = await ctx.db.get(args.artifactId);
  if (!artifact || artifact.ownerAccountId !== args.ownerAccountId || artifact.status !== "deleted") throw new Error("INTAKE_RELEASE_OWNER_TOMBSTONE_REQUIRED");
  const state = decodeIntakeCursor(args.cursor);
  let deletedRows = 0;
  let retainedRows = 0;
  let releasedBytes = 0;
  if (state.family === "assets") {
    const result = await ctx.db.query("artifactAssets").withIndex("by_artifact_path", (q) => q.eq("artifactId", args.artifactId)).paginate({ numItems: PAGE_SIZE, cursor: state.cursor });
    const retained = await retainedReferences(ctx, args.artifactId, result.page);
    for (const row of result.page) {
      const reason = retained.get(String(row._id));
      if (reason) {
        await ctx.db.patch(row._id, { retentionReason: reason, updatedAt: Date.now() });
        retainedRows += 1;
        continue;
      }
      const candidateUnknown = Boolean(row.candidateStorageId && row.candidateStorageId !== row.storageId);
      const trustedState = row.storageId
        ? await storageState(ctx, row.storageId, { bytes: row.bytes, sha256: row.sha256, mediaType: row.mediaType })
        : row.candidateStorageId
          ? "unknown" as const
          : "released" as const;
      if (trustedState === "unknown") {
        await ctx.db.patch(row._id, { retentionReason: "legacy-reconciliation-required", updatedAt: Date.now() });
        retainedRows += 1;
        continue;
      }
      if (row.storageId && trustedState === "safe") releasedBytes += await releaseOnce(ctx, { artifactId: args.artifactId, ownerAccountId: args.ownerAccountId, schoolId: artifact.schoolId, sourceId: String(row._id), family: "asset", storageId: row.storageId, expected: { bytes: row.bytes, sha256: row.sha256, mediaType: row.mediaType } });
      if (row.status !== "revoked" || row.storageId || (!candidateUnknown && row.candidateStorageId)) await ctx.db.patch(row._id, { status: "revoked", storageId: undefined, ...(candidateUnknown ? {} : { candidateStorageId: undefined }), retentionReason: candidateUnknown ? "legacy-reconciliation-required" : undefined, updatedAt: Date.now() });
      deletedRows += 1;
      if (candidateUnknown) retainedRows += 1;
    }
    return result.isDone
      ? { cursor: encodeIntakeCursor({ version: CURSOR_VERSION, family: "imports", cursor: null }), done: false, deletedRows, retainedRows, releasedBytes }
      : { cursor: encodeIntakeCursor({ version: CURSOR_VERSION, family: "assets", cursor: result.continueCursor }), done: false, deletedRows, retainedRows, releasedBytes };
  }
  const result = await ctx.db.query("artifactImportJobs").withIndex("by_artifact", (q) => q.eq("artifactId", args.artifactId)).paginate({ numItems: PAGE_SIZE, cursor: state.cursor });
  const retained = await retainedReferences(ctx, args.artifactId, result.page);
  for (const row of result.page) {
    const reason = retained.get(String(row._id));
    if (reason) {
      await ctx.db.patch(row._id, { retentionReason: reason, updatedAt: Date.now() });
      retainedRows += 1;
      continue;
    }
    const candidateUnknown = Boolean(row.candidateStorageId && row.candidateStorageId !== row.originalStorageId);
    const expected = { bytes: row.originalBytes ?? 0, sha256: row.originalSha256, mediaType: row.originalMimeType };
    const trustedState = row.originalStorageId
      ? await storageState(ctx, row.originalStorageId, expected)
      : row.candidateStorageId
        ? "unknown" as const
        : "released" as const;
    if (trustedState === "unknown") {
      await ctx.db.patch(row._id, { retentionReason: "legacy-reconciliation-required", updatedAt: Date.now() });
      retainedRows += 1;
      continue;
    }
    if (row.originalStorageId && trustedState === "safe") releasedBytes += await releaseOnce(ctx, { artifactId: args.artifactId, ownerAccountId: args.ownerAccountId, schoolId: artifact.schoolId, sourceId: String(row._id), family: "import-original", storageId: row.originalStorageId, expected });
    if (row.originalAssetRef !== "released" || row.originalStorageId || (!candidateUnknown && row.candidateStorageId)) await ctx.db.patch(row._id, { originalStorageId: undefined, ...(candidateUnknown ? {} : { candidateStorageId: undefined }), originalAssetRef: "released", retentionReason: candidateUnknown ? "legacy-reconciliation-required" : undefined, status: row.status === "uploading" ? "failed" : row.status, updatedAt: Date.now() });
    deletedRows += 1;
    if (candidateUnknown) retainedRows += 1;
  }
  return { cursor: result.isDone ? null : encodeIntakeCursor({ version: CURSOR_VERSION, family: "imports", cursor: result.continueCursor }), done: result.isDone, deletedRows, retainedRows, releasedBytes };
}

export const releasePageArgs = { artifactId: v.id("spectraArtifacts"), ownerAccountId: v.id("accounts"), cursor: v.union(v.string(), v.null()) };
