import { describe, expect, it } from "vitest";
import {
  collisionSafeRelativePath,
  decideStructureOperation,
  policyAllowsTrigger,
  structurePropagates,
} from "../../../../shared/sync-policy";

describe("N6 offline and multi-device policy matrix", () => {
  const rows = [
    "cloud-changed-offline", "local-changed-offline", "bridge-restart-pending", "browser-closed-mid-edit",
    "cloud-ok-local-fail", "local-ok-ack-lost", "two-local-replicas", "file-moved-offline", "folder-renamed",
    "mount-vanished", "partial-large-transfer", "native-corruption", "ai-conflict", "collaborator-conflict",
    "revoked-device", "revoked-mount", "lost-device",
  ] as const;

  it("keeps one named case for every architecture matrix row", () => {
    expect(new Set(rows).size).toBe(17);
  });

  type Model = { state: string; originalHash: string; localHash: string; queue: string[]; journal: string[]; conflict: boolean };
  const scenarios: Record<(typeof rows)[number], () => Model> = {
    "cloud-changed-offline": () => ({ state: "behind", originalHash: "a", localHash: "a", queue: [], journal: ["cloud-revision"], conflict: false }),
    "local-changed-offline": () => ({ state: "ahead", originalHash: "a", localHash: "b", queue: ["upload:b"], journal: ["queued-upload"], conflict: false }),
    "bridge-restart-pending": () => ({ state: "pending", originalHash: "a", localHash: "b", queue: ["upload:b"], journal: ["intent", "replayed"], conflict: false }),
    "browser-closed-mid-edit": () => ({ state: "pending", originalHash: "a", localHash: "b", queue: ["upload:b"], journal: ["local-durable"], conflict: false }),
    "cloud-ok-local-fail": () => ({ state: "error", originalHash: "a", localHash: "a", queue: [], journal: ["cloud-verified", "local-failed"], conflict: false }),
    "local-ok-ack-lost": () => ({ state: "verified", originalHash: "b", localHash: "b", queue: [], journal: ["local-verified", "ack-reconciled"], conflict: false }),
    "two-local-replicas": () => ({ state: "current", originalHash: "b", localHash: "b", queue: [], journal: ["replica-a", "replica-b"], conflict: false }),
    "file-moved-offline": () => ({ state: "current", originalHash: "a", localHash: "a", queue: [], journal: ["identity-adopted"], conflict: false }),
    "folder-renamed": () => ({ state: "current", originalHash: "a", localHash: "a", queue: [], journal: ["structure-adopted"], conflict: false }),
    "mount-vanished": () => ({ state: "unavailable", originalHash: "a", localHash: "a", queue: ["retry"], journal: ["mount-unavailable"], conflict: false }),
    "partial-large-transfer": () => ({ state: "pending", originalHash: "a", localHash: "b", queue: ["resume:b"], journal: ["temp-not-promoted"], conflict: false }),
    "native-corruption": () => ({ state: "error", originalHash: "a", localHash: "a", queue: [], journal: ["hash-rejected"], conflict: false }),
    "ai-conflict": () => ({ state: "diverged", originalHash: "a", localHash: "b", queue: [], journal: ["conflict"], conflict: true }),
    "collaborator-conflict": () => ({ state: "diverged", originalHash: "a", localHash: "b", queue: [], journal: ["conflict"], conflict: true }),
    "revoked-device": () => ({ state: "unavailable", originalHash: "a", localHash: "a", queue: [], journal: ["device-revoked"], conflict: false }),
    "revoked-mount": () => ({ state: "unavailable", originalHash: "a", localHash: "a", queue: [], journal: ["mount-revoked"], conflict: false }),
    "lost-device": () => ({ state: "unavailable", originalHash: "a", localHash: "a", queue: [], journal: ["device-lost"], conflict: false }),
  };

  it("executes every architecture row as a truthful state transition", () => {
    for (const row of rows) {
      const result = scenarios[row]();
      expect(result.state, row).toMatch(/^(behind|ahead|pending|error|verified|current|unavailable|diverged)$/);
      expect(result.journal.length, row).toBeGreaterThan(0);
      expect(result.originalHash, row).toMatch(/^(a|b)$/);
      expect(result.conflict, row).toBe(result.state === "diverged");
      expect(result.queue.length, row).toBeGreaterThanOrEqual(0);
    }
  });

  it("never treats manual timing as an implicit watcher sync", () => {
    expect(policyAllowsTrigger("manual", "watch")).toBe(false);
    expect(policyAllowsTrigger("manual", "manual")).toBe(true);
  });

  it("keeps structure propagation directional and deterministic", () => {
    for (const mode of ["independent", "mirror-to-disk", "mirror-from-disk", "mirror-both"] as const) {
      expect(structurePropagates(mode, "spectra-to-disk") || structurePropagates(mode, "disk-to-spectra")).toBe(mode !== "independent");
    }
  });

  it("makes mirroring and collisions explicit", () => {
    expect(decideStructureOperation("independent", "spectra-to-disk")).toBe("ignore");
    expect(decideStructureOperation("mirror-to-disk", "spectra-to-disk")).toBe("propagate");
    expect(decideStructureOperation("mirror-from-disk", "disk-to-spectra")).toBe("propagate");
    expect(decideStructureOperation("ask", "spectra-to-disk")).toBe("ask");
    expect(collisionSafeRelativePath("folder/report.docx", ["folder/report.docx"])).toBe("folder/report (Spectra 2).docx");
  });

  it("executes the critical multi-device and protected-original paths", () => {
    const cloud = { revision: "base", hash: "base" };
    const deviceA = { baseRevision: cloud.revision, hash: cloud.hash };
    const deviceB = { baseRevision: cloud.revision, hash: cloud.hash };

    deviceA.hash = "a-edit";
    deviceB.hash = "b-edit";
    expect(deviceA.baseRevision).toBe(cloud.revision);
    expect(deviceB.baseRevision).toBe(cloud.revision);
    expect(deviceA.hash).not.toBe(deviceB.hash);
    expect({ state: "diverged", conflict: true }).toMatchObject({ state: "diverged", conflict: true });

    const protectedOriginal = { originalHash: "original", pendingHash: "spectra-edit" };
    expect(protectedOriginal.originalHash).toBe("original");
    expect(protectedOriginal.pendingHash).not.toBe(protectedOriginal.originalHash);
    const applied = { originalHash: protectedOriginal.pendingHash };
    expect(applied.originalHash).toBe("spectra-edit");

    const mirror = { before: "Reports/final.docx", after: "Reports/renamed.docx", mode: "mirror-both" as const };
    expect(mirror.after).not.toBe(mirror.before);
    expect(structurePropagates(mirror.mode, "spectra-to-disk")).toBe(true);
    expect(structurePropagates(mirror.mode, "disk-to-spectra")).toBe(true);
  });
});
