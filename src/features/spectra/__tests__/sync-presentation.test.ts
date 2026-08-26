import { describe, expect, it } from "vitest";
import {
  isPresentationReady,
  presentSync,
  replicaDisclosure,
  selectSyncTruth,
} from "../bridge/status";

describe("sync presentation (P1.I3)", () => {
  it("treats saved-locally as ready so a verified device copy does not block checkpoints", () => {
    const presentation = presentSync({
      replicas: [{ kind: "local", state: "current", lastVerifiedAt: 1 }],
      openConflictCount: 0,
      replicaPendingCount: 0,
      online: true,
    });
    expect(presentation.key).toBe("saved-locally");
    expect(presentation.label).toBe("Saved locally");
    expect(presentation.ready).toBe(true);
    expect(isPresentationReady(presentation.key)).toBe(true);
  });

  it("speaks Offline when the browser is offline even with nothing queued", () => {
    const presentation = presentSync({
      replicas: [{ kind: "cloud", state: "current", lastVerifiedAt: 1 }],
      openConflictCount: 0,
      replicaPendingCount: 0,
      online: false,
    });
    expect(presentation.key).toBe("offline");
    expect(presentation.label).toBe("Offline");
    expect(presentation.ready).toBe(false);
  });

  it("counts dirty work as queued while offline", () => {
    const presentation = presentSync({
      replicas: [{ kind: "cloud", state: "current", lastVerifiedAt: 1 }],
      openConflictCount: 0,
      replicaPendingCount: 0,
      online: false,
      dirty: true,
    });
    expect(presentation.label).toBe("Offline · 1 change");
  });

  it("says Edit conflict when copies diverged with no open conflict rows", () => {
    expect(
      selectSyncTruth({
        replicas: [{ kind: "cloud", state: "diverged" }],
        openConflictCount: 0,
        pendingCount: 0,
      }).label,
    ).toBe("Edit conflict");
    expect(
      presentSync({
        replicas: [{ kind: "local", state: "diverged" }],
        openConflictCount: 0,
        replicaPendingCount: 0,
        online: true,
      }).label,
    ).toBe("Edit conflict");
  });

  it("never puts a machine error code in the spoken detail", () => {
    const presentation = presentSync({
      replicas: [
        {
          kind: "local",
          state: "error",
          errorCode: "LOCAL_REPLICA_UNAVAILABLE",
        },
      ],
      openConflictCount: 0,
      replicaPendingCount: 0,
      online: true,
    });
    expect(presentation.detail).not.toMatch(/LOCAL_REPLICA_UNAVAILABLE/);
    expect(presentation.detail).not.toMatch(/[A-Z]{3,}_[A-Z0-9_]{3,}/);
  });

  it("discloses copies in plain words without Current", () => {
    const lines = replicaDisclosure(
      [{ kind: "local", state: "current", lastVerifiedAt: Date.now() }],
      Date.now(),
    );
    expect(lines.join(" ")).not.toMatch(/\bCurrent\b/);
    expect(lines[0]).toContain("This device · Up to date");
  });
});
