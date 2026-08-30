// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SheetsStudio } from "../components/sheets-studio";

const initialWorkbook = {
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
  vi.restoreAllMocks();
});

describe("SheetsStudio commits", () => {
  it("cancels a formula-bar draft without committing it", () => {
    const changes: unknown[] = [];
    render(
      <SheetsStudio
        artifactId="workbook-1"
        content={initialWorkbook}
        onChange={(next) => changes.push(next)}
      />,
    );

    const formulaBar = screen.getByLabelText("Formula for A1");
    formulaBar.focus();
    fireEvent.change(formulaBar, { target: { value: "Discard this draft" } });
    fireEvent.keyDown(formulaBar, { key: "Escape" });

    expect(changes).toHaveLength(0);
    expect((formulaBar as HTMLInputElement).value).toBe("Input");
  });

  it("notifies a stateful parent outside React's state-updater render phase", async () => {
    const changes: unknown[] = [];
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    function Host() {
      const [content, setContent] = useState<unknown>(initialWorkbook);
      return (
        <SheetsStudio
          artifactId="workbook-1"
          content={content}
          onChange={(next) => {
            changes.push(next);
            setContent(next);
          }}
        />
      );
    }

    render(<Host />);
    const formulaBar = screen.getByLabelText("Formula for A1");
    fireEvent.change(formulaBar, { target: { value: "Input via Spectra" } });
    fireEvent.blur(formulaBar);

    await waitFor(() => expect(changes).toHaveLength(1));
    expect(
      (
        changes[0] as {
          sheets: Array<{ cells: Record<string, { value?: unknown }> }>;
        }
      ).sheets[0]!.cells.A1?.value,
    ).toBe("Input via Spectra");
    expect(
      consoleError.mock.calls.some(([message]) =>
        String(message).includes("Cannot update a component"),
      ),
    ).toBe(false);
  });
});
