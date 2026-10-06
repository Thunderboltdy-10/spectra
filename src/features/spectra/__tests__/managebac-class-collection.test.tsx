// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManageBacIntegrationShell } from "../pages/managebac-integration-shell";

const harness = vi.hoisted(() => ({ overview: vi.fn(), candidates: vi.fn() }));
vi.mock("../data/api", async importOriginal => ({
  ...await importOriginal<typeof import("../data/api")>(),
  getSpectraManageBacOverview: harness.overview,
}));
vi.mock("../components/class-shelf-picker", async importOriginal => ({
  ...await importOriginal<typeof import("../components/class-shelf-picker")>(),
  fetchMyClassCandidates: harness.candidates,
}));
vi.mock("../settings/preference-store", () => ({ useSpectraPreferences: () => ({ update: vi.fn() }) }));

const integration = {
  _id: "integration", status: "connected", baseUrl: "https://provider.example.test", lastSyncAt: 1,
  syncPolicy: { frequencyMinutes: 180 }, capabilityCoverage: { verifiedReadable: 8 },
};
const classes = Array.from({ length: 22 }, (_, index) => ({
  recordId: `class-${index}`, title: `Fixture class ${index}`, program: "", grade: "",
  workspaceId: null, selected: index === 0,
}));
beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  // Room for the header's commands, as on a desktop window.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  harness.overview.mockResolvedValue({ admin: true, data: {
    integration, previews: [], capabilities: [], conflicts: [], syncRuns: [], mapping: { status: "verified" },
  } });
  harness.candidates.mockResolvedValue({ integration, identityRequired: false, classes, selectionRevision: 1 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it("uses the personal class collection for the admin overview and picker without an empty preview list", async () => {
  render(<ManageBacIntegrationShell />);
  const openClasses = await screen.findByRole("button", { name: /^Classes\s*22$/ });
  fireEvent.click(openClasses);
  const list = await screen.findByRole("listbox");
  expect(within(list).getAllByRole("option")).toHaveLength(22);
  expect(within(list).getAllByRole("option", { selected: true })).toHaveLength(1);
  expect(screen.queryByText("No classes in the latest sync")).toBeNull();
  expect(harness.candidates).toHaveBeenCalledTimes(1);
});

it("counts current eligible candidates instead of every class row in an ordinary overview", async () => {
  harness.overview.mockResolvedValue({ admin: false, data: {
    integration, records: [{ recordType: "class" }, { recordType: "class" }],
    capabilities: [], conflicts: [], syncRuns: [], mapping: { status: "verified" },
  } });
  harness.candidates.mockResolvedValue({ integration, identityRequired: false, classes: classes.slice(0, 1), selectionRevision: 1 });
  render(<ManageBacIntegrationShell />);
  expect(await screen.findByRole("button", { name: /^Classes\s*1$/ })).toBeTruthy();
});

it("refreshes the count and controlled selection from the same new collection", async () => {
  render(<ManageBacIntegrationShell />);
  fireEvent.click(await screen.findByRole("button", { name: /^Classes\s*22$/ }));
  expect(within(await screen.findByRole("listbox")).getAllByRole("option")).toHaveLength(22);
  harness.candidates.mockResolvedValue({
    integration, identityRequired: false, classes: [{ ...classes[0], selected: false }], selectionRevision: 2,
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh connection data" }));
  await waitFor(() => {
    const list = screen.getByRole("listbox");
    expect(within(list).getAllByRole("option")).toHaveLength(1);
    expect(within(list).queryAllByRole("option", { selected: true })).toHaveLength(0);
  });
  fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
  expect(await screen.findByRole("button", { name: /^Classes\s*1$/ })).toBeTruthy();
});

it("keeps connection controls available and shows unknown class count when the class read fails", async () => {
  harness.candidates.mockRejectedValue(new Error("Could not load classes."));
  render(<ManageBacIntegrationShell />);
  fireEvent.click(await screen.findByRole("button", { name: /^Classes\s*—$/ }));
  expect(await screen.findByText("Could not load classes.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "ManageBac settings" })).toBeTruthy();
  expect(screen.queryByText("No classes in the latest sync")).toBeNull();
});


it.each(["queued", "leased", "running"])("refreshes a %s sync until scheduled work finishes, then stops", async status => {
  const snapshot = (status: string, stage: string) => ({ admin: true, data: {
    integration, previews: [], capabilities: [], conflicts: [], mapping: { status: "verified" },
    syncRuns: [{ _id: "run", kind: "manual", status, stage, createdAt: 1, counts: {} }],
  } });
  harness.overview.mockResolvedValueOnce(snapshot(status, "reconciling"))
    .mockResolvedValue(snapshot("completed", "complete"));
  vi.useFakeTimers();
  await act(async () => { render(<ManageBacIntegrationShell />); });
  expect(screen.getByRole("button", { name: "Syncing…" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Sync history" }));
  expect(screen.getByText("Checking for removed items")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
  expect(screen.getByText("Complete")).toBeTruthy();
  expect(screen.queryByText("Checking for removed items")).toBeNull();
  expect(screen.getByRole("button", { name: "Sync now" }).hasAttribute("disabled")).toBe(false);
  expect(harness.overview).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
  expect(harness.overview).toHaveBeenCalledTimes(2);
});

it("retries a failed progress read and cancels the next refresh on unmount", async () => {
  harness.overview.mockResolvedValue({ admin: true, data: {
    integration, previews: [], capabilities: [], conflicts: [], mapping: { status: "verified" },
    syncRuns: [{ _id: "run", kind: "manual", status: "running", stage: "applying_projections", createdAt: 1, counts: {} }],
  } });
  vi.useFakeTimers();
  let view: ReturnType<typeof render>;
  await act(async () => { view = render(<ManageBacIntegrationShell />); });
  screen.getByRole("button", { name: "Syncing…" });
  harness.overview.mockRejectedValueOnce(new Error("Progress temporarily unavailable."));
  await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
  expect(screen.getByText("Progress temporarily unavailable.")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
  expect(screen.queryByText("Progress temporarily unavailable.")).toBeNull();
  expect(harness.overview).toHaveBeenCalledTimes(3);
  view!.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
  expect(harness.overview).toHaveBeenCalledTimes(3);
});


it("does not overlap progress reads or replace unsaved class choices", async () => {
  const value = { admin: true, data: {
    integration, previews: [], capabilities: [], conflicts: [], mapping: { status: "verified" },
    syncRuns: [{ _id: "run", kind: "manual", status: "running", stage: "reconciling", createdAt: 1, counts: {} }],
  } };
  harness.overview.mockResolvedValueOnce(value);
  let resolve!: (value: unknown) => void;
  harness.overview.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  vi.useFakeTimers();
  await act(async () => { render(<ManageBacIntegrationShell />); });
  fireEvent.click(screen.getByRole("button", { name: /^Classes\s*22$/ }));
  fireEvent.click(within(screen.getByRole("listbox")).getAllByRole("option")[1]);
  expect(within(screen.getByRole("listbox")).getAllByRole("option", { selected: true })).toHaveLength(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
  expect(harness.overview).toHaveBeenCalledTimes(2);
  await act(async () => { resolve({ ...value, data: { ...value.data, syncRuns: [{ ...value.data.syncRuns[0], status: "partial", stage: "complete" }] } }); });
  expect(screen.getByRole("button", { name: "Sync now" }).hasAttribute("disabled")).toBe(false);
  expect(within(screen.getByRole("listbox")).getAllByRole("option", { selected: true })).toHaveLength(2);
  expect(harness.candidates).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
  expect(harness.overview).toHaveBeenCalledTimes(2);
});
