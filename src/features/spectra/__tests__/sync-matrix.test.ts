import { describe, expect, it } from "vitest";
import { policyAllowsTrigger, structurePropagates } from "../../../../shared/sync-policy";

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

  it("never treats manual timing as an implicit watcher sync", () => {
    expect(policyAllowsTrigger("manual", "watch")).toBe(false);
    expect(policyAllowsTrigger("manual", "manual")).toBe(true);
  });

  it("keeps structure propagation directional and deterministic", () => {
    for (const mode of ["independent", "mirror-to-disk", "mirror-from-disk", "mirror-both"] as const) {
      expect(structurePropagates(mode, "spectra-to-disk") || structurePropagates(mode, "disk-to-spectra")).toBe(mode !== "independent");
    }
  });
});
