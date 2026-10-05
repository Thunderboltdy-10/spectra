// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeStatus } from "../../bridge/client";
import type { CloudOverview } from "../devices-model";
import { createPairing, type Pairing } from "../pairing";

const NOW = Date.now();

const h = vi.hoisted(() => ({
  local: null as unknown as Record<string, unknown>,
  cloud: null as unknown,
  requestPairing: vi.fn(),
  revokeDevice: vi.fn(),
  overrideAccount: vi.fn(),
  updatePreferences: vi.fn(),
  runLocalDeviceAction: vi.fn(),
  unpairBridge: vi.fn(),
  pairing: null as unknown as Pairing,
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: (ref: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    const name = String((ref as { _name?: string })?._name ?? ref);
    return /syncPolicy/.test(name) ? { contentDirection: "manual" } : h.cloud;
  },
  useMutation: (ref: unknown) => {
    const name = String((ref as { _name?: string })?._name ?? ref);
    if (/requestPairing/.test(name)) return h.requestPairing;
    if (/revokeDevice/.test(name)) return h.revokeDevice;
    return h.overrideAccount;
  },
}));
vi.mock("../../../../../convex/_generated/api", () => {
  const ref = (name: string) => ({ _name: name });
  return {
    api: {
      bridge: { overview: ref("bridge:overview"), requestPairing: ref("bridge:requestPairing"), revokeDevice: ref("bridge:revokeDevice") },
      syncPolicy: { effective: ref("syncPolicy:effective"), overrideAccount: ref("syncPolicy:overrideAccount") },
    },
  };
});
vi.mock("../../bridge/use-bridge", () => ({ useBridgeHealth: () => h.local }));
vi.mock("../../bridge/client", async (original) => ({
  ...(await original<typeof import("../../bridge/client")>()),
  unpairBridge: h.unpairBridge,
}));
vi.mock("../../settings/preference-store", async () => {
  const { DEFAULT_SPECTRA_PREFERENCES } = await import("../../settings/schema");
  return { useSpectraPreferences: () => ({ preferences: DEFAULT_SPECTRA_PREFERENCES, update: h.updatePreferences }) };
});
vi.mock("../device-actions", () => ({ runLocalDeviceAction: h.runLocalDeviceAction }));
vi.mock("../pairing", async (original) => ({
  ...(await original<typeof import("../pairing")>()),
  devicePairing: () => h.pairing,
}));

import { DevicesPage } from "../devices-page";

function status(overrides: Partial<BridgeStatus> = {}): BridgeStatus {
  return {
    version: "1.4.0",
    protocolVersion: "1.0",
    paired: true,
    cloudConnected: true,
    deviceId: "device-here",
    deviceName: "Pablo's laptop",
    paused: false,
    lastSyncAt: NOW - 60_000,
    mounts: [
      { id: "grant_a", label: "Biology", state: "active", detail: "Up to date", synced: 4, total: 4, doubleSyncRisk: false, friendlyPath: "Documents › Biology", paused: false, lastSyncAt: NOW },
    ],
    officeFiles: [],
    ...overrides,
  } as BridgeStatus;
}

const cloud: CloudOverview = {
  devices: [
    { _id: "device-here", name: "Pablo's laptop", platform: "windows", appVersion: "1.4.0", protocolVersion: "1.0", lastSeenAt: NOW, state: "active" },
    { _id: "device-desk", name: "Desk PC", platform: "windows", appVersion: "1.4.0", protocolVersion: "1.0", lastSeenAt: NOW, state: "active" },
  ],
  mounts: [{ grantId: "grant_a", deviceId: "device-here", rootLabel: "Biology", state: "active", fileCount: 4 }],
};

function bridge(paired: boolean) {
  return {
    online: true,
    reachability: paired ? "connected" : "not-set-up",
    status: paired ? status() : null,
    discovery: { kind: paired ? "running" : "not-running" },
    refresh: vi.fn(async () => {}),
    forgetSession: vi.fn(),
  };
}

let pairingStatus: { paired: boolean; sessionToken?: string } = { paired: false };

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/devices");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  h.cloud = cloud;
  h.local = bridge(true);
  for (const mock of [h.requestPairing, h.revokeDevice, h.overrideAccount, h.updatePreferences, h.runLocalDeviceAction, h.unpairBridge]) mock.mockReset();
  h.runLocalDeviceAction.mockResolvedValue({ status: "completed", message: "Paused the folder." });
  h.requestPairing.mockResolvedValue({ challenge: "c1", shortCode: "K7Q2", expiresAt: NOW + 120_000 });
  pairingStatus = { paired: false };
  h.pairing = createPairing({
    discover: async () => ({ kind: "running", health: { version: "1.4.0", paired: false, protocolVersion: "1.0" } }) as never,
    offer: async () => {},
    status: async () => pairingStatus,
    persist: () => {},
    enableDiscovery: () => {},
    platform: () => "windows",
    origin: () => "https://spectra.test",
    now: () => Date.now(),
    wait: () => new Promise((resolve) => setTimeout(resolve, 5)),
  });
});
afterEach(() => {
  h.pairing.cancel();
  cleanup();
  vi.unstubAllGlobals();
});

describe("Devices page", () => {
  it("shows this computer and the other devices, with folder controls in Details", async () => {
    render(<DevicesPage />);
    expect(screen.getByText("This computer")).toBeTruthy();
    expect(screen.getByText("Other devices")).toBeTruthy();
    expect(screen.getAllByText("Pablo's laptop").length).toBeGreaterThan(0);
    expect(screen.getByText("Desk PC")).toBeTruthy();
    expect(screen.getByText("Documents › Biology")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pause Biology" }));
    await waitFor(() => expect(h.runLocalDeviceAction).toHaveBeenCalledWith({ action: "pause_folder", grantId: "grant_a" }));
    expect(await screen.findByText("Paused the folder.")).toBeTruthy();
  });

  it("asks before it stops using a folder", async () => {
    render(<DevicesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Biology" }));
    expect(h.runLocalDeviceAction).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Stop using it" }));
    await waitFor(() => expect(h.runLocalDeviceAction).toHaveBeenCalledWith({ action: "remove_folder", grantId: "grant_a" }));
  });

  it("says another computer's folders change on that computer", () => {
    render(<DevicesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Details for Desk PC" }));
    expect(screen.getByText("Change these folders in Spectra on that computer.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show logs" })).toBeNull();
  });

  it("connects this computer: the code shows on the page, then the row forms", async () => {
    h.local = bridge(false);
    h.cloud = { devices: [], mounts: [] };
    render(<DevicesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Connect this computer" }));
    expect(await screen.findByText("K7Q2")).toBeTruthy();
    expect(h.requestPairing).toHaveBeenCalledWith({ browserOrigin: "https://spectra.test" });
    pairingStatus = { paired: true, sessionToken: "token" };
    await waitFor(() => expect(h.local.refresh).toHaveBeenCalled());
    expect(screen.queryByText("K7Q2")).toBeNull();
  });

  it("starts connecting by itself when Spectra AI or the command bar asks", async () => {
    h.local = bridge(false);
    h.cloud = { devices: [], mounts: [] };
    render(<DevicesPage />);
    act(() => h.pairing.want());
    expect(await screen.findByText("K7Q2")).toBeTruthy();
  });

  it("starts connecting from ?connect=1", async () => {
    h.local = bridge(false);
    window.history.replaceState(null, "", "/devices?connect=1");
    render(<DevicesPage />);
    expect(await screen.findByText("K7Q2")).toBeTruthy();
    expect(window.location.search).toBe("");
  });

  it("removes this device: Spectra forgets it and Bridge unpairs", async () => {
    render(<DevicesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Remove this device" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent === "Remove")!);
    await waitFor(() => expect(h.revokeDevice).toHaveBeenCalledWith({ deviceId: "device-here" }));
    await waitFor(() => expect(h.local.forgetSession).toHaveBeenCalled());
    expect(h.unpairBridge).toHaveBeenCalled();
  });

  it("shows native writes for the account, Never by default", () => {
    render(<DevicesPage />);
    expect(screen.getByText("Applies to every device.", { exact: false })).toBeTruthy();
    expect(screen.getByText("Desktop files stay as they are. Changes stay in Spectra.")).toBeTruthy();
  });
});
