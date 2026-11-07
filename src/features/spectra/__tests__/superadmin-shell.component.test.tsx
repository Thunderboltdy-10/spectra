// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getAdministration: vi.fn(),
  mutateAdministration: vi.fn(),
}));

vi.mock("@/features/spectra/administration/api", () => api);
const navigation = vi.hoisted(() => ({ tab: "overview" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=" + navigation.tab),
}));

import { SuperadminShell } from "../pages/superadmin-shell";

// The header bar measures itself.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

beforeEach(() => {
  navigation.tab = "overview";
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Superadmin page", () => {
  function directory(load: (search: string) => Promise<unknown>) {
    navigation.tab = "schools";
    api.getAdministration.mockImplementation(async (kind: string, args?: { search?: string }) => {
      if (kind === "platformOverview") return { metrics: { activeSchools: 2 }, queues: { failedRuns24h: 0, integrationErrors: 0, openFeedback: 0, openRequests: 0 }, integrations: { degraded: 0 }, serviceHealth: [], incidents: [], requests: [] };
      if (kind === "onboardingSagas") return { sagas: [] };
      if (kind === "schoolDirectory") return load(args?.search ?? "");
      throw new Error(kind);
    });
    render(<SuperadminShell />);
  }

  it.each(["sent", "skipped", "failed"])("describes %s onboarding delivery accurately while retaining the manual link", async (status) => {
    api.mutateAdministration.mockResolvedValue({ delivery: { status }, manualInvitationUrl: "https://school.example/join?token=fixture" });
    directory(async () => ({ schools: [] }));
    fireEvent.click(await screen.findByRole("button", { name: /^Add school$/ }));
    fireEvent.change(screen.getByLabelText("School name"), { target: { value: "Launch audit school" } });
    fireEvent.change(screen.getByLabelText("Initial school administrator"), { target: { value: "admin@example.test" } });
    fireEvent.submit(document.getElementById("create-school-form")!);
    expect(await screen.findByText(status === "sent" ? /The invitation email was accepted/ : /The invitation email was not sent/)).toBeTruthy();
    expect(screen.queryByText(/SMTP did not accept/)).toBeNull();
    expect(screen.getByRole("button", { name: "Copy secure link" })).toBeTruthy();
  });

  it("keeps a directory failure distinct from an empty platform and recovers on retry", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("Directory unavailable"))
      .mockResolvedValueOnce({ schools: [] });
    directory(load);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(screen.queryByText("No schools yet. Add the first one.")).toBeNull();
    expect(await screen.findByText("No schools yet. Add the first one.")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("ignores a slower earlier search result", async () => {
    let finishOld!: (value: unknown) => void;
    directory(search => search === "old" ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve({ schools: [] }));
    const search = await screen.findByRole("searchbox", { name: "Search schools" });
    fireEvent.change(search, { target: { value: "old" } });
    await waitFor(() => expect(finishOld).toBeDefined());
    fireEvent.change(search, { target: { value: "current" } });
    expect(await screen.findByText("No school matches that.")).toBeTruthy();
    await act(async () => finishOld({ schools: [{ schoolId: "old", name: "Old result", members: 1, integrationStatus: "connected", limitEnforcement: "disabled", status: "active" }] }));
    expect(screen.queryByText("Old result")).toBeNull();
  });

  it("preserves previously read schools when the next directory read fails", async () => {
    directory(search => search ? Promise.reject(new Error("Directory unavailable")) : Promise.resolve({ schools: [{ schoolId: "saved", name: "Previously read school", members: 1, integrationStatus: "connected", limitEnforcement: "disabled", status: "active" }] }));
    expect(await screen.findByText("Previously read school")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search schools" }), { target: { value: "fail" } });
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByText("Previously read school")).toBeTruthy();
    expect(screen.queryByText("No school matches that.")).toBeNull();
  });

  it("keeps the header while loading, then says plainly that it did not load, with a way to try again", async () => {
    api.getAdministration.mockRejectedValueOnce(new Error("[CONVEX Q(administration:platformOverview)] Server Error"));
    render(<SuperadminShell />);
    expect(screen.getByRole("heading", { level: 1, name: "Superadmin" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Opening superadmin" })).toBeTruthy();

    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByText("This didn’t load")).toBeTruthy();
    expect(document.body.textContent).not.toContain("CONVEX");

    api.getAdministration.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(retry);
    expect(api.getAdministration).toHaveBeenCalledTimes(2);
  });
});
