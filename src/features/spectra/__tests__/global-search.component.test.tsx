// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const searchSpectra = vi.fn();

vi.mock("../data/api", () => ({
  searchSpectra: (...args: unknown[]) => searchSpectra(...args),
  getSpectraThreads: vi.fn(async () => []),
  postSpectra: vi.fn(),
}));

import { GlobalSearch } from "../components/context-controls";

const workspace = {
  _id: "ws-1",
  title: "Biology HL",
  description: "Cells and genetics",
};

function renderSearch(onOpenWorkspace = vi.fn()) {
  render(
    <GlobalSearch
      trigger="icon"
      onOpenArtifact={vi.fn()}
      onOpenWorkspace={onOpenWorkspace}
    />,
  );
  return onOpenWorkspace;
}

async function openAndSearch(term: string) {
  const trigger = screen.getByRole("button", { name: "Search work and workspaces" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Search Spectra" });
  const field = dialog.querySelector("input")!;
  fireEvent.change(field, { target: { value: term } });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 220));
  });
  return trigger;
}

describe("GlobalSearch", () => {
  afterEach(() => {
    cleanup();
    searchSpectra.mockReset();
  });

  it("gives focus back to the search button after a result is chosen", async () => {
    searchSpectra.mockResolvedValue({ artifacts: [], workspaces: [workspace] });
    const onOpenWorkspace = renderSearch();
    const trigger = await openAndSearch("bio");
    fireEvent.click(await screen.findByRole("button", { name: /Biology HL/ }));
    expect(onOpenWorkspace).toHaveBeenCalledWith(workspace);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("starts a fresh search each time it opens", async () => {
    searchSpectra.mockResolvedValue({ artifacts: [], workspaces: [workspace] });
    renderSearch();
    await openAndSearch("bio");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Search work and workspaces" }));
    const dialog = await screen.findByRole("dialog", { name: "Search Spectra" });
    expect(dialog.querySelector("input")!.value).toBe("");
    expect(screen.queryByRole("button", { name: /Biology HL/ })).toBeNull();
  });
});
