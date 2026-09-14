import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  MAX_DURABLE_UPDATE_BYTES,
  MAX_PROJECTION_JSON_CHARS,
  MAX_PROJECTION_JSON_UTF8_BYTES,
  MAX_COMPACTION_STATE_VECTOR_BYTES,
} from "./collaboration-update-envelope.mjs";
import {
  DURABLE_PAYLOAD_MANIFEST_VERSION,
  createDurablePayloadManifest,
  verifyDurablePayloadManifest,
  resolveDurableUpdateBytes,
  planMergedUpdatePersist,
  planProjectionStorage,
  compactionSnapshotDecision,
  compactionDeferredHealthRecord,
  sha256Hex,
} from "./collaboration-durable-capacity.mjs";
import {
  MAX_DURABLE_UPDATE_BYTES as WORKER_MAX_DURABLE,
  MAX_UPDATE_BYTES as WORKER_MAX_UPDATE,
  MAX_REALTIME_MESSAGE_BYTES as WORKER_MAX_REALTIME,
} from "../workers/collaboration/src/protocol.ts";
import {
  MAX_DURABLE_UPDATE_BYTES as SHARED_MAX_DURABLE,
  MAX_REALTIME_MESSAGE_BYTES as SHARED_MAX_REALTIME,
  MAX_PROJECTION_JSON_CHARS as SHARED_MAX_CHARS,
  MAX_PROJECTION_JSON_UTF8_BYTES as SHARED_MAX_UTF8,
  MAX_COMPACTION_STATE_VECTOR_BYTES as SHARED_MAX_SV,
} from "../shared/collaboration-durable-limits.ts";

function yUpdateWithPayload(bytes) {
  const doc = new Y.Doc();
  doc.getMap("m").set("pad", "x".repeat(bytes));
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

describe("collaboration durable capacity", () => {
  it("locks shared limits to the self-hosted envelope", () => {
    expect(SHARED_MAX_DURABLE).toBe(MAX_DURABLE_UPDATE_BYTES);
    expect(SHARED_MAX_DURABLE).toBe(760 * 1024);
    expect(SHARED_MAX_REALTIME).toBe(1024 * 1024);
    expect(SHARED_MAX_CHARS).toBe(MAX_PROJECTION_JSON_CHARS);
    expect(SHARED_MAX_UTF8).toBe(MAX_PROJECTION_JSON_UTF8_BYTES);
    expect(SHARED_MAX_SV).toBe(MAX_COMPACTION_STATE_VECTOR_BYTES);
    expect(DURABLE_PAYLOAD_MANIFEST_VERSION).toBe(1);
    expect(WORKER_MAX_DURABLE).toBe(MAX_DURABLE_UPDATE_BYTES);
    expect(WORKER_MAX_UPDATE).toBe(MAX_DURABLE_UPDATE_BYTES);
    expect(WORKER_MAX_REALTIME).toBe(1024 * 1024);
  });

  it("creates digest-verified manifests and rejects tampering", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 9]);
    const manifest = createDurablePayloadManifest({
      kind: "yjs-update",
      bytes,
      encoding: "inline-base64",
    });
    expect(manifest.digest).toBe(sha256Hex(bytes));
    expect(verifyDurablePayloadManifest(manifest, bytes).ok).toBe(true);
    const tampered = new Uint8Array(bytes);
    tampered[0] = 9;
    expect(verifyDurablePayloadManifest(manifest, tampered).ok).toBe(false);
  });

  it("resolves legacy inline rows without a manifest", () => {
    const update = new Uint8Array([7, 7, 7]);
    expect(resolveDurableUpdateBytes({ update })).toEqual(update);
    expect(resolveDurableUpdateBytes({ update: new Uint8Array() })).toBe(null);
  });

  it("resolves payload-ref manifests via loader with digest check", () => {
    const bytes = new Uint8Array(32).fill(3);
    const manifest = createDurablePayloadManifest({
      kind: "yjs-snapshot",
      bytes,
      encoding: "payload-ref",
      payloadRef: "payload:test",
    });
    const resolved = resolveDurableUpdateBytes(
      { payloadManifest: manifest, update: new Uint8Array() },
      (ref, digest) => {
        expect(ref).toBe("payload:test");
        expect(digest).toBe(manifest.digest);
        return bytes;
      },
    );
    expect(resolved).toEqual(bytes);
  });

  it("keeps under-budget merges inline and splits oversize merge batches", () => {
    const small = yUpdateWithPayload(100);
    const planSmall = planMergedUpdatePersist(Y, [small, small]);
    expect(planSmall.mode).toBe("inline");
    expect(planSmall.batches).toHaveLength(1);

    // Build several medium updates whose merge exceeds the envelope.
    const pieces = [];
    let merged = null;
    for (let i = 0; i < 8; i += 1) {
      const doc = new Y.Doc();
      doc.getMap("m").set(`k${i}`, "y".repeat(120_000));
      const update = Y.encodeStateAsUpdate(doc);
      doc.destroy();
      pieces.push(update);
      merged = merged ? Y.mergeUpdates([merged, update]) : update;
    }
    expect(merged.byteLength).toBeGreaterThan(MAX_DURABLE_UPDATE_BYTES);
    expect(pieces.every((p) => p.byteLength <= MAX_DURABLE_UPDATE_BYTES)).toBe(
      true,
    );
    const plan = planMergedUpdatePersist(Y, pieces);
    expect(plan.mode).toBe("split");
    expect(plan.batches.length).toBeGreaterThan(1);
    for (const batch of plan.batches) {
      expect(batch.merged.byteLength).toBeLessThanOrEqual(MAX_DURABLE_UPDATE_BYTES);
      expect(batch.merged.byteLength).toBeGreaterThan(0);
    }
  });

  it("spills a single update that already exceeds the durable envelope", () => {
    const huge = new Uint8Array(MAX_DURABLE_UPDATE_BYTES + 64);
    huge[0] = 1;
    const plan = planMergedUpdatePersist(Y, [huge]);
    expect(plan.mode).toBe("spill");
    expect(plan.manifest.kind).toBe("yjs-update");
    expect(plan.manifest.byteLength).toBe(huge.byteLength);
  });

  it("plans projection spill with UTF-8 honesty and a hot-row stub", () => {
    const inline = planProjectionStorage("ok");
    expect(inline.mode).toBe("inline");
    const multibyte = "é".repeat(500_000);
    expect(multibyte.length).toBe(500_000);
    expect(Buffer.byteLength(multibyte, "utf8")).toBeGreaterThan(
      MAX_PROJECTION_JSON_UTF8_BYTES,
    );
    const spill = planProjectionStorage(multibyte);
    expect(spill.mode).toBe("spill");
    expect(spill.hotStub.$spectraProjectionPayload).toBe(true);
    expect(spill.hotStub.digest).toBe(sha256Hex(spill.bytes));
    expect(spill.manifest.kind).toBe("projection");
  });

  it("replaces silent compaction skip with spill or degraded decisions", () => {
    expect(
      compactionSnapshotDecision(100, 10).action,
    ).toBe("inline");
    expect(
      compactionSnapshotDecision(MAX_DURABLE_UPDATE_BYTES + 1, 10).action,
    ).toBe("spill");
    expect(
      compactionSnapshotDecision(100, MAX_COMPACTION_STATE_VECTOR_BYTES + 1)
        .action,
    ).toBe("degraded");
    const record = compactionDeferredHealthRecord({
      artifactId: "a1",
      partitionKey: "main",
      reason: "snapshot_update_exceeds_envelope",
      updateBytes: MAX_DURABLE_UPDATE_BYTES + 1,
      stateVectorBytes: 12,
      at: 42,
    });
    expect(record.code).toBe("COLLABORATION_COMPACTION_DEFERRED");
    expect(record.at).toBe(42);
  });
});
