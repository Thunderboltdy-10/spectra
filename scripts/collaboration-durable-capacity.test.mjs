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
  planBootstrapProjectionTransport,
  durablePayloadFitsBridgeEnvelope,
  compactionSnapshotDecision,
  compactionDeferredHealthRecord,
  sha256Hex,
  fitChangeGroupSnapshots,
  resolveCommitSnapshotStrategy,
  MAX_CHANGE_GROUP_SNAPSHOT_JSON_CHARS,
  MAX_CHANGE_GROUP_SINGLE_SNAPSHOT_JSON_CHARS,
} from "./collaboration-durable-capacity.mjs";
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

  it("keeps small merges inline and durably spills every member of an oversized group", () => {
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
    expect(plan.mode).toBe("spill");
    const replay = new Y.Doc();
    Y.applyUpdate(replay, plan.update);
    expect(replay.getMap("m").size).toBe(8);
    for (let i = 0; i < 8; i++) expect(replay.getMap("m").get(`k${i}`)).toBe("y".repeat(120_000));
    replay.destroy();
  });

  it("does not drop the small updates adjacent to an oversized update", () => {
    const doc = new Y.Doc();
    const updates = [];
    doc.on("update", update => updates.push(update));
    doc.getMap("m").set("first", "first");
    doc.getMap("m").set("middle", "界".repeat(300_000));
    doc.getMap("m").set("last", "last");
    const plan = planMergedUpdatePersist(Y, updates);
    const replay = new Y.Doc();
    Y.applyUpdate(replay, plan.update);
    expect(replay.getMap("m").toJSON()).toEqual(doc.getMap("m").toJSON());
    replay.destroy(); doc.destroy();
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

describe("bootstrap projection transport", () => {
  it("inlines small projections and omits bridge-oversized ones", () => {
    const inline = planBootstrapProjectionTransport("ok");
    expect(inline.transport).toBe("inline");
    expect(durablePayloadFitsBridgeEnvelope(1000)).toBe(true);
    const huge = "x".repeat(2_100_000);
    const omitted = planBootstrapProjectionTransport(huge);
    expect(omitted.transport).toBe("omit");
    expect(omitted.reason).toBe("projection_exceeds_bridge_spill");
    expect(durablePayloadFitsBridgeEnvelope(2_100_000)).toBe(false);
  });

  it("spills mid-size projections that exceed the durable inline bound", () => {
    const mid = "y".repeat(950_000);
    const plan = planBootstrapProjectionTransport(mid);
    expect(plan.transport).toBe("spill");
    expect(plan.mode).toBe("spill");
    expect(plan.bytes.byteLength).toBeGreaterThan(900_000);
  });
});


describe("change group snapshot capacity", () => {
  it("keeps small snapshots inline", () => {
    const snap = { title: "t", tags: [], content: { ok: true } };
    const fitted = fitChangeGroupSnapshots(snap, snap);
    expect(fitted.omitted).toBe(false);
    expect(fitted.baseSnapshot.content).toEqual({ ok: true });
  });

  it("omits dual oversized formal-paper snapshots under the 1 MiB ceiling", () => {
    const content = { body: "x".repeat(780_000) };
    const snap = {
      title: "Formal paper",
      summary: "large",
      tags: ["doc"],
      content,
    };
    const inlineChars = JSON.stringify({
      baseSnapshot: snap,
      finalSnapshot: snap,
    }).length;
    expect(inlineChars).toBeGreaterThan(MAX_CHANGE_GROUP_SNAPSHOT_JSON_CHARS);
    const fitted = fitChangeGroupSnapshots(snap, { ...snap }, {
      contentHash: "a".repeat(43),
    });
    expect(fitted.omitted).toBe(true);
    expect(fitted.baseSnapshot.spectraSnapshotOmitted).toBe(true);
    // Convex object fields may not start with '$' (reserved) — omit marker must be legal.
    expect(
      Object.keys(fitted.baseSnapshot).every((key) => !key.startsWith("$")),
    ).toBe(true);
    expect("spectraSnapshotOmitted" in fitted.baseSnapshot).toBe(true);
    expect("$spectraSnapshotOmitted" in fitted.baseSnapshot).toBe(false);
    expect(fitted.finalSnapshot.content).toBeUndefined();
    expect(fitted.baseSnapshot.contentHash).toBe("a".repeat(43));
    const storedChars = JSON.stringify({
      baseSnapshot: fitted.baseSnapshot,
      finalSnapshot: fitted.finalSnapshot,
    }).length;
    expect(storedChars).toBeLessThan(MAX_CHANGE_GROUP_SNAPSHOT_JSON_CHARS);
    // ~1.48 MiB dual-copy failure mode must not recur
    expect(storedChars).toBeLessThan(500_000);
  });

  it("omits full final even when base is already slim (checkpoint/repair path)", () => {
    const slimBase = {
      title: "Formal paper",
      summary: "Imported from formal-paper.docx",
      tags: ["imported"],
      spectraSnapshotOmitted: true,
      contentHash: "b".repeat(43),
    };
    const fatFinal = {
      title: "Formal paper",
      summary: "Imported from formal-paper.docx",
      tags: ["imported"],
      content: { body: "x".repeat(780_000) },
    };
    const pairChars = JSON.stringify({
      baseSnapshot: slimBase,
      finalSnapshot: fatFinal,
    }).length;
    // Pair can sit under the dual budget — the live failure mode.
    expect(pairChars).toBeLessThanOrEqual(MAX_CHANGE_GROUP_SNAPSHOT_JSON_CHARS);
    expect(JSON.stringify(fatFinal).length).toBeGreaterThan(
      MAX_CHANGE_GROUP_SINGLE_SNAPSHOT_JSON_CHARS,
    );
    const fitted = fitChangeGroupSnapshots(slimBase, fatFinal, {
      contentHash: "c".repeat(43),
    });
    expect(fitted.omitted).toBe(true);
    expect(fitted.finalSnapshot.spectraSnapshotOmitted).toBe(true);
    expect(fitted.finalSnapshot.content).toBeUndefined();
    expect(fitted.baseSnapshot.spectraSnapshotOmitted).toBe(true);
  });

  it("omits medium final beside already-omitted base (mixed sibling invariant)", () => {
    const slimBase = {
      title: "Formal paper",
      summary: "Imported from formal-paper.docx",
      tags: ["imported"],
      spectraSnapshotOmitted: true,
      contentHash: "b".repeat(43),
    };
    // Under the per-side byte budget — old fit kept this inline and Convex
    // still rejected the changeGroup row (false import toast).
    const mediumFinal = {
      title: "Formal paper",
      summary: "Imported from formal-paper.docx",
      tags: ["imported"],
      content: { body: "y".repeat(200_000) },
    };
    expect(JSON.stringify(mediumFinal).length).toBeLessThan(
      MAX_CHANGE_GROUP_SINGLE_SNAPSHOT_JSON_CHARS,
    );
    const fitted = fitChangeGroupSnapshots(slimBase, mediumFinal, {
      contentHash: "d".repeat(43),
    });
    expect(fitted.omitted).toBe(true);
    expect(fitted.finalSnapshot.content).toBeUndefined();
    expect(fitted.finalSnapshot.spectraSnapshotOmitted).toBe(true);
  });

  it("omits Unicode-heavy final when UTF-8 bytes exceed the per-side budget", () => {
    // "≈" is multi-byte UTF-8; JS string length can sit under the old char
    // budget while Convex document bytes do not.
    const body = "≈".repeat(200_000);
    const fatFinal = {
      title: "Formal paper",
      summary: "Imported from formal-paper.docx",
      tags: ["imported"],
      content: { body },
    };
    expect(fatFinal.content.body.length).toBeLessThan(
      MAX_CHANGE_GROUP_SINGLE_SNAPSHOT_JSON_CHARS,
    );
    expect(new TextEncoder().encode(JSON.stringify(fatFinal)).byteLength).toBeGreaterThan(
      MAX_CHANGE_GROUP_SINGLE_SNAPSHOT_JSON_CHARS,
    );
    const slimBase = {
      title: "Formal paper",
      summary: "Imported from formal-paper.docx",
      tags: ["imported"],
      spectraSnapshotOmitted: true,
      contentHash: "e".repeat(43),
    };
    const fitted = fitChangeGroupSnapshots(slimBase, fatFinal, {
      contentHash: "f".repeat(43),
    });
    expect(fitted.omitted).toBe(true);
    expect(fitted.finalSnapshot.content).toBeUndefined();
  });
});

describe("version commit snapshot strategy", () => {
  it("keeps small formal-paper versions normalized+inline", () => {
    const snap = { title: "t", tags: [], content: { ok: true } };
    const plan = resolveCommitSnapshotStrategy("formal-paper", snap, snap);
    expect(plan.strategy).toBe("normalized");
    expect(plan.inline).toBe(true);
    expect(plan.promotedOffRow).toBe(false);
  });

  it("promotes oversized formal-paper dual-inline to content_addressed", () => {
    const content = { body: "x".repeat(780_000) };
    const before = {
      title: "Formal paper",
      summary: "large",
      tags: ["doc"],
      content,
    };
    const after = { ...before, summary: "edited" };
    const dualChars = JSON.stringify({ before, after }).length;
    expect(dualChars).toBeGreaterThan(MAX_CHANGE_GROUP_SNAPSHOT_JSON_CHARS);
    const plan = resolveCommitSnapshotStrategy("formal-paper", before, after);
    expect(plan.strategy).toBe("content_addressed");
    expect(plan.inline).toBe(false);
    expect(plan.promotedOffRow).toBe(true);
    // Version row stores refs only — dual payload must not ride the document.
    const versionInlineChars = JSON.stringify({
      before: plan.inline ? before : undefined,
      after: plan.inline ? after : undefined,
    }).length;
    expect(versionInlineChars).toBeLessThan(100);
  });

  it("leaves sheets/presentation on content_addressed without promotion flag", () => {
    const snap = { title: "t", tags: [], content: { cells: [] } };
    const plan = resolveCommitSnapshotStrategy("sheets", snap, snap);
    expect(plan.strategy).toBe("content_addressed");
    expect(plan.inline).toBe(false);
    expect(plan.promotedOffRow).toBe(false);
  });
});



it("checks exact UTF-8 boundaries and refuses incomplete or unknown manifests", () => {
  for (const offset of [-1, 0, 1]) {
    const bytes = MAX_PROJECTION_JSON_UTF8_BYTES + offset;
    const text = "界".repeat(Math.floor(bytes / 3)) + "x".repeat(bytes % 3);
    expect(Buffer.byteLength(text)).toBe(bytes);
    expect(planProjectionStorage(text).mode).toBe(offset > 0 ? "spill" : "inline");
  }
  const body = new Uint8Array([1,2,3]);
  const manifest = createDurablePayloadManifest({kind: "yjs-update", bytes: body, payloadRef: "p"});
  expect(() => resolveDurableUpdateBytes({payloadManifest: manifest}, () => body.slice(0,2))).toThrow("BYTE_LENGTH_MISMATCH");
  expect(() => resolveDurableUpdateBytes({payloadManifest: {...manifest, encoding: "future"}, update: body})).toThrow("ENCODING_UNSUPPORTED");
});
