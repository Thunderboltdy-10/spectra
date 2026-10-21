// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpectraArtifact } from "../../data/api";

const mocks = vi.hoisted(() => ({ load: vi.fn(), fetch: vi.fn(), replicas: [] as Array<Record<string, unknown>> }));

vi.mock("convex/react", () => ({
  // activeMounts is the one query called with no arguments.
  useQuery: (_query: unknown, args: object) => (Object.keys(args).length === 0 ? [] : { replicas: mocks.replicas }),
  useMutation: () => vi.fn(),
}));
vi.mock("../../data/use-authed-args", () => ({ useAuthedArgs: <T,>(args: T) => args }));
vi.mock("@/features/spectra/hooks/use-spectra-router", () => ({ useSpectraRouter: () => ({ push: vi.fn() }) }));
vi.mock("../../components/use-work-availability", () => ({ useWorkAvailability: () => undefined }));
vi.mock("../use-sync-presentation", () => ({ useSyncPresentation: () => ({ label: "Kept in Spectra", detail: "", disclosure: [] }) }));
vi.mock("../use-bridge", () => ({ useBridgeHealth: () => ({ reachability: "not-set-up" }) }));
vi.mock("../file-storage-controls", () => ({ FileStorageControls: () => null }));
vi.mock("../../files/office-preview-client", async (original) => ({
  ...(await original<typeof import("../../files/office-preview-client")>()),
  loadOfficePreview: mocks.load,
}));

import { ResourceSurface } from "../resource-surface";

function artifact(title: string, nativeFormat: string) {
  return { _id: `work-${nativeFormat}`, title, nativeFormat, blueprintKey: "resource" } as unknown as SpectraArtifact;
}

beforeAll(async () => {
  await import("../../files/office-view");
}, 30_000);
beforeEach(() => {
  mocks.load.mockReset();
  mocks.fetch.mockReset();
  mocks.replicas = [{ kind: "cloud", state: "current", payloadRef: "blob-1" }];
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("A Library file's read-only view", () => {
  it("shows a PDF in the shared viewer instead of an icon alone", async () => {
    render(<ResourceSurface artifact={artifact("Syllabus.pdf", "pdf")} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTitle("Syllabus.pdf").getAttribute("src")).toBe("/api/spectra/native?artifactId=work-pdf");
  });

  it("still reads an Office file when it can't open as editable work", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ message: "This Excel file could not be opened safely." }), { status: 422 }));
    mocks.load.mockResolvedValue({
      kind: "sheet",
      activeSheetId: "s",
      sheets: [{ id: "s", name: "Budget", rowCount: 24, columnCount: 8, frozenRows: 0, frozenColumns: 0, hiddenRows: [], hiddenColumns: [], columnWidths: {}, rowHeights: {}, merges: [], conditional: {}, notes: {}, charts: [], pictures: [], showGridlines: true, clipped: false, cells: { A1: { text: "Rent" } } }],
      media: [],
    });
    render(<ResourceSurface artifact={artifact("Budget.xlsx", "xlsx")} onClose={() => {}} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(await screen.findByRole("region", { name: "Budget, read-only" })).toBeTruthy();
    expect(mocks.load).toHaveBeenCalledWith({ kind: "sheet", url: "/api/spectra/native?artifactId=work-xlsx", bytes: undefined }, expect.any(AbortSignal));
  });

  it("names an older Office format honestly and offers no viewer", () => {
    render(<ResourceSurface artifact={artifact("Report.doc", "doc")} onClose={() => {}} />);
    expect(screen.getByText(/save it as \.docx, \.pptx or \.xlsx/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View" })).toBeNull();
  });

  it("offers nothing to view before the file's bytes are in Spectra", async () => {
    mocks.replicas = [{ kind: "local", state: "current" }];
    render(<ResourceSurface artifact={artifact("Syllabus.pdf", "pdf")} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "View" })).toBeNull());
  });
});
