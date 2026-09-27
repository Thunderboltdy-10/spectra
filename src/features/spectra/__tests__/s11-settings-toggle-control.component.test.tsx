// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/theme-provider";
import { SettingsApplication } from "../settings/ui/settings-application";
import { settingsToggleControls } from "../collaboration/settings-toggle-control";
import { SMART_COMPLETION_TARGET } from "../actions/protocol/semantic-action";

const remote = vi.hoisted(() => ({
  layers: [{ scope: "account", values: { writing: { smartCompletion: true } }, updatedAt: 1 }],
  query: vi.fn(),
  mutation: vi.fn(),
}));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
  useConvex: () => ({
    query: remote.query,
    mutation: remote.mutation,
    watchQuery: () => ({
      localQueryResult: () => remote.layers,
      onUpdate: () => () => undefined,
    }),
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function mountSettings() {
  const view = render(<ThemeProvider><SettingsApplication initialSection="writing" /></ThemeProvider>);
  const toggle = screen.getByRole("switch", { name: "Smart completion" });
  const control = settingsToggleControls().find(({ element }) => element === toggle);
  expect(control).toBeDefined();
  expect(toggle.getAttribute("data-spectra-ai-target")).toBe(SMART_COMPLETION_TARGET);
  return { view, toggle, control: control! };
}

beforeEach(() => {
  remote.layers = [{ scope: "account", values: { writing: { smartCompletion: true } }, updatedAt: 1 }];
  remote.query.mockReset().mockImplementation(async () => remote.layers);
  remote.mutation.mockReset().mockResolvedValue(null);
  window.localStorage.clear();
  window.localStorage.setItem("spectra:preferences:account-migrated:v2", "true");
  window.history.replaceState(null, "", "/settings?section=writing");
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("S11 registered Smart completion control", () => {
  it("waits for the action receipt, then renders server preferences without another write or synthetic click", async () => {
    const { toggle, control } = mountSettings();
    const receipt = deferred<void>();
    const click = vi.fn();
    toggle.addEventListener("click", click);
    const input = document.createElement("textarea");
    input.value = "Preserve my selection";
    document.body.append(input);
    input.focus();
    input.setSelectionRange(3, 11);
    const scroll = toggle.closest("main")!;
    scroll.scrollTop = 73;
    const path = window.location.href;
    const task = control.perform({ signal: new AbortController().signal, reachActionPoint: () => receipt.promise });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(remote.query).not.toHaveBeenCalled();
    remote.layers = [{ scope: "account", values: { writing: { smartCompletion: false } }, updatedAt: 2 }];
    await act(async () => { receipt.resolve(); await task; });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(remote.query).toHaveBeenCalledTimes(1);
    expect(remote.mutation).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 11]);
    expect(scroll.scrollTop).toBe(73);
    expect(window.location.href).toBe(path);
    input.remove();
  });

  it("does not change the control or cache when the fenced operation rejects", async () => {
    const { toggle, control } = mountSettings();
    const cached = window.localStorage.getItem("spectra:preferences:v2");
    await expect(control.perform({
      signal: new AbortController().signal,
      reachActionPoint: async () => { throw new Error("AI_APPLICATION_ATTEMPT_SUPERSEDED"); },
    })).rejects.toThrow("AI_APPLICATION_ATTEMPT_SUPERSEDED");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(window.localStorage.getItem("spectra:preferences:v2")).toBe(cached);
    expect(remote.query).not.toHaveBeenCalled();
    expect(remote.mutation).not.toHaveBeenCalled();
  });

  it("reads the current accepted value instead of replaying an earlier offered value", async () => {
    const { toggle, control } = mountSettings();
    // Another accepted change may already have restored true by the time the
    // first action's reply arrives. A receipt is not permission to replay false.
    await act(async () => {
      await control.perform({ signal: new AbortController().signal, reachActionPoint: async () => undefined });
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(remote.mutation).not.toHaveBeenCalled();
  });

  it("keeps a human edit made while the authoritative refresh is in flight", async () => {
    const { toggle, control } = mountSettings();
    const read = deferred<typeof remote.layers>();
    const humanSave = deferred<null>();
    remote.query.mockReturnValueOnce(read.promise);
    remote.mutation.mockReturnValueOnce(humanSave.promise);
    let task!: Promise<void>;
    await act(async () => {
      task = control.perform({ signal: new AbortController().signal, reachActionPoint: async () => undefined });
      await Promise.resolve();
    });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => { read.resolve(remote.layers); await task; });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(remote.mutation).toHaveBeenCalledTimes(1);
    remote.layers = [{ scope: "account", values: { writing: { smartCompletion: false } }, updatedAt: 2 }];
    await act(async () => { humanSave.resolve(null); });
  });

  it("retires an unmounted control and rejects its old callback after a receipt arrives", async () => {
    const { view, control } = mountSettings();
    const receipt = deferred<void>();
    const task = control.perform({ signal: new AbortController().signal, reachActionPoint: () => receipt.promise });
    const rejected = expect(task).rejects.toThrow("SETTINGS_CONTROL_UNAVAILABLE");
    view.unmount();
    expect(settingsToggleControls()).toHaveLength(0);
    receipt.resolve();
    await rejected;
    expect(remote.query).not.toHaveBeenCalled();
  });
});
