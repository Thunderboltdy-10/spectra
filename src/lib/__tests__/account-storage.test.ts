// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAccountScopedStorage,
  bindAccountStorageScope,
} from "../account-storage";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useSpectraContextStore.setState(
    useSpectraContextStore.getInitialState(),
    true,
  );
  localStorage.clear();
});
function saveOldWorkbench() {
  useSpectraContextStore
    .getState()
    .openObject({
      type: "artifact",
      id: "old-deployment-work",
      label: "Old artifact",
      presentation: "tab",
    });
  localStorage.setItem(
    "spectra:shared-workbench:v2",
    JSON.stringify({ activePaneId: "old-work" }),
  );
  localStorage.setItem("spectra.workspace.hubTabs.v1", "old-workspace");
  localStorage.setItem("theme", "dark");
}
describe("persisted workbench ownership", () => {
  it("drops kept threads, calendar and lists when another account signs in", async () => {
    const { cachedThread, rememberThread } = await import("@/features/spectra/data/thread-cache");
    bindAccountStorageScope("deployment/account-A");
    rememberThread("thread-a", { thread: { _id: "thread-a" } } as never);
    for (const key of ["spectra:thread-cache:v1", "spectra.threads.index.v1", "spectra:calendar-overview:v1", "spectra.agent.catalog.v1", "spectra.island.seen.v1"])
      localStorage.setItem(key, "[]");
    bindAccountStorageScope("deployment/account-B");
    expect(cachedThread("thread-a")).toBeNull();
    for (const key of ["spectra:thread-cache:v1", "spectra.threads.index.v1", "spectra:calendar-overview:v1", "spectra.agent.catalog.v1", "spectra.island.seen.v1"])
      expect(localStorage.getItem(key)).toBeNull();
  });
  it("clears persisted and in-memory workbench references on an account transition", () => {
    saveOldWorkbench();
    clearAccountScopedStorage();
    expect(localStorage.getItem("spectra.context.v2")).toBeNull();
    expect(localStorage.getItem("spectra:shared-workbench:v2")).toBeNull();
    expect(useSpectraContextStore.getState().openObjects).toEqual([]);
    expect(localStorage.getItem("theme")).toBe("dark");
  });
  it("does not restore legacy references with no known owner", () => {
    saveOldWorkbench();
    bindAccountStorageScope("deployment/account-A");
    expect(useSpectraContextStore.getState().openObjects).toEqual([]);
    expect(localStorage.getItem("spectra.workspace.hubTabs.v1")).toBeNull();
  });
  it("preserves workbench state on reload within the same scope", () => {
    bindAccountStorageScope("deployment/account-A");
    saveOldWorkbench();
    bindAccountStorageScope("deployment/account-A");
    expect(
      useSpectraContextStore.getState().openObjects.map((o) => o.id),
    ).toEqual(["old-deployment-work"]);
    expect(localStorage.getItem("spectra:shared-workbench:v2")).not.toBeNull();
  });
  it.each(["other-deployment/account-A", "deployment/account-B"])(
    "releases foreign references when scope becomes %s",
    (scope) => {
      bindAccountStorageScope("deployment/account-A");
      saveOldWorkbench();
      bindAccountStorageScope(scope);
      expect(useSpectraContextStore.getState().openObjects).toEqual([]);
      expect(localStorage.getItem("spectra:shared-workbench:v2")).toBeNull();
    },
  );
});
