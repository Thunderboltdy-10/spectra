import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  STORAGE_TOGGLES,
  consequenceFor,
  formatMountProgress,
  isProtectedOriginalPreset,
  mountCountTruth,
  policyPresetFromToggles,
  spectraConsequence,
  storageChoiceFromPreset,
} from "../bridge/sync-toggles";
import {
  interpretHealthPayload,
  pairingFailureMessage,
  parseBridgeHealth,
} from "../bridge/client";
import { presentSync } from "../bridge/status";

const settings = fs.readFileSync(
  path.join(process.cwd(), "src/features/spectra/bridge/bridge-settings.tsx"),
  "utf8",
);
const resource = fs.readFileSync(
  path.join(process.cwd(), "src/features/spectra/bridge/resource-surface.tsx"),
  "utf8",
);

describe("sync toggles (P1.I4)", () => {
  it("exposes exactly the three storage choices and the protected original switch", () => {
    expect(STORAGE_TOGGLES.map((toggle) => toggle.choice)).toEqual([
      "device",
      "spectra",
      "both",
    ]);
    expect(STORAGE_TOGGLES.filter((toggle) => toggle.recommended)).toHaveLength(
      1,
    );
    expect(consequenceFor("device")).toContain("Lives on this PC");
    expect(consequenceFor("both")).toContain("The file on your PC stays a normal file");
    expect(spectraConsequence(false)).toContain("no file on this PC");
    expect(spectraConsequence(true)).toContain("stays on disk");
    expect(spectraConsequence(true)).not.toMatch(/delet/i);
  });

  it("maps the protected switch onto linked without a fourth equal storage radio", () => {
    expect(policyPresetFromToggles("both", false)).toBe("both");
    expect(policyPresetFromToggles("device", true)).toBe("linked");
    expect(policyPresetFromToggles("spectra", true)).toBe("spectra");
    expect(storageChoiceFromPreset("linked")).toBe("device");
    expect(isProtectedOriginalPreset("linked")).toBe(true);
  });

  it("never treats an offline folder as 0 of N", () => {
    expect(
      mountCountTruth({
        live: false,
        state: "disconnected",
        synced: 0,
        total: 16,
      }).kind,
    ).toBe("unavailable");
    expect(
      mountCountTruth({
        live: true,
        state: "active",
        synced: 12,
        total: 16,
      }),
    ).toEqual({ kind: "progress", synced: 12, total: 16 });
    expect(formatMountProgress(12, 16)).toBe("12 of 16 files");
    expect(settings).not.toContain("0 of");
    expect(settings).not.toMatch(/mirror-from-disk|cloudContent|on-save-open/);
  });

  it("keeps extra health fields from looking like a disconnect", () => {
    const health = parseBridgeHealth({
      version: "0.2",
      paired: true,
      protocolVersion: "1.0",
      port: 47615,
      extraFromNewerBridge: true,
    });
    expect(health?.paired).toBe(true);
    expect(
      interpretHealthPayload({
        networkFailed: true,
        httpOk: false,
        body: null,
      }).kind,
    ).toBe("not-running");
    expect(
      interpretHealthPayload({
        networkFailed: false,
        httpOk: true,
        body: "<html>printer admin</html>",
      }).kind,
    ).toBe("port-taken");
    expect(
      pairingFailureMessage("Failed to fetch", { kind: "not-running" }),
    ).toContain("not running");
    expect(
      pairingFailureMessage("Failed to fetch", { kind: "port-taken" }),
    ).toContain("Something else is using");
    expect(pairingFailureMessage("Failed to fetch")).not.toMatch(/Failed to fetch/i);
  });

  it("offers Reconnect when the replica is unavailable on this device", () => {
    const presentation = presentSync({
      replicas: [
        {
          kind: "local",
          state: "unavailable",
          unavailableReason: "device-revoked",
        },
      ],
      openConflictCount: 0,
      replicaPendingCount: 0,
      online: true,
    });
    expect(presentation.action).toEqual({
      label: "Reconnect",
      kind: "reconnect",
    });
    expect(resource).not.toContain("Open on device");
    expect(resource).not.toContain("Bridge can stream");
    expect(resource).not.toMatch(/Image preview/i);
    expect(settings).toContain("Update Bridge");
    expect(settings).toContain("onClick");
  });
});
