import { describe, expect, it } from "vitest";
import { chooseReplicaContinuity } from "../../../../convex/bridgeIdentity";

describe("Bridge Office-save identity continuity", () => {
  it("keeps the established cloud-backed work", () => {
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
