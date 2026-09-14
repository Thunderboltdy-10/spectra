"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Id } from "./_generated/dataModel";
import { MAX_COLLABORATION_BRIDGE_PAYLOAD_CHARACTERS } from "../shared/collaboration-bridge";
import {
  MAX_PROJECTION_JSON_CHARS,
  MAX_PROJECTION_JSON_UTF8_BYTES,
  DURABLE_PAYLOAD_MANIFEST_VERSION,
} from "../shared/collaboration-durable-limits";

const operation = v.union(
  v.literal("authorize"),
  v.literal("policy"),
  v.literal("load"),
  v.literal("recover"),
  v.literal("bootstrap"),
  v.literal("append"),
  v.literal("checkpoint"),
  v.literal("snapshot"),
  v.literal("storeDurablePayload"),
);

function bridgeKey() {
  const value = process.env.SPECTRA_COLLAB_BRIDGE_KEY;
  if (!value || value.length < 32)
    throw new Error("COLLABORATION_BRIDGE_CONFIG_MISSING");
  return value;
}

function verify(
  operationName: string,
  payloadJson: string,
  timestamp: number,
  nonce: string,
  signature: string,
) {
  const skewMs = Math.abs(Date.now() - timestamp);
  if (skewMs > 30_000)
    throw new Error(
      `COLLABORATION_BRIDGE_EXPIRED: skewMs=${skewMs} op=${operationName}`,
    );
  if (typeof nonce !== "string" || nonce.length < 20 || nonce.length > 100)
    throw new Error(
      `COLLABORATION_BRIDGE_NONCE_INVALID: len=${typeof nonce === "string" ? nonce.length : -1} op=${operationName}`,
    );
  if (payloadJson.length > MAX_COLLABORATION_BRIDGE_PAYLOAD_CHARACTERS)
    throw new Error(
      `COLLABORATION_BRIDGE_PAYLOAD_TOO_LARGE: chars=${payloadJson.length} max=${MAX_COLLABORATION_BRIDGE_PAYLOAD_CHARACTERS} op=${operationName}`,
    );
  const digest = createHash("sha256").update(payloadJson).digest("base64url");
  const canonical = [operationName, timestamp, nonce, digest].join("|");
  const expected = createHmac("sha256", bridgeKey()).update(canonical).digest();
  const received = Buffer.from(signature, "base64url");
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    throw new Error(
      `COLLABORATION_BRIDGE_FORBIDDEN: hmac mismatch op=${operationName}`,
    );
}

function objectPayload(value: string) {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("COLLABORATION_BRIDGE_PAYLOAD_INVALID");
  return parsed as Record<string, unknown>;
}

function text(value: unknown, name: string, max = 240) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`COLLABORATION_BRIDGE_${name.toUpperCase()}_INVALID`);
  return value.trim();
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

/** Projection JSON: true UTF-8 bound (not JS string length alone). Do not trim. */
function projectionText(value: unknown, name: string) {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`COLLABORATION_BRIDGE_${name.toUpperCase()}_INVALID`);
  if (value.length > MAX_PROJECTION_JSON_CHARS)
    throw new Error(`COLLABORATION_BRIDGE_${name.toUpperCase()}_INVALID`);
  if (utf8ByteLength(value) > MAX_PROJECTION_JSON_UTF8_BYTES)
    throw new Error(`COLLABORATION_BRIDGE_${name.toUpperCase()}_INVALID`);
  return value;
}

function optionalText(value: unknown, name: string, max = 240) {
  if (value === undefined || value === null) return undefined;
  return text(value, name, max);
}

function optionalProjectionText(value: unknown, name: string) {
  if (value === undefined || value === null) return undefined;
  return projectionText(value, name);
}

function optionalPayloadRef(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  return text(value, "payload_ref", 180);
}


function integer(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`COLLABORATION_BRIDGE_${name.toUpperCase()}_INVALID`);
  return value;
}

function optionalBoolean(value: unknown, name: string) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean")
    throw new Error(`COLLABORATION_BRIDGE_${name.toUpperCase()}_INVALID`);
  return value;
}

function actorKind(value: unknown) {
  if (value !== "human" && value !== "ai")
    throw new Error("COLLABORATION_BRIDGE_ACTOR_KIND_INVALID");
  return value;
}

function stringArray(value: unknown, name: string, maxItems = 128) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > maxItems ||
    !value.every(
      (entry) =>
        typeof entry === "string" && entry.trim() && entry.length <= 240,
    )
  )
    throw new Error(`COLLABORATION_BRIDGE_${name.toUpperCase()}_INVALID`);
  return [...new Set(value.map((entry) => (entry as string).trim()))];
}

export const exchange = action({
  args: {
    operation,
    payloadJson: v.string(),
    timestamp: v.number(),
    nonce: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    verify(
      args.operation,
      args.payloadJson,
      args.timestamp,
      args.nonce,
      args.signature,
    );
    const payload = objectPayload(args.payloadJson);
    const artifactId = text(
      payload.artifactId,
      "artifact_id",
    ) as Id<"spectraArtifacts">;
    const partitionKey = text(payload.partitionKey, "partition_key", 180);

    if (args.operation === "authorize") {
      return ctx.runQuery(internal.collaborationGatewayStore.authorize, {
        accountId: text(payload.accountId, "account_id") as Id<"accounts">,
        artifactId,
        partitionKey,
        policyVersion: integer(payload.policyVersion, "policy_version"),
      });
    }

    if (args.operation === "policy") {
      return ctx.runQuery(internal.collaborationGatewayStore.policy, {
        artifactId,
        partitionKey,
      });
    }

    if (args.operation === "load") {
      let afterSequence = 0;
      let snapshot: {
        throughSequence: number;
        update: string;
        stateVector: string;
        contentHash: string;
      } | null = null;
      const updates: Array<{ sequence: number; update: string }> = [];
      let roomId: string | null = null;
      let schemaVersion = 1;
      let nextSequence = 1;
      let initialProjection: unknown = null;
      let uncompactedBytes = 0;
      let lastSnapshotAt: number | null = null;
      let lastProjectionSequence: number | null = null;
      let liveStateVectorHash: string | null = null;
      for (let page = 0; page < 20; page += 1) {
        const result = await ctx.runQuery(
          internal.collaborationGatewayStore.load,
          {
            artifactId,
            partitionKey,
            afterSequence,
            limit: 500,
            includeInitialProjection: optionalBoolean(
              payload.includeInitialProjection,
              "include_initial_projection",
            ),
          },
        );
        if (!result) return null;
        roomId = result.roomId;
        schemaVersion = result.schemaVersion;
        nextSequence = result.nextSequence;
        uncompactedBytes = result.uncompactedBytes ?? 0;
        lastSnapshotAt = result.lastSnapshotAt ?? null;
        lastProjectionSequence = result.lastProjectionSequence ?? null;
        liveStateVectorHash = result.liveStateVectorHash ?? null;
        if (!initialProjection && result.initialProjection)
          initialProjection = result.initialProjection;
        if (!snapshot && result.snapshot) {
          let snapUpdate = Buffer.from(result.snapshot.update);
          const snapRef = (result.snapshot as { payloadRef?: string | null })
            .payloadRef;
          const snapDigest = (
            result.snapshot as { payloadDigest?: string | null }
          ).payloadDigest;
          if (snapRef && snapDigest) {
            const meta = await ctx.runQuery(
              internal.collaborationDurablePayload.getMeta,
              { payloadRef: snapRef, digest: snapDigest },
            );
            if (!meta) throw new Error("COLLABORATION_BRIDGE_PAYLOAD_MISSING");
            const blob = await ctx.storage.get(meta.storageId);
            if (!blob) throw new Error("COLLABORATION_BRIDGE_PAYLOAD_MISSING");
            snapUpdate = Buffer.from(await blob.arrayBuffer());
          }
          snapshot = {
            throughSequence: result.snapshot.throughSequence,
            update: snapUpdate.toString("base64"),
            stateVector: Buffer.from(result.snapshot.stateVector).toString(
              "base64",
            ),
            contentHash: result.snapshot.contentHash,
          };
        }
        for (const update of result.updates) {
          let updateBytes = Buffer.from(update.update);
          const payloadRef =
            "payloadRef" in update ? (update as { payloadRef?: string | null }).payloadRef : null;
          const payloadDigest =
            "payloadDigest" in update
              ? (update as { payloadDigest?: string | null }).payloadDigest
              : null;
          if (payloadRef && payloadDigest) {
            const meta = await ctx.runQuery(
              internal.collaborationDurablePayload.getMeta,
              { payloadRef, digest: payloadDigest },
            );
            if (!meta) throw new Error("COLLABORATION_BRIDGE_PAYLOAD_MISSING");
            const blob = await ctx.storage.get(meta.storageId);
            if (!blob) throw new Error("COLLABORATION_BRIDGE_PAYLOAD_MISSING");
            updateBytes = Buffer.from(await blob.arrayBuffer());
          }
          updates.push({
            sequence: update.sequence,
            update: updateBytes.toString("base64"),
          });
        }
        if (!result.hasMore) break;
        afterSequence = result.updates[result.updates.length - 1]!.sequence;
        if (page === 19)
          throw new Error("COLLABORATION_BRIDGE_SNAPSHOT_REQUIRED");
      }
      return {
        roomId,
        schemaVersion,
        nextSequence,
        snapshot,
        updates,
        initialProjection,
        uncompactedBytes,
        lastSnapshotAt,
        lastProjectionSequence,
        liveStateVectorHash,
      };
    }

    if (args.operation === "recover") {
      return ctx.runMutation(
        internal.collaborationGatewayStore.recoverNativeSnapshot,
        {
          accountId: text(payload.accountId, "account_id") as Id<"accounts">,
          artifactId,
          partitionKey,
          clientId: text(payload.clientId, "client_id", 180),
          policyVersion: integer(payload.policyVersion, "policy_version"),
          expectedNextSequence: integer(
            payload.expectedNextSequence,
            "expected_next_sequence",
          ),
          expectedStateVectorHash: text(
            payload.expectedStateVectorHash,
            "expected_state_vector_hash",
            180,
          ),
          observedStateVectorHash: text(
            payload.observedStateVectorHash,
            "observed_state_vector_hash",
            180,
          ),
          observedProjectionJson: optionalProjectionText(
            payload.observedProjectionJson,
            "observed_projection",
          ),
          observedProjectionHash: text(
            payload.observedProjectionHash,
            "observed_projection_hash",
            180,
          ),
          observedProjectionPayloadRef: optionalPayloadRef(
            payload.observedProjectionPayloadRef,
          ),
        },
      );
    }

    if (args.operation === "bootstrap") {
      const payloadRef = optionalPayloadRef(payload.payloadRef);
      const updateB64 =
        payload.update === undefined || payload.update === null
          ? ""
          : String(payload.update);
      if (!payloadRef && (!updateB64 || !updateB64.trim()))
        throw new Error("COLLABORATION_BRIDGE_UPDATE_INVALID");
      if (updateB64.length > 1_400_000)
        throw new Error("COLLABORATION_BRIDGE_UPDATE_INVALID");
      const update = Buffer.from(updateB64, "base64");
      return ctx.runMutation(
        internal.collaborationGatewayStore.bootstrapNative,
        {
          accountId: text(payload.accountId, "account_id") as Id<"accounts">,
          artifactId,
          partitionKey,
          clientId: text(payload.clientId, "client_id", 180),
          policyVersion: integer(payload.policyVersion, "policy_version"),
          artifactUpdatedAt: integer(
            payload.artifactUpdatedAt,
            "artifact_updated_at",
          ),
          expectedNextSequence: integer(
            payload.expectedNextSequence,
            "expected_next_sequence",
          ),
          update: update.buffer.slice(
            update.byteOffset,
            update.byteOffset + update.byteLength,
          ),
          stateVectorHash: text(
            payload.stateVectorHash,
            "state_vector_hash",
            180,
          ),
          projectionJson: optionalProjectionText(
            payload.projectionJson,
            "projection",
          ),
          projectionHash: optionalText(
            payload.projectionHash,
            "projection_hash",
            180,
          ),
          payloadRef,
          payloadDigest: optionalText(payload.payloadDigest, "payload_digest", 80),
          payloadManifest:
            payload.payloadManifest === undefined ||
            payload.payloadManifest === null
              ? undefined
              : payload.payloadManifest,
          byteLength:
            payload.byteLength === undefined || payload.byteLength === null
              ? undefined
              : integer(payload.byteLength, "byte_length"),
          projectionPayloadRef: optionalPayloadRef(
            payload.projectionPayloadRef,
          ),
          projectionPayloadDigest: optionalText(
            payload.projectionPayloadDigest,
            "projection_payload_digest",
            80,
          ),
        },
      );
    }

    if (args.operation === "append") {
      const payloadRef = optionalPayloadRef(payload.payloadRef);
      const updateB64 =
        payload.update === undefined || payload.update === null
          ? ""
          : String(payload.update);
      if (!payloadRef && (!updateB64 || !updateB64.trim()))
        throw new Error("COLLABORATION_BRIDGE_UPDATE_INVALID");
      if (updateB64.length > 1_400_000)
        throw new Error("COLLABORATION_BRIDGE_UPDATE_INVALID");
      const update = Buffer.from(updateB64, "base64");
      return ctx.runMutation(internal.collaborationGatewayStore.append, {
        accountId: text(payload.accountId, "account_id") as Id<"accounts">,
        actorKind: actorKind(payload.actorKind),
        artifactId,
        partitionKey,
        clientId: text(payload.clientId, "client_id", 180),
        policyVersion: integer(payload.policyVersion, "policy_version"),
        idempotencyKey: text(payload.idempotencyKey, "idempotency_key", 180),
        update: update.buffer.slice(
          update.byteOffset,
          update.byteOffset + update.byteLength,
        ),
        baseStateVectorHash: text(
          payload.baseStateVectorHash,
          "base_state_vector_hash",
          180,
        ),
        stateVectorHash: text(
          payload.stateVectorHash,
          "state_vector_hash",
          180,
        ),
        regionIds: stringArray(payload.regionIds, "region_ids"),
        nativeInitialization: optionalBoolean(
          payload.nativeInitialization,
          "native_initialization",
        ),
        projectionJson: optionalProjectionText(
          payload.projectionJson,
          "projection",
        ),
        projectionHash: optionalText(
          payload.projectionHash,
          "projection_hash",
          180,
        ),
        payloadRef,
        payloadDigest: optionalText(payload.payloadDigest, "payload_digest", 80),
        payloadManifest:
          payload.payloadManifest === undefined ||
          payload.payloadManifest === null
            ? undefined
            : payload.payloadManifest,
        byteLength:
          payload.byteLength === undefined || payload.byteLength === null
            ? undefined
            : integer(payload.byteLength, "byte_length"),
        projectionPayloadRef: optionalPayloadRef(payload.projectionPayloadRef),
        projectionPayloadDigest: optionalText(
          payload.projectionPayloadDigest,
          "projection_payload_digest",
          80,
        ),
        projectionHotStub:
          payload.projectionHotStub === undefined ||
          payload.projectionHotStub === null
            ? undefined
            : payload.projectionHotStub,
      });
    }

    if (args.operation === "checkpoint") {
      return ctx.runMutation(internal.collaborationGatewayStore.checkpoint, {
        accountId: text(payload.accountId, "account_id") as Id<"accounts">,
        artifactId,
        partitionKey,
        clientId: text(payload.clientId, "client_id", 180),
        policyVersion: integer(payload.policyVersion, "policy_version"),
        roomId:
          payload.roomId === undefined || payload.roomId === null
            ? undefined
            : (text(payload.roomId, "room_id") as Id<"collaborationRooms">),
        expectedNextSequence:
          payload.expectedNextSequence === undefined ||
          payload.expectedNextSequence === null
            ? undefined
            : integer(payload.expectedNextSequence, "expected_next_sequence"),
        expectedLastProjectionSequence:
          payload.expectedLastProjectionSequence === undefined ||
          payload.expectedLastProjectionSequence === null
            ? undefined
            : integer(
                payload.expectedLastProjectionSequence,
                "expected_last_projection_sequence",
              ),
        stateVectorHash: text(
          payload.stateVectorHash,
          "state_vector_hash",
          180,
        ),
        projectionJson: projectionText(payload.projectionJson, "projection"),
        projectionHash: text(payload.projectionHash, "projection_hash", 180),
        throughSequence:
          payload.throughSequence === undefined ||
          payload.throughSequence === null
            ? undefined
            : integer(payload.throughSequence, "through_sequence"),
      });
    }


    if (args.operation === "storeDurablePayload") {
      const kindValue = text(payload.kind, "kind", 40);
      if (
        kindValue !== "yjs-update" &&
        kindValue !== "yjs-snapshot" &&
        kindValue !== "projection"
      )
        throw new Error("COLLABORATION_BRIDGE_KIND_INVALID");
      const digest = text(payload.digest, "digest", 80);
      const bytesBase64 = text(payload.bytesBase64, "bytes_base64", 2_000_000);
      const bytes = Buffer.from(bytesBase64, "base64");
      if (bytes.byteLength <= 0) throw new Error("COLLABORATION_BRIDGE_BYTES_INVALID");
      const hex = createHash("sha256").update(bytes).digest("hex");
      if (hex !== digest) throw new Error("COLLABORATION_BRIDGE_DIGEST_MISMATCH");
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array(bytes)], {
          type: text(payload.mediaType, "media_type", 120),
        }),
      );
      return ctx.runMutation(internal.collaborationDurablePayload.put, {
        artifactId,
        accountId: text(payload.accountId, "account_id") as Id<"accounts">,
        kind: kindValue,
        digest,
        storageId,
        byteLength: bytes.byteLength,
        mediaType: text(payload.mediaType, "media_type", 120),
        manifestVersion: DURABLE_PAYLOAD_MANIFEST_VERSION,
      });
    }

    const roomId = text(payload.roomId, "room_id") as Id<"collaborationRooms">;
    const snapshotPayloadRef = optionalPayloadRef(payload.payloadRef);
    const updateB64 =
      payload.update === undefined || payload.update === null
        ? ""
        : String(payload.update);
    if (!snapshotPayloadRef && (!updateB64 || !updateB64.trim()))
      throw new Error("COLLABORATION_BRIDGE_UPDATE_INVALID");
    if (updateB64.length > 1_400_000)
      throw new Error("COLLABORATION_BRIDGE_UPDATE_INVALID");
    const update = Buffer.from(updateB64, "base64");
    const stateVector = Buffer.from(
      text(payload.stateVector, "state_vector", 1_400_000),
      "base64",
    );
    const snapshotId = await ctx.runMutation(
      internal.collaboration.storeSnapshot,
      {
        roomId,
        throughSequence: integer(payload.throughSequence, "through_sequence"),
        update: update.buffer.slice(
          update.byteOffset,
          update.byteOffset + update.byteLength,
        ),
        stateVector: stateVector.buffer.slice(
          stateVector.byteOffset,
          stateVector.byteOffset + stateVector.byteLength,
        ),
        contentHash: text(payload.contentHash, "content_hash", 180),
        schemaVersion: Math.max(
          1,
          integer(payload.schemaVersion, "schema_version"),
        ),
        createdBy: "compactor",
        payloadRef: snapshotPayloadRef,
        payloadDigest: optionalText(payload.payloadDigest, "payload_digest", 80),
        payloadManifest:
          payload.payloadManifest === undefined ||
          payload.payloadManifest === null
            ? undefined
            : payload.payloadManifest,
        byteLength:
          payload.byteLength === undefined || payload.byteLength === null
            ? undefined
            : integer(payload.byteLength, "byte_length"),
      },
    );
    return ctx.runMutation(internal.collaboration.verifySnapshot, {
      snapshotId,
    });
  },
});
