import { validateContentAdoption } from "./collaborationDurablePayload";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthenticatedActor } from "./identityShared";
import { requireActorArtifactCapability } from "./authorityShared";
import { canReadPinnedContent } from "./retainedContentAccess";
import { isDurableContentRef } from "../shared/durable-content";
import { contentDependencyValidator, resolveContentDependencies } from "./durableContentDependencies";
import { reconcileDurablePayloadOwners } from "./durablePayloadOwnership";
import { normalizeSha256 } from "../shared/intake-integrity";
import { MAX_DURABLE_PAYLOAD_BYTES } from "../shared/durable-content";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { PAYLOAD_RELEASE_GRACE_MS } from "../shared/replica-truth";

async function authority(ctx: QueryCtx | MutationCtx, artifactId: Id<"spectraArtifacts">, modify: boolean) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
  await requireActorArtifactCapability(ctx, actor, artifactId, modify ? "modify" : "read");
  const policy = await ctx.db.query("resourcePolicies").withIndex("by_resource", q =>
    q.eq("resourceType", "artifact").eq("resourceId", artifactId)).unique();
  return { actor, policyVersion: policy?.version ?? 0 };
}

export const issueUpload = mutation({
  args: { artifactId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const { policyVersion } = await authority(ctx, args.artifactId, true);
    return { url: await ctx.storage.generateUploadUrl(), policyVersion };
  },
});

export const checkpointHead = query({
  args: { artifactId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const { actor, policyVersion } = await authority(ctx, args.artifactId, true);
    const room = await ctx.db.query("collaborationRooms").withIndex("by_artifact_partition", q => q.eq("artifactId", args.artifactId).eq("partitionKey", "root")).unique();
    if (!room || room.status === "closed" || (room.lastProjectionSequence ?? 0) >= room.nextSequence - 1) return null;
    return { artifactId: args.artifactId, accountId: actor.accountId, policyVersion, partitionKey: "root", roomId: room._id, schemaVersion: room.schemaVersion };
  },
});

export const adopt = mutation({
  args: { artifactId: v.id("spectraArtifacts"), storageId: v.id("_storage"), digest: v.string(), byteLength: v.number(), policyVersion: v.number(), dependencies: v.optional(contentDependencyValidator) },
  handler: async (ctx, args) => {
    const { actor, policyVersion } = await authority(ctx, args.artifactId, true);
    if (policyVersion !== args.policyVersion) throw new Error("COLLABORATION_GATEWAY_FORBIDDEN");
    const meta = await ctx.db.system.get(args.storageId);
    if (!/^[a-f0-9]{64}$/.test(args.digest) || !meta || meta.size !== args.byteLength ||
      normalizeSha256(meta.sha256) !== args.digest || args.byteLength <= 0 || args.byteLength > MAX_DURABLE_PAYLOAD_BYTES)
      throw new Error("COLLABORATION_DURABLE_PAYLOAD_INTEGRITY");
    const existing = await ctx.db.query("collaborationDurablePayloads").withIndex("by_artifact_digest", q =>
      q.eq("artifactId", args.artifactId).eq("digest", args.digest)).filter(q => q.and(
        q.eq(q.field("status"), "active"), q.eq(q.field("kind"), "projection"),
        q.eq(q.field("accountId"), actor.accountId), q.eq(q.field("policyVersion"), policyVersion))).first();
    if (existing) {
      if (existing.storageId !== args.storageId) await ctx.storage.delete(args.storageId);
      return { payloadRef: String(existing._id), dependencies: existing.dependencies };
    }
    const dependencies = await resolveContentDependencies(ctx, args.artifactId, args.dependencies);
    const id = await ctx.db.insert("collaborationDurablePayloads", {
      ...args, accountId: actor.accountId, kind: "projection", manifestVersion: 1,
      dependencies,
      mediaType: "application/vnd.spectra.content+json", status: "active", createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(PAYLOAD_RELEASE_GRACE_MS, internal.durablePayloadOwnership.release, { payloadRef: String(id) });
    await reconcileDurablePayloadOwners(ctx, "collaborationDurablePayloads", String(id), { dependencies });
    return { payloadRef: String(id), dependencies };
  },
});

export const read = query({
  args: { artifactId: v.id("spectraArtifacts"), payloadRef: v.id("collaborationDurablePayloads"), digest: v.string() },
  handler: async (ctx, args) => {
    try { await authority(ctx, args.artifactId, false); }
    catch (error) {
      const actor = await getAuthenticatedActor(ctx);
      if (!actor) throw error;
      const contains = (value: unknown): boolean => {
        if (isDurableContentRef(value)) return value.spectraContentRef.payloadRef === args.payloadRef && value.spectraContentRef.digest === args.digest;
        return Boolean(value && typeof value === "object" && Object.values(value).some(contains));
      };
      const retained = await canReadPinnedContent(ctx, actor, args.artifactId, contains);
      if (!retained) throw error;
    }
    const row = await ctx.db.get(args.payloadRef);
    if (!row || row.artifactId !== args.artifactId || row.kind !== "projection" || row.status !== "active" || row.digest !== args.digest)
      throw new Error("COLLABORATION_DURABLE_PAYLOAD_INVALID");
    return { url: await ctx.storage.getUrl(row.storageId), digest: row.digest, byteLength: row.byteLength };
  },
});

export const validateWrite = query({
  args: {artifactId:v.id("spectraArtifacts"), content:v.any()},
  handler: async (ctx,args) => {
    const {actor} = await authority(ctx,args.artifactId,true);
    await validateContentAdoption(ctx,args.artifactId,actor.accountId,args.content);
    return true;
  },
});
