// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PREFERENCE_SAVE_FAILURE, useSpectraPreferences } from "../settings/preference-store";
import { mergePreferenceValues, type PreferenceLayerValues } from "../settings/schema";

const remote = vi.hoisted(() => {
  const state = { layers: null as null | Array<{ scope: "account"; values: unknown; updatedAt: number }>, listeners: new Set<() => void>() };
  const client = {
    mutation: vi.fn(),
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
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true }),
  useConvex: () => remote.client,
}));

beforeEach(() => {
  remote.state.layers = null;
  remote.state.listeners.clear();
  remote.client.mutation.mockReset().mockResolvedValue("saved");
  window.localStorage.clear();
});
afterEach(cleanup);

it("waits for registration, then migrates a schoolless account once", async () => {
  renderHook(() => useSpectraPreferences());
  expect(remote.client.mutation).not.toHaveBeenCalled();
  expect(remote.state.listeners.size).toBe(1);
  await act(async () => {
    remote.state.layers = [];
    remote.state.listeners.forEach(callback => callback());
  });
  await waitFor(() => expect(remote.client.mutation).toHaveBeenCalledTimes(2));
  expect(window.localStorage.getItem("spectra:preferences:account-migrated:v2")).toBe("true");
  expect(remote.state.listeners.size).toBeGreaterThan(0);
});

it("reports a failed migration without marking it saved or leaking a rejection", async () => {
  remote.state.layers = [];
  remote.client.mutation.mockRejectedValue(new Error("temporary write failure"));
  const { result } = renderHook(() => useSpectraPreferences());
  await waitFor(() => expect(result.current.saveError).toBe(PREFERENCE_SAVE_FAILURE));
  expect(window.localStorage.getItem("spectra:preferences:account-migrated:v2")).toBeNull();
});

it.each([
  { olderFirst: true, olderFails: false },
  { olderFirst: true, olderFails: true },
  { olderFirst: false, olderFails: false },
  { olderFirst: false, olderFails: true },
])("keeps Setup on Bridge across overlapping class and progress saves ($olderFirst, $olderFails)", async ({ olderFirst, olderFails }) => {
  window.localStorage.setItem("spectra:preferences:account-migrated:v2", "true");
  remote.state.layers = [{ scope: "account", values: { integrations: {
    setupStep: "classes", classShelvesStatus: "chosen", classShelfRecordIds: ["already-selected"],
  } }, updatedAt: 1 }];
  const initialValues = remote.state.layers[0].values;
  const pending: Array<{ values: PreferenceLayerValues; resolve: () => void; reject: () => void }> = [];
  remote.client.mutation.mockImplementation((_name: unknown, args: { values: PreferenceLayerValues }) =>
    new Promise((resolve, reject) => pending.push({
      values: args.values,
      resolve: () => resolve("saved"),
      reject: () => reject(new Error("earlier save failed")),
    })));
  const picker = renderHook(() => useSpectraPreferences());
  const { result } = renderHook(() => ({ setup: useSpectraPreferences(), observer: useSpectraPreferences() }));
  await waitFor(() => expect(result.current.observer.accountReady).toBe(true));
  act(() => {
    picker.result.current.update("integrations", { classShelvesStatus: "chosen", classShelfRecordIds: ["already-selected"] });
    result.current.setup.update("integrations", { setupStep: "bridge" });
  });
  picker.unmount(); // The class picker goes away as soon as Setup advances.
  expect(pending).toHaveLength(2);
  const expectBridge = () => {
    for (const hook of Object.values(result.current)) {
      expect(hook.preferences.integrations.setupStep).toBe("bridge");
      expect(hook.preferences.integrations.classShelfRecordIds).toEqual(["already-selected"]);
    }
  };
  expectBridge();
  const older = () => olderFails ? pending[0].reject() : pending[0].resolve();
  await act(async () => {
    remote.state.layers = [{ scope: "account", values: mergePreferenceValues(initialValues, olderFirst ? pending[0].values : pending[1].values), updatedAt: 2 }];
    remote.state.listeners.forEach(callback => callback());
    if (olderFirst) older();
    else pending[1].resolve();
  });
  expectBridge();
  await act(async () => {
    remote.state.layers = [{ scope: "account", values: mergePreferenceValues(mergePreferenceValues(initialValues, pending[0].values), pending[1].values), updatedAt: 3 }];
    remote.state.listeners.forEach(callback => callback());
    if (olderFirst) pending[1].resolve();
    else older();
  });
  expectBridge();
  for (const hook of Object.values(result.current)) expect(hook.saving).toBe(false);
  expect(remote.state.listeners.size).toBeGreaterThan(0);
  // Once writes settle, all consumers still accept later account changes.
  await act(async () => {
    remote.state.layers = [{ scope: "account", values: { integrations: { setupStep: "island" } }, updatedAt: 4 }];
    window.dispatchEvent(new Event("focus"));
  });
  for (const hook of Object.values(result.current)) expect(hook.preferences.integrations.setupStep).toBe("island");
});


it("keeps Setup subscribed until its completion is acknowledged, then parks the query", async () => {
  window.localStorage.setItem("spectra:preferences:account-migrated:v2", "true");
  remote.state.layers = [{ scope: "account", values: { integrations: { setupStep: "classes" } }, updatedAt: 1 }];
  const { result } = renderHook(() => useSpectraPreferences());
  await waitFor(() => expect(result.current.accountReady).toBe(true));
  expect(remote.state.listeners.size).toBe(1);
  // This is a live query update, without a focus event or a new subscription.
  await act(async () => {
    remote.state.layers = [{ scope: "account", values: { integrations: { setupStep: "bridge" } }, updatedAt: 2 }];
    remote.state.listeners.forEach(callback => callback());
  });
  expect(result.current.preferences.integrations.setupStep).toBe("bridge");
  expect(remote.state.listeners.size).toBe(1);
  await act(async () => {
    remote.state.layers = [{ scope: "account", values: { integrations: { setupStatus: "done", setupStep: "" } }, updatedAt: 3 }];
    remote.state.listeners.forEach(callback => callback());
  });
  expect(result.current.preferences.integrations.setupStatus).toBe("done");
  expect(remote.state.listeners.size).toBe(0);
});

it("does not send an old Setup step when changing an unrelated integration setting", async () => {
  window.localStorage.setItem("spectra:preferences:account-migrated:v2", "true");
  remote.state.layers = [{ scope: "account", values: { integrations: { setupStep: "classes" } }, updatedAt: 1 }];
  const { result } = renderHook(() => useSpectraPreferences());
  await waitFor(() => expect(result.current.accountReady).toBe(true));
  act(() => result.current.update("integrations", { tourStep: 2 }));
  expect(remote.client.mutation.mock.calls[0][1].values).toEqual({ integrations: { tourStep: 2 } });
});
