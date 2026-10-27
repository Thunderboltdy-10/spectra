import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  STORAGE_TOGGLES,
  consequenceFor,
  formatMountProgress,
  isProtectedOriginalPreset,
  isProtectedOriginalWork,
  mountCountTruth,
  policyPresetFromToggles,
  spectraConsequence,
  storageChoiceFromPreset,
} from "../bridge/sync-toggles";
import {
  interpretHealthPayload,
  pairingFailureMessage,
  parseBridgeHealth,
  presentBridgeReachability,
  bridgeReachabilityCopy,
  folderChipLabel,
} from "../bridge/client";
import { locationLabel, presentSync } from "../bridge/status";
import {
  humanizePublicFailure,
  isCloudDiscoveryFailure,
} from "../bridge/humanize";

const settings = ["devices-page.tsx", "device-card.tsx", "native-writes-choice.tsx", "devices-model.ts"]
  .map((file) => fs.readFileSync(path.join(process.cwd(), "src/features/spectra/devices", file), "utf8"))
  .join("\n");
const resource = fs.readFileSync(
  path.join(process.cwd(), "src/features/spectra/bridge/resource-surface.tsx"),
  "utf8",
);
const storage = fs.readFileSync(
  path.join(process.cwd(), "src/features/spectra/bridge/file-storage-controls.tsx"),
  "utf8",
);
const studio = fs.readFileSync(
  path.join(process.cwd(), "src/features/spectra/components/artifact-studio.tsx"),
  "utf8",
);
const healthHook = fs.readFileSync(
  path.join(process.cwd(), "src/features/spectra/bridge/use-bridge.ts"),
  "utf8",
);
const bridgeClient = fs.readFileSync(
  path.join(process.cwd(), "src/features/spectra/bridge/client.ts"),
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
    expect(
      isProtectedOriginalWork({
        preset: "both",
        replicas: [{ kind: "local", protectedOriginal: true }],
      }),
    ).toBe(true);
    expect(
      isProtectedOriginalWork({
        preset: "linked",
        replicas: [{ kind: "local", protectedOriginal: false }],
      }),
    ).toBe(true);
    expect(
      isProtectedOriginalWork({
        preset: "both",
        replicas: [{ kind: "local", protectedOriginal: false }],
      }),
    ).toBe(false);
  });

  it("exposes Read, don't change on native studios, resource files, and Devices", () => {
    expect(storage).toContain("showProtected");
    expect(storage).toContain("onProtectedChange");
    expect(resource).toContain("FileStorageControls");
    expect(studio).toContain("FileStorageControls");
    expect(studio).toContain("isProtectedOriginalWork");
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
    ).toContain("answered in Bridge's place");
    expect(pairingFailureMessage("Failed to fetch")).not.toMatch(/Failed to fetch/i);
    expect(
      pairingFailureMessage("Failed to fetch", { kind: "not-running" }, false),
    ).toContain("offline");
    expect(
      pairingFailureMessage("Failed to fetch", { kind: "not-running" }, false),
    ).not.toMatch(/Not running/i);
  });

  it("does not call a running unpaired Bridge Not running", () => {
    const health = parseBridgeHealth({
      version: "0.2",
      paired: true,
      protocolVersion: "1.0",
      port: 47615,
    });
    expect(health).not.toBeNull();
    const running = presentBridgeReachability({
      online: true,
      discovery: { kind: "running", health: health! },
      sessionPaired: false,
    });
    expect(running).toBe("running");
    expect(bridgeReachabilityCopy(running).label).toBe("Not connected");
    expect(bridgeReachabilityCopy(running).label).not.toBe("Not running");
    expect(
      presentBridgeReachability({
        online: false,
        discovery: { kind: "not-running" },
        sessionPaired: false,
      }),
    ).toBe("offline");
    expect(bridgeReachabilityCopy("offline").label).toBe("Offline");
    expect(
      presentBridgeReachability({
        online: true,
        discovery: { kind: "not-running" },
        sessionPaired: false,
      }),
    ).toBe("not-running");
    expect(bridgeReachabilityCopy("not-running").label).toBe("Not running");
    expect(folderChipLabel({
      state: "disconnected",
      discoveryFailed: false,
      reachability: "offline",
    })).toBe("Offline");
    expect(folderChipLabel({
      state: "disconnected",
      discoveryFailed: false,
      reachability: "running",
    })).toBe("Not connected");
    expect(folderChipLabel({
      state: "disconnected",
      discoveryFailed: true,
      reachability: "offline",
    })).not.toBe("Waiting for Bridge");
    expect(folderChipLabel({
      state: "disconnected",
      discoveryFailed: false,
      reachability: "not-running",
    })).toBe("Waiting for Bridge");
    expect(folderChipLabel({
      state: "waiting",
      discoveryFailed: false,
      reachability: "connected",
    })).toBe("Waiting to retry");
    expect(folderChipLabel({
      state: "waiting",
      discoveryFailed: false,
      reachability: "connected",
    })).not.toBe("Waiting for Bridge");
  });

  it("speaks listing failures as unavailable-truth, never Convex jargon", () => {
    const convexMiss =
      "Could not find public function for 'bridgeSync:discoverResourcesPage'. Request ID: abc-123";
    expect(isCloudDiscoveryFailure(convexMiss)).toBe(true);
    expect(humanizePublicFailure(convexMiss)).toContain(
      "could not list files",
    );
    expect(humanizePublicFailure(convexMiss)).not.toMatch(
      /discoverResourcesPage|Request ID|bridgeSync:/i,
    );
    expect(
      humanizePublicFailure(
        "Selected on this device. Provider-managed folder detected; conflict windows may be wider.",
      ),
    ).toContain("managed by another program");
    expect(humanizePublicFailure(convexMiss)).not.toContain("Needs attention");
    expect(
      folderChipLabel({
        state: "error",
        discoveryFailed: true,
        reachability: "connected",
      }),
    ).toBe("Waiting for Spectra");
    expect(humanizePublicFailure("AUTH_OPERATOR_MANAGE_REQUIRED: Re-enter this school with manage access.")).toContain(
      "read-only",
    );
    expect(
      humanizePublicFailure(
        "AUTH_OPERATOR_MANAGE_REQUIRED: Re-enter this school with manage access.",
      ),
    ).not.toMatch(/AUTH_OPERATOR_MANAGE_REQUIRED/);
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
    expect(settings).toContain("Remove this device");
    expect(settings).toContain("revokeDevice");
    expect(settings).toContain("forgetSession");
    expect(healthHook).toContain("clearBridgeSession");
    expect(healthHook).toContain("clearBridgeStatusCache");
    expect(healthHook).toContain('addEventListener("storage"');
    expect(settings).toContain("onClick");
  });

  it("exits Disconnecting without waiting on a hung Bridge refresh", () => {
    const disconnect = settings.slice(
      settings.indexOf("async function confirmAction"),
      settings.indexOf("const connecting ="),
    );
    expect(disconnect).toContain("forgetSession");
    expect(disconnect).toContain("void local.refresh()");
    expect(disconnect).not.toContain("await local.refresh()");
    expect(bridgeClient).toContain("BRIDGE_REQUEST_TIMEOUT_MS");
    expect(bridgeClient).toContain("bridgeRequestSignal");
  });

  it("makes Location agree with the replica list", () => {
    expect(
      locationLabel([
        { kind: "local", state: "current" },
        { kind: "cloud", state: "unavailable" },
      ]),
    ).toBe("This device");
    expect(
      locationLabel([
        { kind: "local", state: "current" },
        { kind: "cloud", state: "unavailable" },
      ]),
    ).not.toBe("This device + Spectra");
    expect(
      locationLabel([
        { kind: "local", state: "unavailable" },
        { kind: "cloud", state: "current" },
      ]),
    ).toBe("Spectra");
    expect(
      locationLabel([
        { kind: "local", state: "current" },
        { kind: "cloud", state: "current" },
      ]),
    ).toBe("This device + Spectra");
    expect(resource).toContain("presentation.disclosure");
  });

  it("prints the storage-change failure sentence once", () => {
    expect(humanizePublicFailure("strategy-transition-failed")).toBe(
      "The last storage change did not finish. The file on this computer was not removed.",
    );
    expect(storage).toMatch(
      /humanizePublicFailure\(\s*strategyTransition\.errorCode\s*\?\?\s*"strategy-transition-failed",?\s*\)/,
    );
    expect(storage).not.toContain("The last storage change did not finish. {humanizePublicFailure");
  });
});
