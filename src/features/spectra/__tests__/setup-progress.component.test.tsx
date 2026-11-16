// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { mergePreferenceValues } from "../settings/schema";
import { SetupMount } from "../onboarding/setup";

const remote = vi.hoisted(() => {
  const state = {
    layers: [{ scope: "account" as const, values: { integrations: { setupStatus: "pending", setupStep: "classes", classShelvesStatus: "chosen", classShelfRecordIds: ["biology"] } }, updatedAt: 1 }],
    listeners: new Set<() => void>(), phase: "ready", mutation: vi.fn(), request: vi.fn(),
  };
  const client = {
    mutation: state.mutation,
    watchQuery: () => ({
      localQueryResult: () => state.layers,
      onUpdate: (callback: () => void) => {
        state.listeners.add(callback);
        return () => { state.listeners.delete(callback); };
      },
    }),
  };
  return { state, client };
});
vi.mock("convex/react", async (original) => ({
  ...(await original<typeof import("convex/react")>()),
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useConvex: () => remote.client,
  useMutation: () => vi.fn(),
}));
vi.mock("../data/use-kept-query", () => ({ useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
  getFunctionName(ref) === "managebac:onboardingStatus" ? { phase: remote.state.phase } : { kinds: [] },
}));
vi.mock("../hooks/use-spectra-router", () => ({ useSpectraRouter: () => ({ push: vi.fn() }) }));
vi.mock("../bridge/availability", () => ({ useBridgeAvailability: () => "not-installed" }));
vi.mock("../bridge/network-permission", () => ({ useNetworkPermission: () => "granted", NETWORK_PERMISSION_FIX: "" }));
vi.mock("../bridge/client", () => ({ bridgePlatform: () => "windows", setBridgeRemovedHere: vi.fn() }));
vi.mock("../devices/pairing", () => {
  const pairing = { subscribe: () => () => {}, get: () => idle, reset: vi.fn(), cancel: vi.fn() };
  const idle = { phase: "idle" };
  return { devicePairing: () => pairing };
});
vi.mock("../devices/bridge-install-steps", () => ({ BridgeInstallSteps: () => null }));
vi.mock("../devices/pairing-panel", () => ({ PairingPanel: () => null }));
vi.mock("../devices/work-home-choice", () => ({ WorkHomeChoice: () => null }));
vi.mock("../ai/provider-setup", () => ({ SubscriptionSetup: () => null }));
vi.mock("../ai/use-agent-runtime", () => ({ useAgentRuntime: () => ({ status: null }) }));
vi.mock("../island/phone-rest", () => ({ useIslandShowcase: () => {} }));
vi.mock("@/components/layout/feedback-button", () => ({ FeedbackButton: () => null }));
vi.mock("../school/use-class-book", () => ({ inkStyle: () => ({}), useClassBook: () => ({ classes: [], of: () => null }) }));

const choice = { classShelvesStatus: "chosen", classShelfRecordIds: ["biology"] };
function answerClasses() { fireEvent.click(screen.getByRole("button", { name: "Use selected classes" })); }
function bridgeVisible() { expect(screen.getByRole("heading", { name: "Put Spectra Bridge on this computer" })).toBeTruthy(); }
beforeEach(() => {
  remote.state.phase = "ready";
  remote.state.layers = [{ scope: "account", values: { integrations: { setupStatus: "pending", setupStep: "classes", ...choice } }, updatedAt: 1 }];
  remote.state.listeners.clear();
  remote.state.mutation.mockReset().mockImplementation(async (_ref: unknown, args: { values: unknown }) => {
    remote.state.layers = [{ scope: "account", values: mergePreferenceValues(remote.state.layers[0].values, args.values) as typeof remote.state.layers[0]["values"], updatedAt: 2 }];
    remote.state.listeners.forEach(callback => callback());
  });
  remote.state.request.mockReset().mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") return new Response(JSON.stringify({ selectionRevision: 3 }));
    return new Response(JSON.stringify({ integration: {}, selectionRevision: 2, classes: [{ recordId: "biology", title: "Biology", selected: true, workspaceId: "existing-workspace" }] }));
  });
  vi.stubGlobal("fetch", remote.state.request);
  window.localStorage.clear();
  window.localStorage.setItem("spectra:preferences:account-migrated:v2", "true");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("advances an existing account immediately with one combined save and stays on Bridge after acknowledgement and remount", async () => {
  let resolve!: () => void;
  remote.state.mutation.mockImplementation((_ref: unknown, args: { values: unknown }) => new Promise<void>(done => {
    resolve = () => {
      remote.state.layers = [{ scope: "account", values: mergePreferenceValues(remote.state.layers[0].values, args.values) as typeof remote.state.layers[0]["values"], updatedAt: 2 }];
      remote.state.listeners.forEach(callback => callback());
      done();
    };
  }));
  const view = render(<SetupMount />);
  await screen.findByRole("button", { name: "Use selected classes" });
  answerClasses();
  bridgeVisible();
  expect(remote.state.request).toHaveBeenCalledTimes(1); // Class list only: no selection rebuild or sync.
  expect(remote.state.mutation).toHaveBeenCalledTimes(1);
  expect(remote.state.mutation.mock.calls[0][1].values).toEqual({ integrations: { ...choice, setupStep: "bridge" } });
  await act(async () => resolve());
  bridgeVisible();
  view.unmount();
  render(<SetupMount />);
  await screen.findByRole("heading", { name: "Put Spectra Bridge on this computer" });
});

it("still confirms a new account with the server before advancing, even if its selection is unchanged", async () => {
  remote.state.phase = "choose_classes";
  let saved!: () => void;
  remote.state.request.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (!init) return new Response(JSON.stringify({ integration: {}, selectionRevision: 2, classes: [{ recordId: "biology", title: "Biology", selected: true }] }));
    if (JSON.parse(init.body as string).action === "selectClasses") return new Promise<Response>(resolve => { saved = () => resolve(new Response(JSON.stringify({ selectionRevision: 3 }))); });
    return new Response("{}");
  });
  render(<SetupMount />);
  await screen.findByRole("button", { name: "Use selected classes" });
  answerClasses();
  expect(screen.getByRole("heading", { name: "Choose this year's classes" })).toBeTruthy();
  expect(remote.state.mutation).not.toHaveBeenCalled();
  await act(async () => saved());
  bridgeVisible();
  expect(remote.state.mutation).toHaveBeenCalledTimes(1);
});


it("saves changed choices for an existing account instead of taking the unchanged fast path", async () => {
  render(<SetupMount />);
  await screen.findByRole("button", { name: "Use selected classes" });
  fireEvent.click(screen.getByRole("option", { name: /Biology/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continue without classes" }));
  await screen.findByRole("heading", { name: "Put Spectra Bridge on this computer" });
  const submission = remote.state.request.mock.calls.find(([, init]) => init?.method === "POST");
  expect(JSON.parse(submission![1].body)).toMatchObject({ action: "selectClasses", recordIds: [], expectedRevision: 2 });
  expect(remote.state.mutation.mock.calls[0][1].values).toEqual({ integrations: {
    classShelvesStatus: "skipped", classShelfRecordIds: [], setupStep: "bridge",
  } });
});

it("shows a failed progress save and lets the user retry", async () => {
  remote.state.mutation.mockRejectedValueOnce(new Error("offline"));
  render(<SetupMount />);
  await screen.findByRole("button", { name: "Use selected classes" });
  answerClasses();
  expect((await screen.findByRole("alert")).textContent).toContain("Settings could not be saved");
  expect(screen.getByRole("heading", { name: "Choose this year's classes" })).toBeTruthy();
  await screen.findByRole("button", { name: "Use selected classes" });
  await act(async () => answerClasses());
  bridgeVisible();
  expect(remote.state.mutation).toHaveBeenCalledTimes(2);
});
