import { describe, expect, it } from "vitest";
import {
  BRIDGE_TRUST_OPTIONS,
  bridgePolicyForTrustPreset,
  bridgeTrustPresetForPolicy,
} from "../../../../shared/bridge-trust";
import { POLICY_PRESETS } from "../../../../shared/sync-policy";
import { appCommandById } from "../commands/app-registry";
import { createApplicationCommandDispatcher } from "../commands/application-dispatcher";
import { spectraBus } from "../events";
import { DEFAULT_SPECTRA_PREFERENCES } from "../settings/schema";
import {
  bridgeReachabilityCopy,
  pairingFailureMessage,
  presentBridgeReachability,
} from "../bridge/client";

describe("browser-first Bridge trust contract", () => {
  it("maps the safe and native presets to the existing server policies", () => {
    expect(bridgePolicyForTrustPreset("managed-copy")).toEqual(
      POLICY_PRESETS.spectra,
    );
    expect(bridgePolicyForTrustPreset("native-sync")).toEqual(
      POLICY_PRESETS.both,
    );
    expect(
      BRIDGE_TRUST_OPTIONS.find((option) => option.id === "native-sync")
        ?.requiresNativeWriteConfirmation,
    ).toBe(true);
  });

  it("keeps custom policy fields visible instead of collapsing them into a nearby preset", () => {
    expect(bridgeTrustPresetForPolicy(POLICY_PRESETS.spectra)).toBe(
      "managed-copy",
    );
    expect(bridgeTrustPresetForPolicy(POLICY_PRESETS.both)).toBe("native-sync");
    expect(
      bridgeTrustPresetForPolicy({
        ...POLICY_PRESETS.both,
        structure: "ask",
        includeGlobs: ["**/*.docx"],
        protectedOriginal: true,
      }),
    ).toBe("advanced");
  });

  it("keeps setup, retry, and policy actions available through the typed app path", async () => {
    expect(appCommandById("app.bridge.setup")?.aiAuthority).toBe("allowed");
    expect(appCommandById("app.bridge.pair")?.aiAuthority).toBe("prohibited");
    expect(appCommandById("app.bridge.policy.change")?.aiAuthority).toBe(
      "prohibited",
    );

    const calls: Array<string> = [];
    const removers = [
      spectraBus.handle("bridge.setup", ({ action }) => {
        calls.push(`setup:${action}`);
      }),
      spectraBus.handle("bridge.policy.change", ({ preset }) => {
        calls.push(`policy:${preset}`);
      }),
    ];
    try {
      const dispatch = createApplicationCommandDispatcher({
        openArtifact: () => {},
        navigate: () => {},
        replacePreferences: () => {},
        preferences: DEFAULT_SPECTRA_PREFERENCES,
      });
      await dispatch("app.bridge.setup", { action: "retry-connection" });
      await dispatch("app.bridge.policy.change", { preset: "native-sync" });
      await expect(
        dispatch("app.bridge.setup", { action: "retry-folder" }),
      ).rejects.toThrow("requires grantId");
      expect(calls).toEqual(["setup:retry-connection", "policy:native-sync"]);
    } finally {
      for (const remove of removers) remove();
    }
  });

  it("gives a truthful browser recovery message for every launch state", () => {
    expect(
      presentBridgeReachability({
        online: true,
        discovery: {
          kind: "running",
          health: { version: "0.1", paired: false, protocolVersion: "1.0" },
        },
        sessionPaired: false,
      }),
    ).toBe("running");
    expect(bridgeReachabilityCopy("not-running").label).toBe("Not running");
    expect(bridgeReachabilityCopy("update-required").detail).toContain(
      "too old",
    );
    expect(
      pairingFailureMessage("PAIRING_CHALLENGE_INVALID", {
        kind: "running",
        health: { version: "0.1", paired: false, protocolVersion: "1.0" },
      }),
    ).toContain("could not");
    expect(pairingFailureMessage("ignored", { kind: "not-running" })).toContain(
      "not running",
    );
  });
});
