// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/theme-provider";
import { SettingsApplication } from "@/features/spectra/settings/ui/settings-application";

// The page header's command bar measures its room.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const clerk = vi.hoisted(() => ({
  signOut: vi.fn(async () => {}),
  openUserProfile: vi.fn(),
}));
vi.mock("@clerk/nextjs", () => ({ useClerk: () => clerk }));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: false }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("Settings account controls", () => {
  it("lets a person sign out of this device", async () => {
    render(
      <ThemeProvider>
        <SettingsApplication initialSection="privacy" />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(clerk.signOut).toHaveBeenCalledWith({ redirectUrl: "/" }));
  });

  it("opens the account profile from Settings", () => {
    render(
      <ThemeProvider>
        <SettingsApplication initialSection="privacy" />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage account" }));
    expect(clerk.openUserProfile).toHaveBeenCalled();
  });
});
