// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { ThemeProvider } from "@/components/theme-provider";
import { SettingsApplication } from "@/features/spectra/settings/ui/settings-application";

/*
 * The preference store reads auth state through Convex's provider context.
 * This contract test mounts the settings surface bare (no providers), which
 * is the signed-out, local-preferences shape — so the auth hook is answered
 * directly instead of requiring a full provider tree.
 */
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: false }),
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Settings application accessibility contract", () => {
  it("provides stable navigation and only labelled controls with product effects", () => {
    render(
      <ThemeProvider>
        <SettingsApplication initialSection="ai" />
      </ThemeProvider>,
    );
    expect(
      screen.getByRole("navigation", { name: "Settings sections" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Conversations", level: 2 }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "Conversations and Live Dock",
        level: 2,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "Continue the current conversation" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(
      screen.getByRole("heading", { name: "Appearance", level: 2 }),
    ).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Reduced motion" })).toBeTruthy();
  });

  it("persists a setting as one versioned device preference document", () => {
    render(
      <ThemeProvider>
        <SettingsApplication initialSection="writing" />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Smart completion" }));
    const stored = JSON.parse(
      window.localStorage.getItem("spectra:preferences:v2") ?? "null",
    ) as { version?: number; writing?: { smartCompletion?: boolean } } | null;
    expect(stored).toMatchObject({
      version: 2,
      writing: { smartCompletion: false },
    });
  });
});
