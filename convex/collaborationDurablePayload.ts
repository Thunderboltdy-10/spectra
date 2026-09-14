import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

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
  },
  handler: async (ctx, args) => {
    assertDigest(args.digest);
    if (!Number.isSafeInteger(args.byteLength) || args.byteLength <= 0)
      throw new Error("DURABLE_PAYLOAD_BYTES_INVALID");
    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata || metadata.size !== args.byteLength)
      throw new Error("DURABLE_PAYLOAD_SIZE_MISMATCH");
    const existing = await ctx.db
      .query("collaborationDurablePayloads")
      .withIndex("by_digest", (q) => q.eq("digest", args.digest))
      .first();
    if (existing && existing.status === "active") {
      if (existing.storageId !== args.storageId)
        await ctx.storage.delete(args.storageId);
      return { payloadRef: String(existing._id), deduplicated: true };
    }
    const id = await ctx.db.insert("collaborationDurablePayloads", {
      artifactId: args.artifactId,
      accountId: args.accountId,
      kind: args.kind,
      digest: args.digest,
      storageId: args.storageId,
      byteLength: args.byteLength,
      mediaType: args.mediaType.slice(0, 120),
      manifestVersion: args.manifestVersion,
      status: "active",
      createdAt: Date.now(),
    });
    return { payloadRef: String(id), deduplicated: false };
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
      digest: row.digest,
      byteLength: row.byteLength,
      mediaType: row.mediaType,
      kind: row.kind,
      storageId: row.storageId,
    };
  },
});
