// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  harness.overview.mockResolvedValue({ admin: true, data: {
    integration, previews: [], capabilities: [], conflicts: [], syncRuns: [], mapping: { status: "verified" },
  } });
  harness.candidates.mockResolvedValue({ integration, identityRequired: false, classes, selectionRevision: 1 });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

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
  fireEvent.click(screen.getByRole("button", { name: "Overview" }));
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
