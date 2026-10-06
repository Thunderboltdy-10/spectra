// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getAdministration: vi.fn(),
  mutateAdministration: vi.fn(),
}));

vi.mock("@/features/spectra/administration/api", () => api);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=overview"),
}));

import { SuperadminShell } from "../pages/superadmin-shell";

// The header bar measures itself.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Platform page", () => {
  it("keeps the header while loading, then says plainly that it did not load, with a way to try again", async () => {
    api.getAdministration.mockRejectedValueOnce(new Error("[CONVEX Q(administration:platformOverview)] Server Error"));
    render(<SuperadminShell />);
    expect(screen.getByRole("heading", { level: 1, name: "Platform" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Opening the platform" })).toBeTruthy();

    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByText("This didn’t load")).toBeTruthy();
    expect(document.body.textContent).not.toContain("CONVEX");

    api.getAdministration.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(retry);
    expect(api.getAdministration).toHaveBeenCalledTimes(2);
  });
});
