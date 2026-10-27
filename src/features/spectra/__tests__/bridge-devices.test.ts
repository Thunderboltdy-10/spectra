import { describe, expect, it } from "vitest";
import { appCommandById } from "../commands/app-registry";
import {
  bridgeReachabilityCopy,
  pairingFailureMessage,
  presentBridgeReachability,
} from "../bridge/client";

describe("Bridge on the Devices page", () => {
  it("keeps every Devices action a registered app command, with connecting asked first", () => {
    for (const id of ["app.devices.open", "app.devices.pair", "app.devices.add-folder", "app.devices.add-files", "app.devices.pause"])
      expect(appCommandById(id), id).toBeTruthy();
    expect(appCommandById("app.devices.pair")?.risk).toBe("confirm");
    for (const id of ["app.bridge.setup", "app.bridge.pair", "app.bridge.policy.change", "app.bridge.open-settings"])
      expect(appCommandById(id), id).toBeUndefined();
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
