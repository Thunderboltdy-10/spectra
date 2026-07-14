"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Id } from "./_generated/dataModel";

const operation = v.union(v.literal("authorize"), v.literal("load"), v.literal("append"), v.literal("snapshot"));

function bridgeKey() {
  const value = process.env.SPECTRA_COLLAB_BRIDGE_KEY;
  if (!value || value.length < 32) throw new Error("COLLABORATION_BRIDGE_CONFIG_MISSING");
  return value;
}

function verify(operationName: string, payloadJson: string, timestamp: number, nonce: string, signature: string) {
  if (Math.abs(Date.now() - timestamp) > 30_000) throw new Error("COLLABORATION_BRIDGE_EXPIRED");
  if (payloadJson.length > 1_500_000 || nonce.length < 20 || nonce.length > 100) throw new Error("COLLABORATION_BRIDGE_INVALID");
  const digest = createHash("sha256").update(payloadJson).digest("base64url");
  const canonical = [operationName, timestamp, nonce, digest].join("|");
  const expected = createHmac("sha256", bridgeKey()).update(canonical).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("COLLABORATION_BRIDGE_FORBIDDEN");
}

function objectPayload(value: string) {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("COLLABORATION_BRIDGE_PAYLOAD_INVALID");
  return parsed as Record<string, unknown>;
}

function text(value: unknown, name: string, max = 240) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`COLLABORATION_BRIDGE_${name.toUpperCase()}_INVALID`);
  return value.trim();
}

function integer(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`COLLABORATION_BRIDGE_${name.toUpperCase()}_INVALID`);
  return value;
}

function stringArray(value: unknown, name: string, maxItems = 128) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems || !value.every((entry) => typeof entry === "string" && entry.trim() && entry.length <= 240)) throw new Error(`COLLABORATION_BRIDGE_${name.toUpperCase()}_INVALID`);
  return [...new Set(value.map((entry) => (entry as string).trim()))];
}

export const exchange = action({
  args: { operation, payloadJson: v.string(), timestamp: v.number(), nonce: v.string(), signature: v.string() },
  handler: async (ctx, args): Promise<unknown> => {
    verify(args.operation, args.payloadJson, args.timestamp, args.nonce, args.signature);
    const payload = objectPayload(args.payloadJson);
    const artifactId = text(payload.artifactId, "artifact_id") as Id<"spectraArtifacts">;
    const partitionKey = text(payload.partitionKey, "partition_key", 180);

    if (args.operation === "authorize") {
      return ctx.runQuery(internal.collaborationGatewayStore.authorize, {
        accountId: text(payload.accountId, "account_id") as Id<"accounts">,
        artifactId,
        partitionKey,
        policyVersion: integer(payload.policyVersion, "policy_version"),
      });
    }

    if (args.operation === "load") {
      let afterSequence = 0;
      let snapshot: { throughSequence: number; update: string; stateVector: string; contentHash: string } | null = null;
      const updates: Array<{ sequence: number; update: string }> = [];
      let roomId: string | null = null;
      let schemaVersion = 1;
      let nextSequence = 1;
      for (let page = 0; page < 20; page += 1) {
        const result = await ctx.runQuery(internal.collaborationGatewayStore.load, { artifactId, partitionKey, afterSequence, limit: 500 });
        if (!result) return null;
        roomId = result.roomId;
        schemaVersion = result.schemaVersion;
        nextSequence = result.nextSequence;
        if (!snapshot && result.snapshot) snapshot = { throughSequence: result.snapshot.throughSequence, update: Buffer.from(result.snapshot.update).toString("base64"), stateVector: Buffer.from(result.snapshot.stateVector).toString("base64"), contentHash: result.snapshot.contentHash };
        for (const update of result.updates) updates.push({ sequence: update.sequence, update: Buffer.from(update.update).toString("base64") });
        if (!result.hasMore) break;
        afterSequence = result.updates[result.updates.length - 1]!.sequence;
        if (page === 19) throw new Error("COLLABORATION_BRIDGE_SNAPSHOT_REQUIRED");
      }
      return { roomId, schemaVersion, nextSequence, snapshot, updates };
    }

    if (args.operation === "append") {
      const update = Buffer.from(text(payload.update, "update", 1_400_000), "base64");
      return ctx.runMutation(internal.collaborationGatewayStore.append, {
        accountId: text(payload.accountId, "account_id") as Id<"accounts">,
        artifactId,
        partitionKey,
        clientId: text(payload.clientId, "client_id", 180),
        policyVersion: integer(payload.policyVersion, "policy_version"),
        idempotencyKey: text(payload.idempotencyKey, "idempotency_key", 180),
        update: update.buffer.slice(update.byteOffset, update.byteOffset + update.byteLength),
        baseStateVectorHash: text(payload.baseStateVectorHash, "base_state_vector_hash", 180),
        stateVectorHash: text(payload.stateVectorHash, "state_vector_hash", 180),
        regionIds: stringArray(payload.regionIds, "region_ids"),
        projectionJson: payload.projectionJson === null || payload.projectionJson === undefined
          ? undefined
          : text(payload.projectionJson, "projection", 900_000),
        projectionHash: payload.projectionHash === null || payload.projectionHash === undefined
          ? undefined
          : text(payload.projectionHash, "projection_hash", 180),
      });
    }

    const roomId = text(payload.roomId, "room_id") as Id<"collaborationRooms">;
    const update = Buffer.from(text(payload.update, "update", 1_400_000), "base64");
    const stateVector = Buffer.from(text(payload.stateVector, "state_vector", 1_400_000), "base64");
    const snapshotId = await ctx.runMutation(internal.collaboration.storeSnapshot, {
      roomId,
      throughSequence: integer(payload.throughSequence, "through_sequence"),
      update: update.buffer.slice(update.byteOffset, update.byteOffset + update.byteLength),
      stateVector: stateVector.buffer.slice(stateVector.byteOffset, stateVector.byteOffset + stateVector.byteLength),
      contentHash: text(payload.contentHash, "content_hash", 180),
      schemaVersion: Math.max(1, integer(payload.schemaVersion, "schema_version")),
      createdBy: "compactor",
    });
    return ctx.runMutation(internal.collaboration.verifySnapshot, { snapshotId });
  },
});
