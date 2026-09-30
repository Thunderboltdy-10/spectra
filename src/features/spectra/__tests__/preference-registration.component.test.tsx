// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PREFERENCE_SAVE_FAILURE, useSpectraPreferences } from "../settings/preference-store";

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
  expect(remote.state.listeners.size).toBe(0);
});

it("reports a failed migration without marking it saved or leaking a rejection", async () => {
  remote.state.layers = [];
  remote.client.mutation.mockRejectedValue(new Error("temporary write failure"));
  const { result } = renderHook(() => useSpectraPreferences());
  await waitFor(() => expect(result.current.saveError).toBe(PREFERENCE_SAVE_FAILURE));
  expect(window.localStorage.getItem("spectra:preferences:account-migrated:v2")).toBeNull();
});
