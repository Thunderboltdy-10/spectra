// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactConflictResolution, conflictFailureText } from "../components/conversation-surface";
import { getSpectraOperationConflict, resolveSpectraOperationConflict, type SpectraOperation } from "../data/api";
import { compareConflictRegions, readableRegionText } from "../collaboration/region-text";

vi.mock("convex/react", () => ({ useQuery: vi.fn() }));
vi.mock("../data/use-authed-args", () => ({ useAuthedArgs: (value: unknown) => value }));
vi.mock("../data/use-catalog-pages", () => ({ useWorkspaceCatalog: () => ({ items: [], status: "loading", isDone: false, error: null, more: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../data/api", () => ({
  clearSpectraRunAgent: vi.fn(),
  getSpectraOperationConflict: vi.fn(),
  getSpectraThread: vi.fn(),
  getSpectraThreadMessages: vi.fn(),
  getSpectraThreadRunTrace: vi.fn(),
  postSpectra: vi.fn(),
  resolveSpectraOperationConflict: vi.fn(async () => ({ queued: true })),
  submitSpectraAgentFeedback: vi.fn(),
}));
vi.mock("../events", () => ({ spectraBus: { emit: vi.fn(), on: vi.fn(() => () => {}) } }));
vi.mock("../ai/use-spectra-run", () => ({ useSpectraRun: () => ({}) }));
vi.mock("../collaboration/run-ledger", () => ({ operationCounts: () => ({}), useRunLedger: () => undefined }));
vi.mock("../runs/live-dock", () => ({ publicSpectraFailureText: () => "" }));
vi.mock("@/components/spectra-mark", () => ({ SpectraMark: () => <span aria-hidden="true" /> }));
vi.mock("@/components/spectra-prism-optic", () => ({ PrismLoader: () => <span aria-hidden="true" /> }));
vi.mock("../components/spectra-rich-content", () => ({ SpectraRichContent: () => null }));
vi.mock("../components/progress-trace", () => ({ ProgressTrace: () => null }));
vi.mock("../components/artifact-embed-host", () => ({ ArtifactEmbedList: () => null }));
vi.mock("../components/result-card", () => ({ ResultCardStack: () => null }));
vi.mock("@/components/ui/select", () => ({ SelectField: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const paragraph = (text: string) => ({
  artifactType: "document",
  regions: [{ regionId: "block-7f3a9c2e1d4b5a6f", label: "Paragraph: The water cycle", value: { id: "block-7f3a9c2e1d4b5a6f", type: "paragraph", text } }],
});

const operation = {
  _id: "operation-1",
  runId: "run-1",
  type: "artifact.update",
  status: "waiting",
  conflict: { claimId: "claim-1", artifactId: "work-1", clientId: "client-1", regionId: "block-7f3a9c2e1d4b5a6f",
    blockerActorKind: "human", queuePosition: 1, baseSnapshot: paragraph("Water evaporates."), createdAt: 1 },
} as unknown as SpectraOperation;

function conflict(claimStatus: "paused" | "queued") {
  vi.mocked(getSpectraOperationConflict).mockResolvedValue({
    conflict: {
      runId: "run-1", executionId: "attempt-1", operationId: "operation-1", operationType: "artifact.update",
      input: { artifactId: "work-1", content: { blocks: [] } },
      conflict: { ...operation.conflict!, proposedSnapshot: paragraph("Water evaporates, condenses and falls as rain.") },
      claimStatus, currentStateVectorHash: "state-vector-hash-0001",
      currentSnapshot: paragraph("Water evaporates from the sea."),
    },
  });
}

describe("edit conflict view", () => {
  it("compares both sides in the document's own words, without internals", async () => {
    conflict("paused");
    const { container } = render(<ArtifactConflictResolution operation={operation} />);
    await screen.findByText("Water evaporates from the sea.");
    expect(screen.getByText("Water evaporates, condenses and falls as rain.")).toBeTruthy();
    expect(screen.getByText("Paragraph: The water cycle")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/[{}]|block-7f3a|regionId|"type"|JSON|region/);
    expect(container.querySelector("textarea, pre")).toBeNull();
    expect(screen.queryByText("Water evaporates.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review both" }));
    expect(screen.getByText("Water evaporates.")).toBeTruthy();
    expect(screen.getByText("Before Spectra started")).toBeTruthy();
  });

  it("keeps the underlying resolutions: keep the saved version and use Spectra's change", async () => {
    conflict("paused");
    render(<ArtifactConflictResolution operation={operation} />);
    fireEvent.click(await screen.findByRole("button", { name: "Keep the saved version" }));
    await waitFor(() => expect(resolveSpectraOperationConflict).toHaveBeenCalledWith("operation-1", "keep_current"));
    fireEvent.click(screen.getByRole("button", { name: "Use Spectra’s change" }));
    await waitFor(() => expect(resolveSpectraOperationConflict).toHaveBeenCalledWith("operation-1", "apply"));
  });

  it("waits, and never offers Spectra's change while the other edit is still going", async () => {
    conflict("queued");
    render(<ArtifactConflictResolution operation={operation} />);
    const waiting = await screen.findByRole("button", { name: "Waiting for the other edit" });
    expect((waiting as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/won't overwrite it/)).toBeTruthy();
  });

  it("turns resolution codes into plain words", () => {
    expect(conflictFailureText(new Error("REGION_CONFLICT_STILL_OCCUPIED: Wait for the active edit to finish."), "x"))
      .toBe("The other edit is still going. Try again when it finishes.");
    expect(conflictFailureText(new Error("REGION_CONFLICT_NOT_RESOLVED: This proposal is no longer available."), "x"))
      .toMatch(/no longer available/);
    expect(conflictFailureText(new Error("[CONVEX M(spectraOperations:resume)] Server Error"), "Try again.")).toBe("Try again.");
  });
});

describe("region text", () => {
  it("reads cell values, slide text and titles, never markers, ids or layout numbers", () => {
    expect(readableRegionText({ value: 42, formula: "=SUM(A1:A3)", format: { bold: true, indent: 2 } })).toBe("42 =SUM(A1:A3)");
    expect(readableRegionText({ id: "slide-1", title: "Photosynthesis", elements: [
      { $spectraRegion: "slide-1:element-1" },
      { id: "element-2", type: "text", text: "Light becomes sugar", x: 120, y: 40, w: 300, h: 80, style: { color: "accent" } },
    ] })).toBe("Photosynthesis Light becomes sugar");
    expect(readableRegionText("My essay title")).toBe("My essay title");
  });

  it("reads a truncated snapshot's words, not its JSON", () => {
    const preview = JSON.stringify({ id: "block-1", type: "paragraph", text: "A very long paragraph" }).slice(0, -1);
    expect(readableRegionText({ preview, omittedCharacters: 1 }, { truncated: true })).toBe("A very long paragraph");
    const cut = JSON.stringify({ id: "block-1", text: "Cut in the middle of a sentence" }).slice(0, 40);
    expect(readableRegionText({ preview: cut, omittedCharacters: 9 }, { truncated: true })).toBe("Cut in the middl");
  });

  it("orders changed parts and never shows a raw region id as a label", () => {
    const rows = compareConflictRegions({
      before: { regions: [{ regionId: "cell-9", label: "cell-9", value: { value: 1 } }] },
      saved: { regions: [{ regionId: "cell-9", label: "cell-9", value: { value: 2 } }] },
    });
    expect(rows).toEqual([{ regionId: "cell-9", label: "Changed part", before: "1", saved: "2" }]);
  });
});
