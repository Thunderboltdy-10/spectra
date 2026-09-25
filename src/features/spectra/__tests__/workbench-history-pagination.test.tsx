// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchInspectorTabs } from "../components/workbench-inspector-tabs";
import type { SpectraArtifact, SpectraArtifactVersionPage } from "../data/api";

const mocks = vi.hoisted(() => ({ versions: vi.fn(), comments: vi.fn() }));
vi.mock("../data/api", () => ({
  getSpectraArtifactVersions: mocks.versions,
  getSpectraArtifactComments: mocks.comments,
  postSpectra: vi.fn(),
}));
vi.mock("../events", () => ({ spectraBus: { command: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("../components/spectra-rich-content", () => ({ SpectraRichContent: () => null }));
vi.mock("../compute/autocomplete", () => ({ LocalAutocompleteTextarea: () => null }));
vi.mock("../components/spectra-view-model", () => ({ formatRelativeTime: () => "Earlier" }));

const work = (id: string) => ({ _id: id, title: id, blueprintKey: "document", createdAt: 1, updatedAt: 1 }) as SpectraArtifact;
const page = (artifactId: string, title: string, cursor: string | null = null): SpectraArtifactVersionPage => ({
  versions: [{ _id: title, artifactId, source: "import", summary: title, createdAt: 2 }],
  continueCursor: cursor, isDone: cursor === null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.versions.mockReset();
  mocks.comments.mockReset().mockResolvedValue({ comments: [] });
});
afterEach(cleanup);

describe("workbench history metadata pages", () => {
  it("loads older pages only when requested and preserves loaded versions", async () => {
    mocks.versions.mockResolvedValueOnce(page("a", "Newest", "older-cursor"))
      .mockResolvedValueOnce(page("a", "Oldest"));
    render(<WorkbenchInspectorTabs work={work("a")} overview={<div>Overview</div>} />);
    expect(mocks.versions).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    await screen.findByText("Newest");
    expect(mocks.versions).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Load older versions" }));
    await screen.findByText("Oldest");
    expect(screen.queryByText("Newest")).not.toBeNull();
    expect(mocks.versions).toHaveBeenLastCalledWith("a", 20, "older-cursor", expect.anything());
    expect(screen.queryByRole("button", { name: "Load older versions" })).toBeNull();
  });

  it("shows a retry for a failed page without erasing previously loaded metadata", async () => {
    mocks.versions.mockResolvedValueOnce(page("a", "Newest", "older-cursor"))
      .mockRejectedValueOnce(new Error("Connection interrupted"))
      .mockResolvedValueOnce(page("a", "Oldest"));
    render(<WorkbenchInspectorTabs work={work("a")} overview={null} />);
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    await screen.findByText("Newest");
    fireEvent.click(screen.getByRole("button", { name: "Load older versions" }));
    await screen.findByRole("alert");
    expect(screen.queryByText("Newest")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry history" }));
    await screen.findByText("Oldest");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("aborts a prior artifact request and ignores a late response even when the reader ignores abort", async () => {
    const old = deferred<SpectraArtifactVersionPage>();
    let oldSignal: AbortSignal | undefined;
    mocks.versions.mockImplementation((id: string, _limit: number, _cursor: string | undefined, signal: AbortSignal) => {
      if (id === "a") { oldSignal = signal; return old.promise; }
      return Promise.resolve(page("b", "Current source history"));
    });
    const view = render(<WorkbenchInspectorTabs work={work("a")} overview={null} />);
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    await waitFor(() => expect(oldSignal).toBeDefined());
    view.rerender(<WorkbenchInspectorTabs work={work("b")} overview={null} />);
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    await screen.findByText("Current source history");
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => old.resolve(page("a", "Stale source history")));
    expect(screen.queryByText("Stale source history")).toBeNull();
    expect(screen.queryByText("Current source history")).not.toBeNull();
  });
});
