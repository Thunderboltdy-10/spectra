// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { ThemeProvider } from "@/components/theme-provider";
import { SettingsApplication } from "@/features/spectra/settings/ui/settings-application";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Settings application accessibility contract", () => {
  it("provides stable navigation, labelled controls and collapsed advanced disclosure", () => {
    render(
      <ThemeProvider>
        <SettingsApplication initialSection="ai" />
      </ThemeProvider>,
    );
    expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "AI and runs", level: 2 })).toHaveLength(2);
    expect(screen.getByRole("switch", { name: "Continue current conversation" })).toBeTruthy();
    const advanced = screen.getByText("Advanced").closest("details");
    expect(advanced?.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Accessibility" }));
    expect(screen.getAllByRole("heading", { name: "Accessibility", level: 2 })).toHaveLength(2);
    expect(screen.getByRole("switch", { name: "Always-visible focus" })).toBeTruthy();
  });

  it("persists a setting as one versioned device preference document", () => {
    render(
      <ThemeProvider>
        <SettingsApplication initialSection="writing" />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Smart completion" }));
    const stored = JSON.parse(window.localStorage.getItem("spectra:preferences:v2") ?? "null") as { version?: number; writing?: { smartCompletion?: boolean } } | null;
    expect(stored).toMatchObject({ version: 2, writing: { smartCompletion: false } });
  });
});
