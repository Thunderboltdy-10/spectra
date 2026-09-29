// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SheetsStudio } from "../components/sheets-studio";

type Workbook = {
  sheets: Array<{ cells: Record<string, { value?: unknown }> }>;
};

const initialWorkbook = {
  workbook: { calculationMode: "automatic", locale: "en-US" },
  activeSheetId: "sheet-1",
  sheets: [
    {
      id: "sheet-1",
      name: "Sheet1",
      cells: { A1: { value: "Inside" } },
      tables: [],
      rowCount: 20,
      columnCount: 10,
    },
  ],
};

function clipboardData(initial = "") {
  const store = new Map<string, string>([["text/plain", initial]]);
  return {
    getData: (type: string) => store.get(type) ?? "",
    setData: (type: string, value: string) => void store.set(type, value),
    store,
  };
}

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderHost() {
  const state: { latest: Workbook | null } = { latest: null };
  function Host() {
    const [content, setContent] = useState<unknown>(initialWorkbook);
    return (
      <SheetsStudio
        artifactId="workbook-clipboard"
        content={content}
        onChange={(next) => {
          state.latest = next as Workbook;
          setContent(next);
        }}
      />
    );
  }
  render(<Host />);
  return state;
}

describe("SheetsStudio clipboard", () => {
  it("copies the selection to the system clipboard through the native event", () => {
    renderHost();
    const grid = screen.getByRole("grid");
    const data = clipboardData();
    fireEvent.copy(grid, { clipboardData: data });
    expect(data.store.get("text/plain")).toBe("Inside");
  });

  it("pastes what was copied elsewhere, not an older in-sheet copy", async () => {
    const state = renderHost();
    const grid = screen.getByRole("grid");
    fireEvent.copy(grid, { clipboardData: clipboardData() });

    // The person then copies two cells from another application.
    fireEvent.paste(grid, { clipboardData: clipboardData("From\tExcel") });

    await waitFor(() => expect(state.latest).not.toBeNull());
    const cells = state.latest!.sheets[0]!.cells;
    expect(cells.A1?.value).toBe("From");
    expect(cells.B1?.value).toBe("Excel");
  });

  it("still pastes Spectra's own block while the clipboard holds it", async () => {
    const state = renderHost();
    const grid = screen.getByRole("grid");
    fireEvent.copy(grid, { clipboardData: clipboardData() });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.paste(grid, { clipboardData: clipboardData("Inside\r\n") });

    await waitFor(() => expect(state.latest).not.toBeNull());
    expect(state.latest!.sheets[0]!.cells.B1?.value).toBe("Inside");
  });
});
