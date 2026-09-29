// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestSpectra: vi.fn(),
  fetchMyClassCandidates: vi.fn(),
  syncSpectraManageBac: vi.fn(),
}));
vi.mock("../data/request", () => ({ requestSpectra: mocks.requestSpectra }));
vi.mock("../components/class-shelf-picker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../components/class-shelf-picker")>()),
  fetchMyClassCandidates: mocks.fetchMyClassCandidates,
}));
vi.mock("../data/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/api")>()),
  syncSpectraManageBac: mocks.syncSpectraManageBac,
}));

import { SchoolDataShell } from "../pages/school-data-shell";

function overviewResponse() {
  return new Response(
    JSON.stringify({ admin: false, data: { integration: null, records: [] } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  mocks.requestSpectra.mockImplementation(async () => overviewResponse());
  mocks.fetchMyClassCandidates.mockResolvedValue({
    classes: [],
    identityRequired: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openSchool() {
  render(<SchoolDataShell />);
  await waitFor(() =>
    expect(screen.queryByText("Loading verified school records…")).toBeNull(),
  );
  return screen.getByRole("button", { name: /Sync now/ });
}

describe("School page actions", () => {
  it("keeps the page on screen while Sync now refreshes it", async () => {
    const sync = await openSchool();
    let finishReload: (value: Response) => void = () => {};
    mocks.syncSpectraManageBac.mockResolvedValue({});
    mocks.requestSpectra.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (finishReload = resolve)),
    );
    fireEvent.click(sync);
    await waitFor(() => expect(mocks.requestSpectra).toHaveBeenCalledTimes(2));
    // The reload is in flight: the page stays, no full-page spinner.
    expect(screen.queryByText("Loading verified school records…")).toBeNull();
    expect(screen.getByRole("button", { name: /Sync now/ })).toBeTruthy();
    await act(async () => finishReload(overviewResponse()));
  });

  it("says a failed sync did not finish, instead of claiming School could not load", async () => {
    const sync = await openSchool();
    mocks.syncSpectraManageBac.mockRejectedValue(new Error("ManageBac is busy. Try again in a minute."));
    fireEvent.click(sync);
    expect(await screen.findByText("Sync did not finish")).toBeTruthy();
    expect(screen.queryByText("School could not load")).toBeNull();
    // The school records are still there to read.
    expect(screen.getByRole("button", { name: /Sync now/ })).toBeTruthy();
  });
});
