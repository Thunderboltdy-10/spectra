// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeStatus } from "../../bridge/client";
import type { CloudOverview } from "../devices-model";
import { createPairing, type Pairing } from "../pairing";
import { bindAccountStorageScope } from "@/lib/account-storage";

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
  useConvex: () => ({ query: vi.fn(async () => []) }),
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: (ref: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    const name = String((ref as { _name?: string })?._name ?? ref);
    if (/deviceWorks/.test(name)) return undefined;
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
      bridge: { syncedNodes: ref("bridge:syncedNodes"), overview: ref("bridge:overview"), requestPairing: ref("bridge:requestPairing"), revokeDevice: ref("bridge:revokeDevice") },
      catalogGraph: { identity: ref("catalogGraph:identity") },
      syncPolicy: { effective: ref("syncPolicy:effective"), overrideAccount: ref("syncPolicy:overrideAccount") },
      deviceWorks: { settings: ref("deviceWorks:settings"), counts: ref("deviceWorks:counts"), onThisComputer: ref("deviceWorks:onThisComputer"), movable: ref("deviceWorks:movable"), backupsToRestore: ref("deviceWorks:backupsToRestore"), choose: ref("deviceWorks:choose"), backupUploadUrl: ref("deviceWorks:backupUploadUrl"), recordBackup: ref("deviceWorks:recordBackup"), adoptRestored: ref("deviceWorks:adoptRestored"), deleteBackups: ref("deviceWorks:deleteBackups") },
    },
  };
});
vi.mock("../place-in-menu", () => ({ PlaceInMenu: ({ children }: { children: unknown }) => children }));
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
  bindAccountStorageScope("fixture-deployment/account-A");
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
  it("continues a Library file-selection request once after this computer connects", async () => {
    window.history.replaceState(null, "", "/devices?connect=1&select=files");
    h.local = bridge(false);
    const view = render(<DevicesPage />);
    await waitFor(() => expect(h.requestPairing).toHaveBeenCalled());
    expect(h.runLocalDeviceAction).not.toHaveBeenCalled();
    h.local = bridge(true);
    view.rerender(<DevicesPage />);
    await waitFor(() => expect(h.runLocalDeviceAction).toHaveBeenCalledWith({ action: "add_files" }));
    view.rerender(<DevicesPage />);
    expect(h.runLocalDeviceAction).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("");
  });
  it("offers native file selection and uses file-specific removal copy", async () => {
    h.local = { ...bridge(true), status: status({ mounts: [{ ...status().mounts[0], label: "Essay.docx", selectionKind: "file", friendlyPath: "Documents › Essay.docx" }] }) };
    render(<DevicesPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Add files" }).at(-1)!);
    await waitFor(() => expect(h.runLocalDeviceAction).toHaveBeenCalledWith({ action: "add_files" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop syncing Essay.docx" }));
    expect(screen.getByText("Stop using this file in Spectra?")).toBeTruthy();
    expect(screen.getByText(/The file stays on this computer/)).toBeTruthy();
  });
  it("shows one list of computers, this one marked, with its folder controls", async () => {
    render(<DevicesPage />);
    expect(screen.getByRole("heading", { name: "Your computers" })).toBeTruthy();
    expect(screen.getByText("This computer")).toBeTruthy();
    expect(screen.getAllByText("Pablo's laptop").length).toBeGreaterThan(0);
    expect(screen.getByText("Desk PC")).toBeTruthy();
    expect(screen.getByText("in Documents")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pause Biology" }));
    await waitFor(() => expect(h.runLocalDeviceAction).toHaveBeenCalledWith({ action: "pause_folder", grantId: "grant_a" }));
    expect(await screen.findByText("Paused the folder.")).toBeTruthy();
  });

  it("asks before it stops using a folder", async () => {
    render(<DevicesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Stop syncing Biology" }));
    expect(h.runLocalDeviceAction).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Stop using it" }));
    await waitFor(() => expect(h.runLocalDeviceAction).toHaveBeenCalledWith({ action: "remove_folder", grantId: "grant_a" }));
  });

  it("says another computer's folders change on that computer", () => {
    render(<DevicesPage />);
    expect(screen.getByRole("region", { name: "Files and folders on Desk PC" })).toBeTruthy();
    expect(screen.getByText("Change what syncs in Spectra on that computer.")).toBeTruthy();
    const card = screen.getByRole("heading", { name: "Desk PC" }).closest("[data-device-row]") as HTMLElement;
    expect(within(card).queryByRole("button", { name: "Show logs" })).toBeNull();
  });

  it("connects this computer: the page shows progress, then the row forms", async () => {
    h.local = bridge(false);
    h.cloud = { devices: [], mounts: [] };
    render(<DevicesPage />);
    // A first-time browser leads with the download and an installed-Bridge
    // shortcut. Both start the same web connection flow.
    fireEvent.click(screen.getByRole("button", { name: "I already have it" }));
    expect(await screen.findByText("Connecting this computer.")).toBeTruthy();
    expect(h.requestPairing).toHaveBeenCalledWith({ browserOrigin: "https://spectra.test" });
    pairingStatus = { paired: true, sessionToken: "token" };
    await waitFor(() => expect(h.local.refresh).toHaveBeenCalled());
    expect(screen.queryByText("Connecting this computer.")).toBeNull();
  });

  it("starts connecting by itself when Spectra AI or the command bar asks", async () => {
    h.local = bridge(false);
    h.cloud = { devices: [], mounts: [] };
    render(<DevicesPage />);
    act(() => h.pairing.want());
    expect(await screen.findByText("Connecting this computer.")).toBeTruthy();
  });

  it("starts connecting from ?connect=1", async () => {
    h.local = bridge(false);
    window.history.replaceState(null, "", "/devices?connect=1");
    render(<DevicesPage />);
    expect(await screen.findByText("Connecting this computer.")).toBeTruthy();
    expect(window.location.search).toBe("");
  });

  it("removes this device: Spectra forgets it and Bridge unpairs", async () => {
    render(<DevicesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Remove this device" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent === "Remove")!);
    await waitFor(() => expect(h.revokeDevice).toHaveBeenCalledWith({ deviceId: "device-here", removeFiles: false }));
    await waitFor(() => expect(h.local.forgetSession).toHaveBeenCalled());
    expect(h.unpairBridge).toHaveBeenCalled();
  });

  it.each(["revoke", "unpair"] as const)("does not continue an old device removal after switching accounts during %s", async (stage) => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    h.revokeDevice.mockReturnValue(stage === "revoke" ? pending : Promise.resolve());
    h.unpairBridge.mockReturnValue(stage === "unpair" ? pending : Promise.resolve());
    const local = h.local;
    const view = render(<DevicesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Remove this device" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(stage === "revoke" ? h.revokeDevice : h.unpairBridge).toHaveBeenCalledOnce());
    view.unmount();
    bindAccountStorageScope("fixture-deployment/account-B");
    await act(async () => { finish(); });
    if (stage === "revoke") expect(h.unpairBridge).not.toHaveBeenCalled();
    expect(local.forgetSession).not.toHaveBeenCalled();
    expect(local.refresh).not.toHaveBeenCalled();
  });

  it.each([false, true])("finishes a pending native-write choice only for its original account (changed: %s)", async (changed) => {
    let finish!: () => void;
    h.overrideAccount.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const view = render(<DevicesPage />);
    fireEvent.click(screen.getByRole("radio", { name: /^Always/ }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Allow writes" }));
    expect(h.overrideAccount).toHaveBeenCalledOnce();
    view.unmount();
    bindAccountStorageScope(changed ? "fixture-deployment/account-B" : "fixture-deployment/account-A");
    await act(async () => { finish(); });
    expect(h.updatePreferences).toHaveBeenCalledTimes(changed ? 0 : 1);
  });

  it("shows native writes for the account, Never by default", () => {
    render(<DevicesPage />);
    expect(screen.getByText("Applies to every device.", { exact: false })).toBeTruthy();
    expect(screen.getByText("Desktop files stay as they are. Changes stay in Spectra.")).toBeTruthy();
  });
});
