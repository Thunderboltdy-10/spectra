// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SheetsStudio } from "../components/sheets-studio";

type Workbook = {
  workbook: { calculationMode: string; locale: string };
  activeSheetId: string;
  sheets: Array<{
    id: string;
    name: string;
    cells: Record<string, { value?: unknown }>;
    tables: unknown[];
    rowCount: number;
    columnCount: number;
  }>;
};

const initialWorkbook: Workbook = {
  workbook: { calculationMode: "automatic", locale: "en-US" },
  activeSheetId: "sheet-1",
  sheets: [
    {
      id: "sheet-1",
      name: "Sheet1",
      cells: { A1: { value: "Input" } },
      tables: [],
      rowCount: 20,
      columnCount: 10,
    },
  ],
};

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

describe("SheetsStudio undo with collaborators", () => {
  it("undoes only this person's cell edit and keeps a peer's later edit", async () => {
    let latest: Workbook = initialWorkbook;
    let receiveRemote: (next: Workbook) => void = () => undefined;

    function Host() {
      const [content, setContent] = useState<Workbook>(initialWorkbook);
      receiveRemote = setContent;
      return (
        <SheetsStudio
          artifactId="workbook-undo"
          content={content}
          onChange={(next) => {
            latest = next as Workbook;
            setContent(next as Workbook);
          }}
        />
      );
    }

    render(<Host />);
    const formulaBar = screen.getByLabelText("Formula for A1");
    fireEvent.change(formulaBar, { target: { value: "Mine" } });
    fireEvent.blur(formulaBar);
    await waitFor(() => expect(latest.sheets[0]!.cells.A1?.value).toBe("Mine"));

    // A collaborator fills B2 after the local edit landed.
    const peer: Workbook = {
      ...latest,
      sheets: [
        {
          ...latest.sheets[0]!,
          cells: { ...latest.sheets[0]!.cells, B2: { value: "Peer" } },
        },
      ],
    };
    act(() => receiveRemote(peer));

    fireEvent.keyDown(screen.getByRole("grid"), { key: "z", ctrlKey: true });

    await waitFor(() => expect(latest.sheets[0]!.cells.A1?.value).toBe("Input"));
    expect(latest.sheets[0]!.cells.B2?.value).toBe("Peer");

    fireEvent.keyDown(screen.getByRole("grid"), { key: "y", ctrlKey: true });
    await waitFor(() => expect(latest.sheets[0]!.cells.A1?.value).toBe("Mine"));
    expect(latest.sheets[0]!.cells.B2?.value).toBe("Peer");
  });
});
