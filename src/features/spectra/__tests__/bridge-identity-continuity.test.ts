import { describe, expect, it } from "vitest";
import {
  activeReplicaWriteTarget,
  chooseLiveBridgeDeviceId,
  chooseLiveLocalReplica,
  chooseReplicaContinuity,
  latestActiveWriteForReplica,
} from "../../../../convex/bridgeIdentity";

describe("Bridge Office-save identity continuity", () => {
  it("keeps the established cloud-backed artifact", () => {
    expect(chooseReplicaContinuity([
      { value: "duplicate", creationTime: 20, hasCloudReplica: false },
      { value: "established", creationTime: 10, hasCloudReplica: true },
    ])).toBe("established");
  });

  it("uses the oldest local path occupant when neither has cloud state", () => {
    expect(chooseReplicaContinuity([
      { value: "replacement", creationTime: 20, hasCloudReplica: false },
      { value: "original", creationTime: 10, hasCloudReplica: false },
    ])).toBe("original");
  });
});

describe("replica-scoped Bridge writes", () => {
  it("never chains a device write from another replica's pending revision", () => {
    const requests = [
      { replicaId: "local-a", state: "pending", createdAt: 10, targetRevision: "a2" },
      { replicaId: "local-b", state: "claimed", createdAt: 20, targetRevision: "b2" },
      { replicaId: "local-a", state: "verified", createdAt: 30, targetRevision: "a3" },
    ];
    expect(latestActiveWriteForReplica(requests, "local-a")?.targetRevision).toBe("a2");
    expect(latestActiveWriteForReplica(requests, "local-b")?.targetRevision).toBe("b2");
  });

  it("requires the replica, mount, and device to remain active and aligned", () => {
    const replica = { accountId: "account", deviceId: "device", mountId: "mount", state: "current" };
    const mount = { _id: "mount", accountId: "account", deviceId: "device", state: "active" };
    const device = { accountId: "account", state: "active" };
    expect(activeReplicaWriteTarget(replica, mount, device)).toBe(true);
    expect(activeReplicaWriteTarget({ ...replica, state: "unavailable" }, mount, device)).toBe(false);
    expect(activeReplicaWriteTarget(replica, { ...mount, state: "detached" }, device)).toBe(false);
    expect(activeReplicaWriteTarget(replica, mount, { ...device, state: "revoked" })).toBe(false);
    expect(activeReplicaWriteTarget({ ...replica, deviceId: "other" }, mount, device)).toBe(false);
    expect(activeReplicaWriteTarget(replica, { ...mount, _id: "other" }, device)).toBe(false);
  });
});

describe("live Bridge write targeting", () => {
  it("writes the live device replica instead of a silent leftover device", () => {
    const now = 1_000_000;
    const liveId = chooseLiveBridgeDeviceId(
      [
        { _id: "silent", state: "active", lastSeenAt: now - 30 * 60_000 },
        { _id: "live", state: "active", lastSeenAt: now - 1_000 },
      ],
    );
    expect(liveId).toBe("live");
    expect(
      chooseLiveLocalReplica(
        [
          {
            _id: "ghost",
            deviceId: "silent",
            state: "current",
            relativePath: "xlsx-run3/IA Data Collection.xlsx",
            updatedAt: now,
          },
          {
            _id: "here",
            deviceId: "live",
            state: "current",
            relativePath: "xlsx-run3/IA Data Collection.xlsx",
            updatedAt: now - 10,
          },
        ],
        liveId,
        "ghost",
      )?._id,
    ).toBe("here");
  });

  it("does not retarget onto a different relative path", () => {
    expect(
      chooseLiveLocalReplica(
        [
          {
            _id: "ghost",
            deviceId: "silent",
            state: "current",
            relativePath: "xlsx-run3/IA Data Collection.xlsx",
          },
          {
            _id: "physics",
            deviceId: "live",
            state: "current",
            relativePath: "Physics/IA Data Collection.xlsx",
          },
        ],
        "live",
        "ghost",
      )?._id,
    ).toBeUndefined();
  });

  it("refuses to queue when no Bridge has heartbeated recently", () => {
    expect(
      chooseLiveBridgeDeviceId(
        [{ _id: "silent", state: "revoked", lastSeenAt: 1 }],
      ),
    ).toBeUndefined();
  });

  it("still selects the newest active device after a long Convex gap", () => {
    expect(
      chooseLiveBridgeDeviceId(
        [
          { _id: "ghost", state: "active", lastSeenAt: 1 },
          { _id: "live", state: "active", lastSeenAt: 50_000 },
        ],
      ),
    ).toBe("live");
  });
});
