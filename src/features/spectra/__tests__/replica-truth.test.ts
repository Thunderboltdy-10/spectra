import { describe, expect, it } from "vitest";
import {
  REPLICA_COMPENSATION_TABLE,
  canonicalSyncIntent,
  deriveStorageTransitionIdempotencyKey,
  deriveSyncIdempotencyKey,
} from "../../../../shared/replica-truth";

describe("replica truth contracts", () => {
  it("derives stable, collision-safe keys from logical intent", async () => {
    const intent = {
      workId: "work:1",
      target: "device:1",
      baseRevision: "base",
      targetRevision: "target",
      direction: "cloud-to-local" as const,
    };
    await expect(deriveSyncIdempotencyKey(intent)).resolves.toBe(
      await deriveSyncIdempotencyKey({ ...intent }),
    );
    expect(await deriveSyncIdempotencyKey({ ...intent, targetRevision: "other" }))
      .not.toBe(await deriveSyncIdempotencyKey(intent));
    expect(canonicalSyncIntent({ ...intent, workId: "a|1:b" }))
      .not.toBe(canonicalSyncIntent({ ...intent, workId: "a", target: "1:b|device:1" }));
  });

  it("derives storage transitions from their logical before-and-after state", async () => {
    const intent = {
      workId: "work:1",
      fromPreset: "both",
      toPreset: "device",
      target: "device:1:Truth.docx",
    };
    expect(await deriveStorageTransitionIdempotencyKey(intent)).toBe(
      await deriveStorageTransitionIdempotencyKey({ ...intent }),
    );
    expect(await deriveStorageTransitionIdempotencyKey({ ...intent, toPreset: "spectra" }))
      .not.toBe(await deriveStorageTransitionIdempotencyKey(intent));
  });

  it("gives every nonterminal state verified, failed, and swept exits", () => {
    const names = REPLICA_COMPENSATION_TABLE.map((entry) => entry.state);
    expect(new Set(names).size).toBe(names.length);
    for (const entry of REPLICA_COMPENSATION_TABLE) {
      expect(entry.verifiedExits.length).toBeGreaterThan(0);
      expect(entry.failureExits.length).toBeGreaterThan(0);
      expect(entry.sweeper).toBe("replicas.sweepReplicaTruth");
    }
  });
});
