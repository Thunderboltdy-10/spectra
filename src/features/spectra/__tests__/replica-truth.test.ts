import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  REPLICA_COMPENSATION_TABLE,
  canonicalSyncIntent,
  deriveStorageTransitionIdempotencyKey,
  deriveSyncIdempotencyKey,
  localMaterializationTarget,
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

  it("keys local writes by mount and normalized destination path", async () => {
    const intent = {
      workId: "work:1",
      baseRevision: "new:work:1",
      targetRevision: "same-content-hash",
      direction: "cloud-to-local" as const,
    };
    const target = localMaterializationTarget("mount:1", "folder\\.\\paper.docx");
    expect(target).toBe(localMaterializationTarget("mount:1", "folder/paper.docx"));
    expect(await deriveSyncIdempotencyKey({ ...intent, target }))
      .not.toBe(await deriveSyncIdempotencyKey({ ...intent, target: localMaterializationTarget("mount:2", "folder/paper.docx") }));
    expect(await deriveSyncIdempotencyKey({ ...intent, target }))
      .not.toBe(await deriveSyncIdempotencyKey({ ...intent, target: localMaterializationTarget("mount:1", "folder/other.docx") }));
    expect(() => localMaterializationTarget("mount:1", "folder/../paper.docx"))
      .toThrow("LOCAL_MATERIALIZATION_TARGET_INVALID");
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

  it("keeps replica truth sweeps inside the scheduled 100-document probe budget", () => {
    const source = readFileSync(
      path.join(process.cwd(), "convex/replicas.ts"),
      "utf8",
    );
    expect(source).toContain("export const SWEEP_DOCUMENT_BUDGET = 100");
    expect(source).toContain("if (budget.exhausted()) return true;");
    expect(source).toContain(".take(budget.cap(1))");
    expect(source).toContain("documentsRead: SWEEP_DOCUMENT_BUDGET - budget.remaining()");
    const presentationsStart = source.indexOf(
      "export const presentationsForAccount",
    );
    const presentationsEnd = source.indexOf("export const", presentationsStart + 1);
    expect(
      source.slice(presentationsStart, presentationsEnd),
    ).toContain("getOptionalAuthenticatedActor");
    const sweep = source.slice(source.indexOf("export const sweepReplicaTruth"));
    expect(sweep).not.toContain(".take(1_000)");
    expect(sweep).not.toContain(".take(200)");
  });
});
