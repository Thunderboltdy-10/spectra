import { describe, expect, it } from "vitest";
import { latestNativeWritePerReplica } from "../ai/native-write-status";

describe("latest native write status", () => {
  it("uses the replacement request instead of an intentionally superseded write", () => {
    const latest = latestNativeWritePerReplica(
      [
        {
          direction: "cloud-to-local",
          state: "pending",
          errorCode: "office-locked",
          replicaId: "local-a",
          createdAt: 20,
          updatedAt: 25,
        },
        {
          direction: "cloud-to-local",
          state: "failed",
          errorCode: "superseded-by-newer-cloud-revision",
          replicaId: "local-a",
          createdAt: 10,
          updatedAt: 24,
        },
      ],
      ["local-a"],
    );

    expect(latest).toEqual([
      expect.objectContaining({
        state: "pending",
        errorCode: "office-locked",
        replicaId: "local-a",
      }),
    ]);
  });

  it("keeps a current failed write visible and scopes it to local replicas", () => {
    const latest = latestNativeWritePerReplica(
      [
        {
          direction: "external",
          state: "failed",
          replicaId: "local-a",
          createdAt: 40,
        },
        {
          direction: "cloud-to-local",
          state: "failed",
          errorCode: "readback-revision-mismatch",
          replicaId: "local-a",
          createdAt: 30,
        },
        {
          direction: "cloud-to-local",
          state: "verified",
          replicaId: "other-device",
          createdAt: 50,
        },
      ],
      ["local-a"],
    );

    expect(latest).toEqual([
      expect.objectContaining({
        state: "failed",
        errorCode: "readback-revision-mismatch",
        replicaId: "local-a",
      }),
    ]);
  });

  it("uses update time to break same-millisecond operation ties", () => {
    const latest = latestNativeWritePerReplica(
      [
        {
          direction: "cloud-to-local",
          state: "failed",
          replicaId: "local-a",
          createdAt: 10,
          updatedAt: 30,
        },
        {
          direction: "cloud-to-local",
          state: "pending",
          replicaId: "local-a",
          createdAt: 10,
          updatedAt: 40,
        },
      ],
      ["local-a"],
    );

    expect(latest[0]?.state).toBe("pending");
  });
});
