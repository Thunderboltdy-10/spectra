import { assertExclusiveDurableStorage, deleteUnboundDurableStorage } from "./durableStorageBindings";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getActorForAccountId } from "./identityShared";
import { evaluateArtifactAccessForActor } from "./authorityShared";
import { normalizeSha256 } from "../shared/intake-integrity";
import { MAX_DURABLE_PAYLOAD_BYTES } from "../shared/durable-content";
import { internal } from "./_generated/api";
import { PAYLOAD_RELEASE_GRACE_MS } from "../shared/replica-truth";
import { isDurableContentRef } from "../shared/durable-content";
import { contentDependencyValidator, resolveContentDependencies } from "./durableContentDependencies";
import { reconcileDurablePayloadOwners } from "./durablePayloadOwnership";

export async function validateContentAdoption(ctx: MutationCtx | QueryCtx, artifactId: Id<"spectraArtifacts">, accountId: Id<"accounts">, value: unknown) {
  if (!isDurableContentRef(value)) return;
  const ref = value.spectraContentRef;
  if (ref.artifactId !== artifactId) throw new Error("COLLABORATION_DURABLE_PAYLOAD_INVALID");
  const policy = await ctx.db.query("resourcePolicies").withIndex("by_resource", q => q.eq("resourceType", "artifact").eq("resourceId", artifactId)).unique();
  const payload = await validateDurablePayload(ctx, { artifactId, accountId, policyVersion: policy?.version ?? 0,
    payloadRef: ref.payloadRef, digest: ref.digest, byteLength: ref.byteLength, kind: "projection" });
  if (JSON.stringify(ref.dependencies) !== JSON.stringify(payload.dependencies)) throw new Error("COLLABORATION_CONTENT_DEPENDENCY_INVALID");
}

export async function requireDurablePayloadAuthority(ctx: QueryCtx | MutationCtx, args: {
  accountId: Id<"accounts">; artifactId: Id<"spectraArtifacts">;
  partitionKey: string; policyVersion: number;
}, modify = false) {
  const actor = await getActorForAccountId(ctx, args.accountId);
  const room = await ctx.db.query("collaborationRooms").withIndex("by_artifact_partition", q =>
    q.eq("artifactId", args.artifactId).eq("partitionKey", args.partitionKey)).unique();
  if (!actor || !room || room.status === "closed") throw new Error("COLLABORATION_GATEWAY_FORBIDDEN");
  const decision = await evaluateArtifactAccessForActor(ctx, actor, args.artifactId);
  const loaded = "loaded" in decision ? decision.loaded : null;
  const policy = await ctx.db.query("resourcePolicies").withIndex("by_resource", q =>
    q.eq("resourceType", room.typeKey === "agent" ? "agent" : "artifact").eq("resourceId", args.artifactId)).unique();
  if (!decision.allowed || !loaded || loaded.schoolId !== actor.schoolId || !["active", "draft"].includes(loaded.lifecycle) ||
    room.policyVersion !== args.policyVersion || (policy?.version ?? 0) !== args.policyVersion ||
    (modify && loaded.ownerAccountId !== args.accountId && !decision.capabilities.includes("modify")))
    throw new Error("COLLABORATION_GATEWAY_FORBIDDEN");
  return room;
}

export async function validateDurablePayload(ctx: QueryCtx | MutationCtx, args: {
  payloadRef: string; digest: string; artifactId: Id<"spectraArtifacts">;
  kind: "projection" | "yjs-update" | "yjs-snapshot"; byteLength?: number;
  accountId?: Id<"accounts">; policyVersion?: number;
}) {
  const id = ctx.db.normalizeId("collaborationDurablePayloads", args.payloadRef);
  const row = id ? await ctx.db.get(id) : null;
  if (!row || row.status !== "active" || row.artifactId !== args.artifactId ||
    row.kind !== args.kind || row.digest !== args.digest ||
    (args.byteLength !== undefined && row.byteLength !== args.byteLength) ||
    (args.accountId !== undefined && row.accountId !== args.accountId) ||
    (args.policyVersion !== undefined && row.policyVersion !== args.policyVersion))
    throw new Error("COLLABORATION_DURABLE_PAYLOAD_INVALID");
  const metadata = await ctx.db.system.get(row.storageId);
  if (!metadata || metadata.size !== row.byteLength || normalizeSha256(metadata.sha256) !== row.digest)
    throw new Error("COLLABORATION_DURABLE_PAYLOAD_INTEGRITY");
  return row;
}

const kind = v.union(
  v.literal("yjs-update"),
  v.literal("yjs-snapshot"),
  v.literal("projection"),
);

function assertDigest(digest: string) {
  if (!/^[a-f0-9]{64}$/.test(digest))
    throw new Error("DURABLE_PAYLOAD_DIGEST_INVALID");
}

export const put = internalMutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    accountId: v.id("accounts"),
    kind,
    digest: v.string(),
    storageId: v.id("_storage"),
    byteLength: v.number(),
    mediaType: v.string(),
    manifestVersion: v.number(),
    partitionKey: v.string(),
    policyVersion: v.number(),
    dependencies: v.optional(contentDependencyValidator),
  },
  handler: async (ctx, args) => {
    assertDigest(args.digest);
    await requireDurablePayloadAuthority(ctx, args, true);
    if (args.manifestVersion !== 1 || !Number.isSafeInteger(args.byteLength) || args.byteLength <= 0 || args.byteLength > MAX_DURABLE_PAYLOAD_BYTES)
      throw new Error("DURABLE_PAYLOAD_BYTES_INVALID");
    await assertExclusiveDurableStorage(ctx, args.storageId, args.artifactId, args.accountId);
    const existing = await ctx.db
      .query("collaborationDurablePayloads")
      .withIndex("by_artifact_digest", (q) => q.eq("artifactId", args.artifactId).eq("digest", args.digest))
      .filter(q => q.and(q.eq(q.field("accountId"), args.accountId), q.eq(q.field("policyVersion"), args.policyVersion), q.eq(q.field("kind"), args.kind), q.eq(q.field("status"), "active")))
      .first();
    if (existing && existing.status === "active") {
      await validateDurablePayload(ctx, {...args, payloadRef: String(existing._id)});
      if (existing.storageId !== args.storageId)
        await deleteUnboundDurableStorage(ctx, args.storageId);
      return { payloadRef: String(existing._id), dependencies: existing.dependencies, deduplicated: true };
    }
    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata || metadata.size !== args.byteLength || normalizeSha256(metadata.sha256) !== args.digest)
      throw new Error("DURABLE_PAYLOAD_SIZE_MISMATCH");
    const dependencies = args.kind === "projection" ? await resolveContentDependencies(ctx, args.artifactId, args.dependencies) : undefined;
    const id = await ctx.db.insert("collaborationDurablePayloads", {
      artifactId: args.artifactId,
      accountId: args.accountId,
      kind: args.kind,
      digest: args.digest,
      storageId: args.storageId,
      byteLength: args.byteLength,
      mediaType: args.mediaType.slice(0, 120),
      manifestVersion: args.manifestVersion,
      policyVersion: args.policyVersion,
      dependencies,
      status: "active",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(PAYLOAD_RELEASE_GRACE_MS, internal.durablePayloadOwnership.release, { payloadRef: String(id) });
    await reconcileDurablePayloadOwners(ctx, "collaborationDurablePayloads", String(id), { dependencies });
    return { payloadRef: String(id), dependencies, deduplicated: false };
  },
});

export const issueUpload = internalMutation({
  args: { accountId: v.id("accounts"), artifactId: v.id("spectraArtifacts"), partitionKey: v.string(), policyVersion: v.number() },
  handler: async (ctx, args) => {
    await requireDurablePayloadAuthority(ctx, args, true);
    return ctx.storage.generateUploadUrl();
  },
});

export const getMeta = internalQuery({
  args: { payloadRef: v.string(), digest: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId(
      "collaborationDurablePayloads",
      args.payloadRef,
    );
    if (!id) return null;
    const row = await ctx.db.get(id);
    if (!row || row.status !== "active") return null;
    if (args.digest && row.digest !== args.digest) return null;
    return {
      payloadRef: String(row._id),
      artifactId: row.artifactId,
      digest: row.digest,
      byteLength: row.byteLength,
      mediaType: row.mediaType,
      kind: row.kind,
      storageId: row.storageId,
    };
  },
});
