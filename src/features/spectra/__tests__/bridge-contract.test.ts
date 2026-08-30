import { describe, expect, it } from "vitest";
import { bridgeConnectionState, parseBridgeHealth, protocolMajor } from "../bridge/client";
import { replicaDisclosure, selectSyncTruth } from "../bridge/status";
import { POLICY_PRESETS } from "../../../../convex/syncPolicy";
import fs from "node:fs";
import path from "node:path";

describe("N3 Bridge contract", () => {
  it("shows an update-required state on a protocol-major mismatch", () => {
    expect(protocolMajor("1.4")).toBe(1);
    expect(bridgeConnectionState({ version: "0.1", paired: true, protocolVersion: "2.0", port: 47615 })).toBe("update-required");
    expect(
      parseBridgeHealth({
        version: "0.2",
        paired: true,
        protocolVersion: "1.0",
        port: 47615,
        newerField: "ignored",
      })?.protocolVersion,
    ).toBe("1.0");
  });

  it("does not call a locally paired Bridge connected until its authenticated status is available", () => {
    expect(bridgeConnectionState({ version: "0.1", paired: true, protocolVersion: "1.0", port: 47615 })).toBe("connected");
  });

  it("keeps the native session resumable without another pairing code", () => {
    const server = fs.readFileSync(path.join(process.cwd(), "bridge/bridge-core/src/server.rs"), "utf8");
    expect(server).toContain("/v1/session/resume");
    expect(server).toContain("resume_session");
    expect(fs.readFileSync(path.join(process.cwd(), "src/features/spectra/bridge/client.ts"), "utf8")).toContain("session/resume");
  });

  it("selects one truthful vocabulary for cloud, local, conflict and pending states", () => {
    const now = Date.now();
    expect(selectSyncTruth({ replicas: [{ kind: "cloud", state: "current", lastVerifiedAt: now }], openConflictCount: 0, pendingCount: 0 }).label).toBe("Saved");
    expect(selectSyncTruth({ replicas: [{ kind: "local", state: "current", lastVerifiedAt: now }], openConflictCount: 0, pendingCount: 0 }).label).toBe("Saved locally");
    expect(selectSyncTruth({ replicas: [{ kind: "local", state: "current", lastVerifiedAt: now }, { kind: "cloud", state: "current", lastVerifiedAt: now }], openConflictCount: 0, pendingCount: 0 }).label).toBe("Synced");
    expect(selectSyncTruth({ replicas: [], openConflictCount: 1, pendingCount: 0 }).label).toBe("1 conflict");
    expect(selectSyncTruth({ replicas: [{ kind: "cloud", state: "diverged" }], openConflictCount: 0, pendingCount: 0 }).label).toBe("Edit conflict");
    expect(selectSyncTruth({ replicas: [], openConflictCount: 0, pendingCount: 1 }).label).toBe("Saving…");
    expect(replicaDisclosure([{ kind: "local", state: "current", lastVerifiedAt: now }], now)[0]).toContain("This device · Up to date");
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

  it("restores mirror-to-disk files through the verified write journal", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "convex/bridgeSync.ts"), "utf8");
    expect(source).toContain("decideMissingResourceAction(policy.structure");
    expect(source).toContain("actorKind: \"restore\"");
    expect(source).toContain("unavailableReason: \"restoring-from-cloud\"");
    expect(source).toContain("const idempotencyKey = await deriveSyncIdempotencyKey({");
    expect(source).toContain('direction: "cloud-to-local"');
    expect(source).toContain("targetRevision: cloud.contentHash");
  });

  it("keeps recovery payloads until F6 local verification completes", () => {
    const replicas = fs.readFileSync(path.join(process.cwd(), "convex/replicas.ts"), "utf8");
    const completeWrite = fs.readFileSync(path.join(process.cwd(), "convex/bridgeSync.ts"), "utf8");
    expect(replicas).not.toContain("if (!createdLocal) await ctx.db.patch(cloud._id, { payloadRef: undefined");
    expect(completeWrite).toContain(
      'if (strategyTransition.toPreset === "device" || strategyTransition.toPreset === "linked")',
    );
    expect(completeWrite).toContain("payloadRef: undefined");
  });

  it("replays abandoned cloud and structure claims instead of stranding them", () => {
    const writes = fs.readFileSync(path.join(process.cwd(), "convex/bridgeSync.ts"), "utf8");
    const structure = fs.readFileSync(path.join(process.cwd(), "convex/bridgeStructure.ts"), "utf8");
    expect(writes).toContain("const abandonedClaims = await ctx.db.query(\"bridgeWriteRequests\")");
    expect(writes).toContain("q.lt(q.field(\"claimedAt\"), now - 60_000)");
    expect(structure).toContain("const abandoned = await ctx.db.query(\"bridgeFsRequests\")");
    expect(structure).toContain("q.lt(q.field(\"claimedAt\"), now - 60_000)");
  });

  it("turns a concurrent device revision into a conflict, never last-write-wins", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "convex/bridgeSync.ts"), "utf8");
    expect(source).toContain("cloudChangedSinceReplicaBase");
    expect(source).toContain("state: \"diverged\"");
    expect(source).toContain("state: \"conflicted\"");
    expect(source).toContain("await ctx.db.insert(\"syncConflicts\"");
  });

  it("validates a protected baseline before discarding any pending state", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "convex/replicas.ts"), "utf8");
    const validation = source.indexOf("if (changed && (work.protectedBaseContent === undefined || !work.protectedBaseContentHash))");
    const firstReplicaPatch = source.indexOf("await Promise.all(locals.filter((replica) => replica.pendingPayloadRef)", validation);
    expect(validation).toBeGreaterThan(-1);
    expect(firstReplicaPatch).toBeGreaterThan(validation);
  });
});
