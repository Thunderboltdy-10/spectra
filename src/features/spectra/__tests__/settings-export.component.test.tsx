// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/theme-provider";
import { SettingsApplication } from "@/features/spectra/settings/ui/settings-application";

// The page header's command bar measures its room.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const exportMemory = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({ signOut: vi.fn(), openUserProfile: vi.fn() }),
}));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: false }),
}));
vi.mock("../data/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/api")>()),
  exportSpectraMemory: exportMemory,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("Personal context export", () => {
  it("keeps the download's object URL alive past the click (Safari)", async () => {
    exportMemory.mockResolvedValue({ memories: [] });
    const create = vi.fn(() => "blob:spectra/context");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(
      <ThemeProvider>
        <SettingsApplication initialSection="privacy" />
      </ThemeProvider>,
    );
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(revoke).toHaveBeenCalledWith("blob:spectra/context");
  });
});
