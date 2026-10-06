// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/theme-provider";
import { SettingsApplication } from "@/features/spectra/settings/ui/settings-application";
import { DEFAULT_SPECTRA_PREFERENCES } from "@/features/spectra/settings/schema";
import { spectraBus } from "@/features/spectra/events";

// The page header's command bar measures its room.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

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
  spectraBus.setQuery("side.open", null);
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
      screen.getByRole("heading", { name: "Spectra AI", level: 2 }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "Conversations and the island",
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

  it("offers Ask, Always allow or Never for each AI permission, and full control", () => {
    render(
      <ThemeProvider>
        <SettingsApplication initialSection="ai" />
      </ThemeProvider>,
    );
    expect(screen.getByRole("heading", { name: "Permissions", level: 2 })).toBeTruthy();
    for (const label of ["Permanent deletion", "Sending outside Spectra", "ManageBac changes", "Desktop file changes through Bridge", "Settings changes", "Sharing changes", "Connection changes"])
      expect(screen.getByRole("combobox", { name: label }).textContent).toContain("Ask");
    fireEvent.click(screen.getByRole("switch", { name: "Give Spectra full control" }));
    const stored = JSON.parse(window.localStorage.getItem("spectra:preferences:v2") ?? "null") as {
      ai?: { permissionFullControl?: boolean; permissionAllow?: string[]; permissionDeny?: string[] };
    } | null;
    expect(stored?.ai).toMatchObject({ permissionFullControl: true, permissionDeny: [] });
    expect(stored?.ai?.permissionAllow).toHaveLength(7);
    expect(screen.getByRole("combobox", { name: "Sharing changes" }).textContent).toContain("Always allow");
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

  it("hides deleted command ids and exposes rename for living ones, and no retired size or expanded controls", async () => {
    window.localStorage.setItem(
      "spectra:preferences:v2",
      JSON.stringify({
        ...DEFAULT_SPECTRA_PREFERENCES,
        workbar: {
          document: {
            commands: {
              "document.format.bold": { pinned: true, label: "Strong" },
              "document.format.ghostFromNova": { pinned: true, label: "Dead control" },
            },
          },
        },
      }),
    );
    render(
      <ThemeProvider>
        <SettingsApplication initialSection="workbar" />
      </ThemeProvider>,
    );
    expect(await screen.findByDisplayValue("Strong")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Name on the workbar for Bold" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Button size for Bold" })).toBeNull();
    expect(screen.queryByText("Expanded workbar")).toBeNull();
    expect(screen.queryByDisplayValue("Dead control")).toBeNull();
    expect(screen.queryByText("document.format.ghostFromNova")).toBeNull();
  });
  it("folds the section list into a popover while the Side holds work", async () => {
    spectraBus.setQuery("side.open", { kind: "work" });
    render(
      <ThemeProvider>
        <SettingsApplication initialSection="ai" />
      </ThemeProvider>,
    );
    expect(screen.queryByRole("navigation", { name: "Settings sections" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Spectra AI. Choose a settings section" }));
    fireEvent.click(await screen.findByRole("button", { name: "Appearance" }));
    expect(screen.getByRole("heading", { name: "Appearance", level: 2 })).toBeTruthy();
  });
});
