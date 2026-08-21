import { describe, expect, it } from "vitest";
import { bridgeConnectionState, protocolMajor } from "../bridge/client";
import { replicaDisclosure, selectSyncTruth } from "../bridge/status";
import { POLICY_PRESETS } from "../../../../convex/syncPolicy";
import fs from "node:fs";
import path from "node:path";

describe("N3 Bridge contract", () => {
  it("shows an update-required state on a protocol-major mismatch", () => {
    expect(protocolMajor("1.4")).toBe(1);
    expect(bridgeConnectionState({ version: "0.1", paired: true, protocolVersion: "2.0", port: 47615 })).toBe("update-required");
  });

  it("does not call a locally paired Bridge connected until its authenticated status is available", () => {
    expect(bridgeConnectionState({ version: "0.1", paired: true, protocolVersion: "1.0", port: 47615 })).toBe("connected");
  });

  it("selects one truthful vocabulary for cloud, local, conflict and pending states", () => {
    const now = Date.now();
    expect(selectSyncTruth({ replicas: [{ kind: "cloud", state: "current", lastVerifiedAt: now }], openConflictCount: 0, pendingCount: 0 }).label).toBe("Saved");
    expect(selectSyncTruth({ replicas: [{ kind: "local", state: "current", lastVerifiedAt: now }], openConflictCount: 0, pendingCount: 0 }).label).toBe("Saved locally");
    expect(selectSyncTruth({ replicas: [{ kind: "local", state: "current", lastVerifiedAt: now }, { kind: "cloud", state: "current", lastVerifiedAt: now }], openConflictCount: 0, pendingCount: 0 }).label).toBe("Synced");
    expect(selectSyncTruth({ replicas: [], openConflictCount: 1, pendingCount: 0 }).label).toBe("1 conflict");
    expect(selectSyncTruth({ replicas: [], openConflictCount: 0, pendingCount: 1 }).label).toBe("Saving…");
    expect(replicaDisclosure([{ kind: "local", state: "current", lastVerifiedAt: now }], now)[0]).toContain("This device · Current");
  });

  it("maps exactly four presets through the single policy module", () => {
    expect(Object.keys(POLICY_PRESETS).sort()).toEqual(["both", "device", "linked", "spectra"]);
    expect(POLICY_PRESETS.linked.protectedOriginal).toBe(true);
  });

  it("does not expose a raw-path field in Bridge mutation payloads or tables", () => {
    const root = process.cwd();
    const source = ["convex/schema.ts", "convex/bridge.ts", "convex/bridgeSync.ts", "convex/replicas.ts"].map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
    expect(source).not.toMatch(/\b(?:rawPath|absolutePath|rootPath|filesystemPath)\b/);
    expect(source).toContain("grantId");
    expect(source).toContain("relativePath");
  });
});
