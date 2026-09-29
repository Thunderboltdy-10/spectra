// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CitationSourcePickers } from "../components/document-citation-pickers";
import type { WordSource } from "../lenses/docx-citation-schema";

// The citation panel's pickers are the shared Select. "New supplied source"
// maps to a sentinel because Radix rejects an empty-string item value.

const sources = [
  { tag: "Smi20", sourceType: "Book", title: "Cell Biology" },
  { tag: "Doe21", sourceType: "Report", title: "" },
] as WordSource[];

beforeEach(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(cleanup);

async function choose(name: string, option: string) {
  const trigger = screen.getByRole("combobox", { name });
  expect(trigger.tagName).toBe("BUTTON");
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "Enter" });
  });
  await act(async () => {
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
  });
}

function renderPickers(source?: WordSource) {
  const handlers = { onChooseSource: vi.fn(), onNewSource: vi.fn(), onSourceType: vi.fn() };
  render(<CitationSourcePickers sources={sources} source={source} showSources {...handlers} />);
  return handlers;
}

describe("citation source pickers", () => {
  it("shows a new citation as a new supplied source and reuses an existing one", async () => {
    const handlers = renderPickers();
    expect(screen.getByRole("combobox", { name: "Existing Word source" }).textContent).toContain("New supplied source");
    await choose("Existing Word source", "Cell Biology");
    expect(handlers.onChooseSource).toHaveBeenCalledWith(sources[0]);
  });

  it("goes back to a new supplied source, and labels an untitled source by its tag", async () => {
    const handlers = renderPickers(sources[0]);
    expect(screen.getByRole("combobox", { name: "Existing Word source" }).textContent).toContain("Cell Biology");
    await choose("Existing Word source", "New supplied source");
    expect(handlers.onNewSource).toHaveBeenCalledTimes(1);
    await choose("Existing Word source", "Doe21");
    expect(handlers.onChooseSource).toHaveBeenCalledWith(sources[1]);
  });

  it("sets the source type, Unspecified by default", async () => {
    const handlers = renderPickers();
    expect(screen.getByRole("combobox", { name: "Source type" }).textContent).toContain("Unspecified");
    await choose("Source type", "Journal article");
    expect(handlers.onSourceType).toHaveBeenCalledWith("JournalArticle");
  });

  it("hides the existing-source picker when there is nothing to reuse", () => {
    render(
      <CitationSourcePickers sources={[]} showSources onChooseSource={() => {}} onNewSource={() => {}} onSourceType={() => {}} />,
    );
    expect(screen.queryByRole("combobox", { name: "Existing Word source" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Source type" })).toBeTruthy();
  });
});
