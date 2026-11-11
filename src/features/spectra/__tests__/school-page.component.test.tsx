// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  mutate: vi.fn(),
  sync: vi.fn(),
  resolveIdentity: vi.fn(),
  identity: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip" ? undefined : mocks.data[getFunctionName(reference)],
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
    mocks.mutate(getFunctionName(reference), args),
  useConvex: () => ({ query: async (reference: Parameters<typeof getFunctionName>[0]) => mocks.data[getFunctionName(reference)] }),
}));
vi.mock("../data/use-authed-args", () => ({ useAuthedArgs: <T,>(args: T) => args }));
const scope = vi.hoisted(() => ({ value: "test-0", count: 0 }));
// Each test is its own account, so the shared identity read is never carried over.
vi.mock("@/lib/account-storage", async (original) => ({ ...(await original<typeof import("@/lib/account-storage")>()), accountStorageScope: () => scope.value }));
vi.mock("../administration/api", () => ({ getAdministration: mocks.identity }));
vi.mock("../hooks/use-spectra-router", () => ({ useSpectraRouter: () => ({ push: vi.fn() }) }));
vi.mock("../data/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/api")>()),
  syncSpectraManageBac: mocks.sync,
  resolveSpectraManageBacIdentity: mocks.resolveIdentity,
}));

import { SchoolPage } from "../school/school-page";

const NOW = Date.now();
const DAY = 86_400_000;

function connected(overrides: Record<string, unknown> = {}) {
  return {
    connection: { state: "connected", lastSyncAt: NOW - 60_000, problem: null, ...overrides },
    running: false,
    kinds: [
      { kind: "current_tasks", label: "Current tasks", mode: "auto", available: true, state: "succeeded", lastRunAt: NOW - 60_000, lastSuccessAt: NOW - 60_000, nextRunAt: NOW + DAY, nextRunTrigger: "schedule", problem: null },
    ],
  };
}

beforeEach(() => {
  scope.value = `test-${++scope.count}`;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // Room for the header's commands, as on a desktop window.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  mocks.identity.mockResolvedValue({ membership: { role: "student" } });
  mocks.data = {
    "school:preferences": {
      connected: true,
      kinds: [{ kind: "current_tasks", label: "Current tasks", description: "", defaultMode: "auto", classScoped: true, available: true, unavailableReason: null, autoEveryMinutes: 60, mode: "auto", chosen: false }],
      classOverrides: [],
    },
    "school:syncStatus": connected(),
    "school:tasks": {
      tasks: [
        { recordId: "t1", title: "Lab report", providerClassId: "c1", className: "Chemistry", dueAt: NOW + 2 * DAY, status: null, taskType: null, term: null, past: false, sourceState: "available", provenanceUrl: null },
      ],
    },
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("School page", () => {
  it.each(["blocked", "never-synced", "failed"])("does not claim an empty workload for %s task data", state => {
    const status = connected(state === "blocked" ? { state: "blocked", problem: { code: "INTEGRATION_IDENTITY_REQUIRED", message: "Account match required", fixBy: "student", fixHint: "Match your account." } } : {});
    if (state === "never-synced") Object.assign(status.kinds[0]!, { state: "idle", lastSuccessAt: null });
    if (state === "failed") Object.assign(status.kinds[0]!, { state: "failed", problem: { code: "INTEGRATION_NOT_READY", message: "Sync failed", fixHint: "Try again." } });
    mocks.data["school:syncStatus"] = status;
    mocks.data["school:tasks"] = { tasks: [] };
    mocks.data["school:classes"] = { classes: [{ providerClassId: "c1", recordId: "class-1", title: "Physics HL", subject: "Physics", yearGroupId: null, academicPeriodKey: "2026", archived: false, selected: true, modes: { current_tasks: "auto" } }] };
    render(<SchoolPage />);
    expect(screen.queryAllByText(/Nothing due/)).toHaveLength(0);
    expect(screen.queryAllByLabelText("Nothing due", { exact: true })).toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));
    expect(screen.queryAllByText(/Nothing due/)).toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: "Classes" }));
    expect(screen.queryAllByText(/Nothing due/)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Physics HL/ }));
    expect(screen.queryAllByText(/Nothing due/)).toHaveLength(0);
  });

  it("keeps the empty-workload messages for successfully synced task data", () => {
    mocks.data["school:tasks"] = { tasks: [] };
    render(<SchoolPage />);
    expect(screen.getByText(/^Nothing due this week\./)).toBeTruthy();
    expect(screen.getByText("Nothing due", { exact: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));
    expect(screen.getByText("Nothing due", { exact: true })).toBeTruthy();
  });

  it("opens on an overview of what's coming up and sync, with nothing ManageBac can't bring", async () => {
    render(<SchoolPage />);
    expect(screen.getByRole("heading", { level: 1, name: "School" })).toBeTruthy();
    expect(screen.getByText("Lab report")).toBeTruthy();
    expect(screen.queryByText(/CAS/)).toBeNull();
    expect(screen.getByText(/^Synced (?!from)/)).toBeTruthy();
    // Admin-only connection settings stay hidden for a student.
    await waitFor(() => expect(mocks.identity).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Connection" })).toBeNull();
  });

  it("says plainly when the school hasn't connected ManageBac", () => {
    mocks.data["school:syncStatus"] = {
      connection: { state: "not_connected", problem: { code: "INTEGRATION_NOT_CONNECTED", message: "Your school hasn't connected ManageBac yet.", fixBy: "school_admin", fixHint: "Ask your school to connect it." } },
      running: false,
      kinds: [],
    };
    render(<SchoolPage />);
    expect(screen.getByText("ManageBac isn't connected")).toBeTruthy();
    expect(screen.getAllByText(/Ask your school to connect it\./).length).toBeGreaterThan(0);
  });

  it("lets a student fix their own account match", async () => {
    mocks.data["school:syncStatus"] = connected({
      state: "blocked",
      problem: { code: "INTEGRATION_IDENTITY_REQUIRED", message: "Spectra hasn't matched you to your ManageBac account yet.", fixBy: "student", fixHint: "Match your account." },
    });
    mocks.resolveIdentity.mockResolvedValue({});
    render(<SchoolPage />);
    fireEvent.click(screen.getByRole("button", { name: "Match my account" }));
    await waitFor(() => expect(mocks.resolveIdentity).toHaveBeenCalledOnce());
    expect(await screen.findByText(/Matched\./)).toBeTruthy();
  });

  it("keeps the page while Sync now runs, then says how it went", async () => {
    let finish!: (value: unknown) => void;
    mocks.sync.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    render(<SchoolPage />);
    const syncNow = screen.getAllByRole("button", { name: /Sync now/ })[0]!;
    fireEvent.click(syncNow);
    expect(mocks.sync).toHaveBeenCalledWith(undefined);
    expect(screen.getByText("Lab report")).toBeTruthy();
    await act(async () => finish({ jobs: [], queued: [] }));
    expect(await screen.findByText("Synced from ManageBac.")).toBeTruthy();
  });

  it("reads a failed sync in words, not codes", async () => {
    mocks.sync.mockRejectedValue(new Error("INTEGRATION_RATE_LIMITED: ManageBac is busy. Try again in a minute."));
    render(<SchoolPage />);
    fireEvent.click(screen.getAllByRole("button", { name: /Sync now/ })[0]!);
    const notice = await screen.findByText(/ManageBac is busy/);
    expect(notice.textContent).not.toContain("INTEGRATION_RATE_LIMITED");
    expect(screen.getByText("Lab report")).toBeTruthy();
  });

  it("remembers the section in the address", () => {
    render(<SchoolPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Sync" }));
    expect(new URL(window.location.href).searchParams.get("section")).toBe("sync");
    expect(screen.getByText("Current tasks")).toBeTruthy();
  });

  it("offers only what ManageBac can bring in", () => {
    const preferences = mocks.data["school:preferences"] as { kinds: Record<string, unknown>[] };
    preferences.kinds.push({ ...preferences.kinds[0], kind: "cas", label: "CAS", available: false, unavailableReason: "Not shared.", mode: "off" });
    render(<SchoolPage />);
    expect(screen.queryByRole("tab", { name: "CAS" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Sync" }));
    expect(screen.getByText("Current tasks")).toBeTruthy();
    expect(screen.queryByText("CAS")).toBeNull();
  });
});
