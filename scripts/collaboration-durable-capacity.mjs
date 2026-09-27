/**
 * S9-DURABLE capacity helpers: digest-verified manifests, merge pre-check /
 * spill planning, projection off-row planning, compaction honesty.
 * Does not replace Yjs ledger authority — only how oversized bytes are stored.
 */
import { createHash } from "node:crypto";
import {
  MAX_DURABLE_UPDATE_BYTES,
  MAX_PROJECTION_JSON_CHARS,
  MAX_PROJECTION_JSON_UTF8_BYTES,
  MAX_COMPACTION_STATE_VECTOR_BYTES,
} from "./collaboration-update-envelope.mjs";

export const DURABLE_PAYLOAD_MANIFEST_VERSION = 1;
export const DURABLE_PAYLOAD_MEDIA_YJS = "application/vnd.spectra.yjs-update";
export const DURABLE_PAYLOAD_MEDIA_SNAPSHOT =
  "application/vnd.spectra.yjs-snapshot";
export const DURABLE_PAYLOAD_MEDIA_PROJECTION =
  "application/vnd.spectra.projection+json";

export { MAX_COMPACTION_STATE_VECTOR_BYTES };

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Base64Url(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

export function utf8ByteLength(value) {
  if (typeof value !== "string") return 0;
  if (typeof Buffer !== "undefined") return Buffer.byteLength(value, "utf8");
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Versioned immutable payload manifest. Digests are hex SHA-256 of raw bytes.
 * Legacy rows without a manifest are treated as inline bytes by resolve helpers.
 * @param {{ kind: string, bytes: Uint8Array, payloadRef?: string | null, encoding?: string, mediaType?: string }} input
 */
export function createDurablePayloadManifest({
  kind,
  bytes,
  payloadRef = null,
  encoding = payloadRef ? "payload-ref" : "inline-base64",
  mediaType,
}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength <= 0)
    throw new Error("DURABLE_PAYLOAD_BYTES_INVALID");
  if (kind !== "yjs-update" && kind !== "yjs-snapshot" && kind !== "projection")
    throw new Error("DURABLE_PAYLOAD_KIND_INVALID");
  const digest = sha256Hex(bytes);
  const manifest = {
    version: DURABLE_PAYLOAD_MANIFEST_VERSION,
    kind,
    digest,
    byteLength: bytes.byteLength,
    encoding,
    mediaType:
      mediaType ??
      (kind === "projection"
        ? DURABLE_PAYLOAD_MEDIA_PROJECTION
        : kind === "yjs-snapshot"
          ? DURABLE_PAYLOAD_MEDIA_SNAPSHOT
          : DURABLE_PAYLOAD_MEDIA_YJS),
  };
  if (encoding === "inline-base64") {
    manifest.inlineBase64 = Buffer.from(bytes).toString("base64");
  } else if (encoding === "payload-ref") {
    if (typeof payloadRef !== "string" || !payloadRef.trim())
      throw new Error("DURABLE_PAYLOAD_REF_INVALID");
    manifest.payloadRef = payloadRef.trim();
  } else {
    throw new Error("DURABLE_PAYLOAD_ENCODING_INVALID");
  }
  return manifest;
}

export function verifyDurablePayloadManifest(manifest, bytes) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    return { ok: false, reason: "manifest_missing" };
  if (manifest.version !== DURABLE_PAYLOAD_MANIFEST_VERSION)
    return { ok: false, reason: "manifest_version" };
  if (typeof manifest.digest !== "string" || manifest.digest.length !== 64)
    return { ok: false, reason: "manifest_digest" };
  if (
    typeof manifest.byteLength !== "number" ||
    !Number.isSafeInteger(manifest.byteLength) ||
    manifest.byteLength <= 0
  )
    return { ok: false, reason: "manifest_byte_length" };
  if (!(bytes instanceof Uint8Array))
    return { ok: false, reason: "bytes_missing" };
  if (bytes.byteLength !== manifest.byteLength)
    return { ok: false, reason: "byte_length_mismatch" };
  if (sha256Hex(bytes) !== manifest.digest)
    return { ok: false, reason: "digest_mismatch" };
  return { ok: true };
}

/**
 * Resolve update bytes from a stored row. Legacy rows only have inline `update`
 * bytes; capacity rows may carry a verified manifest + payload ref.
 */
export function resolveDurableUpdateBytes(record, loadPayloadBytes) {
  if (!record || typeof record !== "object") return null;
  const inline =
    record.update instanceof Uint8Array
      ? record.update
      : record.update instanceof ArrayBuffer
        ? new Uint8Array(record.update)
        : null;
  if (!record.payloadManifest) {
    return inline && inline.byteLength > 0 ? inline : null;
  }
  const manifest = record.payloadManifest;
  if (manifest.encoding === "inline-base64" && manifest.inlineBase64) {
    const bytes = Buffer.from(String(manifest.inlineBase64), "base64");
    const verified = verifyDurablePayloadManifest(manifest, bytes);
    if (!verified.ok) throw new Error(`DURABLE_PAYLOAD_${verified.reason.toUpperCase()}`);
    return new Uint8Array(bytes);
  }
  if (manifest.encoding === "payload-ref") {
    if (typeof loadPayloadBytes !== "function")
      throw new Error("DURABLE_PAYLOAD_LOADER_REQUIRED");
    const bytes = loadPayloadBytes(manifest.payloadRef, manifest.digest);
    if (!(bytes instanceof Uint8Array))
      throw new Error("DURABLE_PAYLOAD_REF_MISSING");
    const verified = verifyDurablePayloadManifest(manifest, bytes);
    if (!verified.ok) throw new Error(`DURABLE_PAYLOAD_${verified.reason.toUpperCase()}`);
    return bytes;
  }
  // Only records without a manifest are legacy. An advertised manifest may
  // never bypass integrity verification by falling back to unchecked bytes.
  throw new Error("DURABLE_PAYLOAD_ENCODING_UNSUPPORTED");
}

/**
 * Split a same-batch group so each Y.mergeUpdates result stays ≤ maxBytes.
 * Single updates that already exceed the envelope require spill (not split).
 */
export function planMergedUpdatePersist(Y, updates, maxBytes = MAX_DURABLE_UPDATE_BYTES) {
  if (!Array.isArray(updates) || updates.length === 0)
    return { mode: "empty", batches: [] };
  const bodies = updates.map((entry) =>
    entry instanceof Uint8Array ? entry : entry?.documentUpdate,
  );
  if (bodies.some((body) => !(body instanceof Uint8Array) || body.byteLength <= 0))
    throw new Error("DURABLE_MERGE_UPDATE_INVALID");

  const mergedAll = bodies.length === 1 ? bodies[0] : Y.mergeUpdates(bodies);
  // A group is one durable CAS/ack boundary. Spilling the entire merged update
  // preserves every member and prevents recording the final vector against a
  // partial sub-batch (including a large update between two small updates).
    if (mergedAll.byteLength > maxBytes) {
      return {
        mode: "spill",
        reason: "single_update_exceeds_envelope",
        update: mergedAll,
        manifest: createDurablePayloadManifest({
          kind: "yjs-update",
          bytes: mergedAll,
          encoding: "payload-ref",
          payloadRef: "pending",
        }),
        batches: [],
      };
  }

  if (bodies.length === 1) {
    return { mode: "inline", batches: [{ updates: [bodies[0]], merged: bodies[0] }] };
  }

  if (mergedAll.byteLength <= maxBytes) {
    return {
      mode: "inline",
      batches: [{ updates: bodies, merged: mergedAll }],
    };
  }


}

export function planProjectionStorage(projectionJson, {
  maxChars = MAX_PROJECTION_JSON_CHARS,
  maxUtf8Bytes = MAX_PROJECTION_JSON_UTF8_BYTES,
} = {}) {
  if (typeof projectionJson !== "string" || !projectionJson)
    return { mode: "absent" };
  const chars = projectionJson.length;
  const utf8 = utf8ByteLength(projectionJson);
  if (chars <= maxChars && utf8 <= maxUtf8Bytes) {
    return { mode: "inline", projectionJson, charLength: chars, utf8ByteLength: utf8 };
  }
  const bytes = Buffer.from(projectionJson, "utf8");
  return {
    mode: "spill",
    reason: chars > maxChars ? "chars" : "utf8",
    charLength: chars,
    utf8ByteLength: utf8,
    bytes,
    manifest: createDurablePayloadManifest({
      kind: "projection",
      bytes,
      encoding: "payload-ref",
      payloadRef: "pending",
    }),
    // Hot-row stub: readers resolve via digest/ref; never treat as full content.
    hotStub: {
      $spectraProjectionPayload: true,
      digest: sha256Hex(bytes),
      byteLength: bytes.byteLength,
      schema: DURABLE_PAYLOAD_MANIFEST_VERSION,
    },
  };
}

export function compactionSnapshotDecision(
  updateBytes,
  stateVectorBytes,
  {
    maxUpdateBytes = MAX_DURABLE_UPDATE_BYTES,
    maxStateVectorBytes = MAX_COMPACTION_STATE_VECTOR_BYTES,
  } = {},
) {
  const updateLen =
    typeof updateBytes === "number" ? updateBytes : updateBytes?.byteLength ?? 0;
  const svLen =
    typeof stateVectorBytes === "number"
      ? stateVectorBytes
      : stateVectorBytes?.byteLength ?? 0;
  if (updateLen <= maxUpdateBytes && svLen <= maxStateVectorBytes) {
    return { action: "inline", updateBytes: updateLen, stateVectorBytes: svLen };
  }
  if (updateLen > maxUpdateBytes) {
    return {
      action: "spill",
      reason: "snapshot_update_exceeds_envelope",
      updateBytes: updateLen,
      stateVectorBytes: svLen,
    };
  }
  return {
    action: "degraded",
    reason: "state_vector_exceeds_envelope",
    updateBytes: updateLen,
    stateVectorBytes: svLen,
  };
}

export function compactionDeferredHealthRecord({
  artifactId,
  partitionKey,
  reason,
  updateBytes,
  stateVectorBytes,
  at = Date.now(),
}) {
  return {
    code: "COLLABORATION_COMPACTION_DEFERRED",
    reason,
    artifactId: artifactId ?? null,
    partitionKey: partitionKey ?? null,
    updateBytes: updateBytes ?? null,
    stateVectorBytes: stateVectorBytes ?? null,
    at,
  };
}

/**
 * Whether raw bytes can ride storeDurablePayload inside the signed bridge
 * envelope (base64 + modest metadata headroom under MAX_BRIDGE_ENVELOPE_CHARS).
 * Oversized projections must omit the inline JSON and either spill or rely on
 * the artifact row already holding import content (bootstrap).
 */
export function durablePayloadFitsBridgeEnvelope(
  byteLength,
  {
    maxEnvelopeChars = 2_000_000,
    metadataHeadroom = 64_000,
  } = {},
) {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) return false;
  const base64Chars = Math.ceil(byteLength / 3) * 4;
  return base64Chars + metadataHeadroom <= maxEnvelopeChars;
}

/**
 * Plan how bootstrap ships projection through the bridge without blowing the
 * 2M signed envelope. Artifact content is already authoritative on first open.
 */
export function planBootstrapProjectionTransport(projectionJson, {
  maxChars = MAX_PROJECTION_JSON_CHARS,
  maxUtf8Bytes = MAX_PROJECTION_JSON_UTF8_BYTES,
  maxEnvelopeChars = 2_000_000,
  metadataHeadroom = 64_000,
} = {}) {
  const plan = planProjectionStorage(projectionJson, { maxChars, maxUtf8Bytes });
  if (plan.mode === "absent") return plan;
  if (plan.mode === "inline") {
    // Leave room for update + metadata alongside projectionJson.
    if (plan.charLength + metadataHeadroom <= maxEnvelopeChars) {
      return { ...plan, transport: "inline" };
    }
    // Inline projection alone nearly fills the envelope — try spill.
  }
  const bytes = plan.bytes ?? Buffer.from(projectionJson, "utf8");
  if (
    durablePayloadFitsBridgeEnvelope(bytes.byteLength, {
      maxEnvelopeChars,
      metadataHeadroom,
    })
  ) {
    return {
      mode: "spill",
      transport: "spill",
      reason: plan.reason ?? "envelope",
      charLength: plan.charLength ?? projectionJson.length,
      utf8ByteLength: plan.utf8ByteLength ?? bytes.byteLength,
      bytes,
      manifest:
        plan.manifest ??
        createDurablePayloadManifest({
          kind: "projection",
          bytes,
          encoding: "payload-ref",
          payloadRef: "pending",
        }),
      hotStub: plan.hotStub,
    };
  }
  return {
    mode: "omit",
    transport: "omit",
    reason: "projection_exceeds_bridge_spill",
    charLength: plan.charLength ?? projectionJson.length,
    utf8ByteLength: plan.utf8ByteLength ?? bytes.byteLength,
  };
}


/** Convex changeGroups document ceiling budget (chars of base+final JSON). */
export const MAX_CHANGE_GROUP_SNAPSHOT_JSON_CHARS = 900_000;
/** Per-side budget — see shared/collaboration-change-group-capacity.ts. */
export const MAX_CHANGE_GROUP_SINGLE_SNAPSHOT_JSON_CHARS = 500_000;

export function estimateJsonChars(value) {
  try {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== "string") return Number.POSITIVE_INFINITY;
    // Convex document ceiling is UTF-8 bytes — see shared helper.
    return new TextEncoder().encode(encoded).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function snapshotCarriesInlineContent(snapshot) {
  return snapshot?.content !== undefined && snapshot?.spectraSnapshotOmitted !== true;
}

function isOmittedChangeGroupSnapshot(snapshot) {
  return Boolean(snapshot && typeof snapshot === "object" && snapshot.spectraSnapshotOmitted === true);
}

export function slimChangeGroupSnapshot(snapshot, contentHash) {
  const hash =
    typeof contentHash === "string" && contentHash.length >= 16
      ? contentHash
      : typeof snapshot?.contentHash === "string" &&
          snapshot.contentHash.length >= 16
        ? snapshot.contentHash
        : undefined;
  return {
    title: snapshot.title,
    summary: snapshot.summary,
    tags: Array.isArray(snapshot.tags) ? snapshot.tags : [],
    // Legal Convex field (no leading '$') — content lives on artifact / Yjs head.
    spectraSnapshotOmitted: true,
    ...(hash ? { contentHash: hash } : {}),
  };
}

/**
 * Dual-copy open changeGroups blow Convex's 1 MiB ceiling on formal-paper /
 * large-sheet rows (~2× hot artifact). Omit content; Yjs ledger stays durable.
 */
export function fitChangeGroupSnapshots(
  baseSnapshot,
  finalSnapshot,
  { contentHash } = {},
) {
  const baseChars = estimateJsonChars(baseSnapshot);
  const finalChars = estimateJsonChars(finalSnapshot);
  const inlineChars = estimateJsonChars({ baseSnapshot, finalSnapshot });
  const omittedSiblingWouldMix =
    (isOmittedChangeGroupSnapshot(baseSnapshot) &&
      snapshotCarriesInlineContent(finalSnapshot)) ||
    (isOmittedChangeGroupSnapshot(finalSnapshot) &&
      snapshotCarriesInlineContent(baseSnapshot));
  const needsOmit =
    omittedSiblingWouldMix ||
    inlineChars > MAX_CHANGE_GROUP_SNAPSHOT_JSON_CHARS ||
    baseChars > MAX_CHANGE_GROUP_SINGLE_SNAPSHOT_JSON_CHARS ||
    finalChars > MAX_CHANGE_GROUP_SINGLE_SNAPSHOT_JSON_CHARS;
  if (!needsOmit) {
    return { baseSnapshot, finalSnapshot, omitted: false };
  }
  const slimBase = slimChangeGroupSnapshot(baseSnapshot, contentHash);
  const slimFinal = slimChangeGroupSnapshot(finalSnapshot, contentHash);
  if (
    estimateJsonChars({
      baseSnapshot: slimBase,
      finalSnapshot: slimFinal,
    }) > MAX_CHANGE_GROUP_SNAPSHOT_JSON_CHARS
  ) {
    throw new Error("COLLABORATION_CHANGE_GROUP_SIZE");
  }
  return {
    baseSnapshot: slimBase,
    finalSnapshot: slimFinal,
    omitted: true,
  };
}

export const CONTENT_ADDRESSED_BLUEPRINT_KEYS = [
  "presentation",
  "sheets",
  "code",
  "whiteboard",
];

export function baseSnapshotStrategyForType(typeKey) {
  return CONTENT_ADDRESSED_BLUEPRINT_KEYS.includes(typeKey)
    ? "content_addressed"
    : "normalized";
}

/**
 * Dual-inline before+after on spectraArtifactVersions hits the same 1 MiB
 * ceiling. Promote oversized formal-paper commits to content_addressed so
 * payloads live only in artifactSnapshotObjects (off-row via snapshot refs).
 */
export function resolveCommitSnapshotStrategy(typeKey, before, after) {
  const base = baseSnapshotStrategyForType(typeKey);
  if (base === "content_addressed") {
    return { strategy: base, inline: false, promotedOffRow: false };
  }
  if (
    estimateJsonChars({ before, after }) <= MAX_CHANGE_GROUP_SNAPSHOT_JSON_CHARS
  ) {
    return { strategy: "normalized", inline: true, promotedOffRow: false };
  }
  return {
    strategy: "content_addressed",
    inline: false,
    promotedOffRow: true,
  };
}

