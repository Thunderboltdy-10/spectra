import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { recordMeterEvent } from "./metering";
import { loadVersionAfter } from "./artifactSnapshots";

const PAGE_SIZE = 40;
const CURSOR_VERSION = "d01:v2";
type IntakeCursor = { version: string; family: "assets" | "imports"; cursor: string | null };

function decodeCursor(cursor: string | null): IntakeCursor {
  if (!cursor) return { version: CURSOR_VERSION, family: "assets", cursor: null };
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as IntakeCursor;
    if (parsed.version !== CURSOR_VERSION || !["assets", "imports"].includes(parsed.family) || (parsed.cursor !== null && typeof parsed.cursor !== "string")) throw new Error();
    return parsed;
  } catch { throw new Error("INTAKE_CURSOR_INVALID"); }
}

function encodeCursor(cursor: IntakeCursor) { return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url"); }

async function releaseOnce(ctx: MutationCtx, input: { artifactId: Id<"spectraArtifacts">; ownerAccountId: Id<"accounts">; storageId: Id<"_storage">; bytes: number; family: string; sourceId: string; schoolId?: Id<"schools"> }) {
  const existing = await ctx.db.query("artifactIntakeReleaseReceipts").withIndex("by_storage", (q) => q.eq("storageId", input.storageId)).unique();
  if (existing) return 0;
  // A legacy row is not deletion authority by itself. Only release a storage
  // object when the trusted binding still has matching verified metadata.
  const metadata = await ctx.db.system.get("_storage", input.storageId);
  if (!metadata || metadata.size !== input.bytes) return 0;
  await ctx.storage.delete(input.storageId);
  await ctx.db.insert("artifactIntakeReleaseReceipts", { artifactId: input.artifactId, ownerAccountId: input.ownerAccountId, storageId: input.storageId, bytes: input.bytes, family: input.family, sourceId: input.sourceId, releasedAt: Date.now() });
  if (input.schoolId && input.bytes > 0) await recordMeterEvent(ctx, { schoolId: input.schoolId, accountId: input.ownerAccountId, category: "storage_bytes", quantity: -input.bytes, sourceType: "artifact_intake_release", sourceId: input.sourceId, idempotencyKey: `intake-release:${String(input.storageId)}`, dimensions: { family: input.family }, occurredAt: Date.now() });
  return input.bytes;
}

function containsReference(value: unknown, references: ReadonlySet<string>, depth = 0): boolean {
  if (depth > 10 || value === null || value === undefined) return false;
  if (typeof value === "string") return references.has(value);
  if (Array.isArray(value)) return value.some((entry) => containsReference(entry, references, depth + 1));
  if (typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) => references.has(key) || containsReference(entry, references, depth + 1));
}

async function retainedReference(ctx: MutationCtx, artifactId: Id<"spectraArtifacts">, rowId: string, storageId?: Id<"_storage">) {
  const pinnedVersionIds = new Set<string>();
  const pins = await ctx.db.query("artifactEmbeds").withIndex("by_source", (q) => q.eq("sourceArtifactId", artifactId)).collect();
  for (const pin of pins) if (!pin.removedAt && pin.pinnedVersionId) pinnedVersionIds.add(String(pin.pinnedVersionId));
  if (!pinnedVersionIds.size) return undefined;
  const refs = new Set([rowId, ...(storageId ? [String(storageId)] : [])]);
  const versions = await ctx.db.query("spectraArtifactVersions").withIndex("by_artifact_created", (q) => q.eq("artifactId", artifactId)).collect();
  for (const version of versions) {
    if (!pinnedVersionIds.has(String(version._id))) continue;
    const content = await loadVersionAfter(ctx, version).catch(() => undefined);
    if (containsReference(content, refs)) return `pinned-version:${String(version._id)}`;
  }
  const builds = await ctx.db.query("spectraRuntimeBuilds").withIndex("by_artifact_status", (q) => q.eq("artifactId", artifactId).eq("status", "published")).collect();
  const build = builds.find((candidate) => candidate.artifactVersionId && pinnedVersionIds.has(String(candidate.artifactVersionId)) && candidate.assetIds?.some((assetId) => String(assetId) === rowId));
  if (build) return `native-package:${String(build._id)}`;
  return undefined;
}

async function releaseStorageCandidates(ctx: MutationCtx, input: { artifactId: Id<"spectraArtifacts">; ownerAccountId: Id<"accounts">; schoolId?: Id<"schools">; sourceId: string; family: string; bytes: number; storageIds: Array<Id<"_storage"> | undefined> }) {
  let releasedBytes = 0;
  for (const storageId of [...new Set(input.storageIds.filter((value): value is Id<"_storage"> => Boolean(value)))]) {
    releasedBytes += await releaseOnce(ctx, { ...input, storageId });
  }
  return releasedBytes;
}

async function hasUnreconciledStorage(ctx: MutationCtx, storageIds: Array<Id<"_storage"> | undefined>, bytes: number) {
  for (const storageId of [...new Set(storageIds.filter((value): value is Id<"_storage"> => Boolean(value)))]) {
    const receipt = await ctx.db.query("artifactIntakeReleaseReceipts").withIndex("by_storage", (q) => q.eq("storageId", storageId)).unique();
    if (receipt) continue;
    const metadata = await ctx.db.system.get("_storage", storageId);
    if (!metadata || metadata.size !== bytes) return true;
  }
  return false;
}

export async function releaseArtifactIntakePage(ctx: MutationCtx, args: { artifactId: Id<"spectraArtifacts">; ownerAccountId: Id<"accounts">; cursor: string | null }): Promise<{ cursor: string | null; done: boolean; deletedRows: number; releasedBytes: number }> {
  const artifact = await ctx.db.get(args.artifactId);
  if (!artifact || artifact.ownerAccountId !== args.ownerAccountId || artifact.status !== "deleted") throw new Error("INTAKE_RELEASE_OWNER_TOMBSTONE_REQUIRED");
  const state = decodeCursor(args.cursor);
  let deletedRows = 0;
  let releasedBytes = 0;
  if (state.family === "assets") {
    const result = await ctx.db.query("artifactAssets").withIndex("by_artifact_path", (q) => q.eq("artifactId", args.artifactId)).paginate({ numItems: PAGE_SIZE, cursor: state.cursor });
    for (const row of result.page) {
      const retained = await retainedReference(ctx, args.artifactId, String(row._id), row.storageId ?? row.candidateStorageId);
      if (retained) {
        await ctx.db.patch(row._id, { retentionReason: retained, updatedAt: Date.now() });
        deletedRows += 1;
        continue;
      }
      if (await hasUnreconciledStorage(ctx, [row.storageId, row.candidateStorageId], row.bytes)) {
        await ctx.db.patch(row._id, { retentionReason: "legacy-reconciliation-required", updatedAt: Date.now() });
        deletedRows += 1;
        continue;
      }
      releasedBytes += await releaseStorageCandidates(ctx, { artifactId: args.artifactId, ownerAccountId: args.ownerAccountId, schoolId: artifact.schoolId, sourceId: String(row._id), family: "asset", bytes: row.bytes, storageIds: [row.storageId, row.candidateStorageId] });
      if (row.status !== "revoked" || row.storageId || row.candidateStorageId) await ctx.db.patch(row._id, { status: "revoked", storageId: undefined, candidateStorageId: undefined, retentionReason: undefined, updatedAt: Date.now() });
      deletedRows += 1;
    }
    return result.isDone
      ? { cursor: encodeCursor({ version: CURSOR_VERSION, family: "imports", cursor: null }), done: false, deletedRows, releasedBytes }
      : { cursor: encodeCursor({ version: CURSOR_VERSION, family: "assets", cursor: result.continueCursor }), done: false, deletedRows, releasedBytes };
  }
  const result = await ctx.db.query("artifactImportJobs").withIndex("by_artifact", (q) => q.eq("artifactId", args.artifactId)).paginate({ numItems: PAGE_SIZE, cursor: state.cursor });
  for (const row of result.page) {
    const retained = await retainedReference(ctx, args.artifactId, String(row._id), row.originalStorageId ?? row.candidateStorageId);
    if (retained) {
      await ctx.db.patch(row._id, { retentionReason: retained, updatedAt: Date.now() });
      deletedRows += 1;
      continue;
    }
    if (await hasUnreconciledStorage(ctx, [row.originalStorageId, row.candidateStorageId], row.originalBytes ?? 0)) {
      await ctx.db.patch(row._id, { retentionReason: "legacy-reconciliation-required", updatedAt: Date.now() });
      deletedRows += 1;
      continue;
    }
    releasedBytes += await releaseStorageCandidates(ctx, { artifactId: args.artifactId, ownerAccountId: args.ownerAccountId, schoolId: artifact.schoolId, sourceId: String(row._id), family: "import-original", bytes: row.originalBytes ?? 0, storageIds: [row.originalStorageId, row.candidateStorageId] });
    if (row.originalAssetRef !== "released" || row.originalStorageId || row.candidateStorageId) await ctx.db.patch(row._id, { originalStorageId: undefined, candidateStorageId: undefined, originalAssetRef: "released", retentionReason: undefined, status: row.status === "uploading" ? "failed" : row.status, updatedAt: Date.now() });
    deletedRows += 1;
  }
  return { cursor: result.isDone ? null : encodeCursor({ version: CURSOR_VERSION, family: "imports", cursor: result.continueCursor }), done: result.isDone, deletedRows, releasedBytes };
}

export const releasePageArgs = { artifactId: v.id("spectraArtifacts"), ownerAccountId: v.id("accounts"), cursor: v.union(v.string(), v.null()) };
