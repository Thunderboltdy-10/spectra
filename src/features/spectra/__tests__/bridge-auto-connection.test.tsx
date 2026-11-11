// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  authenticated: true, focused: true, revision: "a", paired: false,
  rejoin: vi.fn(async () => true), request: vi.fn(), runtime: vi.fn(), refresh: vi.fn(async () => {}),
}));
vi.mock("convex/react", () => ({ useConvexAuth: () => ({ isAuthenticated: h.authenticated }), useMutation: () => h.request, useConvex: () => ({ query: vi.fn(async () => []), mutation: vi.fn() }) }));
vi.mock("@/lib/account-storage-scope", () => ({ accountStorageRevision: () => h.revision, accountStorageMatches: (value: string) => value === h.revision }));
vi.mock("next/navigation", () => ({ useRouter: () => ({}), usePathname: () => "/devices" }));
vi.mock("@/features/spectra/data/use-kept-query", () => ({ useQuery: () => undefined }));
vi.mock("../bridge/use-bridge", () => ({ useBridgeHealth: () => ({ checked: true, discovery: { kind: "running" }, health: { paired: false }, status: { paired: h.paired }, refresh: h.refresh }) }));
vi.mock("../devices/pairing", () => ({ rejoinBridge: h.rejoin }));
vi.mock("../settings/preference-store", () => ({ useSpectraPreferences: () => ({ hydrated: false, preferences: { ai: { runtimeChosen: true } } }) }));
vi.mock("../ai/use-agent-runtime", () => ({ recheckAgentRuntime: h.runtime, useAgentRuntime: () => ({}) }));
vi.mock("../bridge/device-works", () => ({ deviceStoreSummary: vi.fn(async () => ({ storeId: "fixture" })), publishDeviceState: vi.fn(), useDeviceState: () => ({ storeId: null }) }));
vi.mock("../bridge/availability", () => ({ publishBridgeAvailability: vi.fn() }));
import { BridgeConnection } from "../bridge/bridge-discovery-mount";

beforeEach(() => {
  h.revision = String(Math.random()); h.focused = true; h.authenticated = true; h.paired = false;
  h.rejoin.mockReset().mockResolvedValue(true); h.refresh.mockReset().mockResolvedValue(undefined);
  vi.spyOn(document, "hasFocus").mockImplementation(() => h.focused);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("automatically connects a fresh installation and does not repeat on render or lost pairing", async () => {
  const view = render(<BridgeConnection />);
  await act(async () => {});
  expect(h.rejoin).toHaveBeenCalledTimes(1);
  h.paired = true; view.rerender(<BridgeConnection />);
  h.paired = false; view.rerender(<BridgeConnection />);
  await act(async () => {});
  expect(h.rejoin).toHaveBeenCalledTimes(1);
});

it("waits for foreground activation and reconnects the new account without navigation", async () => {
  h.focused = false;
  const view = render(<BridgeConnection />);
  await act(async () => {});
  expect(h.rejoin).not.toHaveBeenCalled();
  h.focused = true;
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(h.rejoin).toHaveBeenCalledTimes(1);
  expect(h.refresh).toHaveBeenCalledTimes(1);
  h.revision = "new-account";
  view.rerender(<BridgeConnection />);
  await act(async () => {});
  expect(h.rejoin).toHaveBeenCalledTimes(2);
});

it("a refused attempt waits for deliberate activation instead of retrying on renders", async () => {
  h.rejoin.mockResolvedValue(false);
  const view = render(<BridgeConnection />);
  await act(async () => {});
  view.rerender(<BridgeConnection />);
  await act(async () => {});
  expect(h.rejoin).toHaveBeenCalledTimes(1);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(h.rejoin).toHaveBeenCalledTimes(2);
});

it("never pairs a signed-out visitor", async () => {
  h.authenticated = false;
  render(<BridgeConnection />);
  await act(async () => {});
  expect(h.rejoin).not.toHaveBeenCalled();
});

it("a restored joined page does not take the computer back when another account connects", async () => {
  h.paired = true;
  const view = render(<BridgeConnection />);
  h.paired = false; view.rerender(<BridgeConnection />);
  await act(async () => {});
  expect(h.rejoin).not.toHaveBeenCalled();
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(h.rejoin).toHaveBeenCalledTimes(1);
});

it("foreground activation waits for the fresh health result before rejoining", async () => {
  h.paired = true;
  let finish!: () => void;
  h.refresh.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const view = render(<BridgeConnection />);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  h.paired = false; view.rerender(<BridgeConnection />);
  await act(async () => {});
  expect(h.rejoin).not.toHaveBeenCalled();
  await act(async () => { finish(); });
  expect(h.rejoin).toHaveBeenCalledTimes(1);
});

it("does not overlap an unfinished join and hands its completion to the new account", async () => {
  let finish!: (joined: boolean) => void;
  h.rejoin.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  const storage = vi.fn();
  window.addEventListener("storage", storage);
  const view = render(<BridgeConnection />);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(h.rejoin).toHaveBeenCalledTimes(1);
  h.revision = "switched-while-joining";
  view.rerender(<BridgeConnection />);
  expect(h.rejoin).toHaveBeenCalledTimes(1);
  await act(async () => { finish(true); });
  expect(h.rejoin).toHaveBeenCalledTimes(2);
  expect(storage).toHaveBeenCalledTimes(1);
  window.removeEventListener("storage", storage);
});
