// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const searchSpectra = vi.fn();
const semantic = vi.hoisted(() => ({ search: vi.fn() }));

vi.mock("../data/api", () => ({
  searchSpectra: (...args: unknown[]) => searchSpectra(...args),
  getSpectraThreads: vi.fn(async () => []),
  postSpectra: vi.fn(),
}));
vi.mock("../../../../convex/_generated/api", () => ({
  api: { semantic: { search: "search", searchThreads: "searchThreads", related: "related" } },
}));
vi.mock("convex/react", () => ({ useAction: (name: string) => (name === "search" ? semantic.search : vi.fn()) }));

import { GlobalSearch } from "../components/context-controls";
import { clearLandings, pendingLanding } from "../anchors/open-anchor";

const workspace = {
  _id: "ws-1",
  title: "Biology HL",
  description: "Cells and genetics",
};

const workResult = {
  kind: "artifact",
  itemId: "work-1",
  title: "Cell respiration notes",
  typeLabel: "Document",
  subtype: "document",
  snippet: "Glycolysis happens in the cytoplasm",
  location: "Heading: Glycolysis",
  score: 0.9,
  matchedBy: ["meaning"],
  ownership: "mine",
  anchor: { kind: "artifact", artifactId: "work-1" },
};

function renderSearch(onOpenWorkspace = vi.fn(), onOpenArtifact = vi.fn(), openItemIds?: string[]) {
  render(
    <GlobalSearch
      trigger="icon"
      onOpenArtifact={onOpenArtifact}
      onOpenWorkspace={onOpenWorkspace}
      openItemIds={openItemIds}
    />,
  );
  return { onOpenWorkspace, onOpenArtifact };
}

async function openAndSearch(term: string) {
  const trigger = screen.getByRole("button", { name: "Search artifacts and workspaces" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Search Spectra" });
  const field = dialog.querySelector("input")!;
  fireEvent.change(field, { target: { value: term } });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260));
  });
  return trigger;
}

describe("GlobalSearch", () => {
  afterEach(() => {
    cleanup();
    searchSpectra.mockReset();
    semantic.search.mockReset();
  });

  it("gives focus back to the search button after a result is chosen", async () => {
    searchSpectra.mockResolvedValue({ artifacts: [], workspaces: [workspace] });
    semantic.search.mockResolvedValue({ results: [], mode: "hybrid", tookMs: 3 });
    const { onOpenWorkspace } = renderSearch();
    const trigger = await openAndSearch("bio");
    fireEvent.click(await screen.findByRole("button", { name: /Biology HL/ }));
    expect(onOpenWorkspace).toHaveBeenCalledWith(workspace);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("finds work through the semantic layer and opens it by id", async () => {
    searchSpectra.mockResolvedValue({ artifacts: [], workspaces: [] });
    semantic.search.mockResolvedValue({ results: [workResult], mode: "hybrid", tookMs: 3 });
    const { onOpenArtifact } = renderSearch(vi.fn(), vi.fn(), ["open-work"]);
    await openAndSearch("respiration");
    expect(semantic.search).toHaveBeenCalledWith(expect.objectContaining({
      query: "respiration",
      kinds: ["artifact"],
      hints: expect.objectContaining({ openItemIds: ["open-work"] }),
    }));
    const row = await screen.findByRole("button", { name: /Cell respiration notes/ });
    expect(row.textContent).toContain("Document · Heading: Glycolysis");
    fireEvent.click(row);
    expect(onOpenArtifact).toHaveBeenCalledWith("work-1");
  });

  it("opens an artifact at the passage that matched", async () => {
    clearLandings();
    searchSpectra.mockResolvedValue({ artifacts: [], workspaces: [] });
    semantic.search.mockResolvedValue({
      results: [{ ...workResult, anchor: { kind: "artifact", artifactId: "work-1", regionId: "b7", label: "Heading: Glycolysis" } }],
      mode: "hybrid",
      tookMs: 3,
    });
    let landing: unknown;
    const { onOpenArtifact } = renderSearch(vi.fn(), vi.fn((workId: string) => { landing = pendingLanding(workId)?.region; }));
    await openAndSearch("respiration");
    fireEvent.click(await screen.findByRole("button", { name: /Cell respiration notes/ }));
    expect(onOpenArtifact).toHaveBeenCalledWith("work-1");
    expect(landing).toEqual({ id: "b7", label: "Heading: Glycolysis", excerpt: "Glycolysis happens in the cytoplasm" });
    clearLandings();
  });

  it("says quietly when only exact words could be matched", async () => {
    searchSpectra.mockResolvedValue({ artifacts: [], workspaces: [] });
    semantic.search.mockResolvedValue({ results: [workResult], mode: "words_only", degraded: { reason: "embeddings_unavailable" }, tookMs: 3 });
    renderSearch();
    await openAndSearch("respiration");
    expect(await screen.findByText("Matching exact words only right now.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Cell respiration notes/ })).toBeTruthy();
  });

  it("says why the search failed and searches again on retry", async () => {
    searchSpectra.mockResolvedValue({ artifacts: [], workspaces: [] });
    semantic.search.mockRejectedValueOnce(new Error("Search is busy. Try again in a moment."));
    renderSearch();
    await openAndSearch("cells");
    expect((await screen.findByRole("alert")).textContent).toContain("Search is busy. Try again in a moment.");
    semantic.search.mockResolvedValue({ results: [workResult], mode: "hybrid", tookMs: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Retry search" }));
    expect(await screen.findByRole("button", { name: /Cell respiration notes/ })).toBeTruthy();
  });

  it("starts a fresh search each time it opens", async () => {
    searchSpectra.mockResolvedValue({ artifacts: [], workspaces: [workspace] });
    semantic.search.mockResolvedValue({ results: [], mode: "hybrid", tookMs: 3 });
    renderSearch();
    await openAndSearch("bio");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Search artifacts and workspaces" }));
    const dialog = await screen.findByRole("dialog", { name: "Search Spectra" });
    expect(dialog.querySelector("input")!.value).toBe("");
    expect(screen.queryByRole("button", { name: /Biology HL/ })).toBeNull();
  });
});
