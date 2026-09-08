// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mergedRowEndPosition,
  projectExcelJsFormulaValue,
  SheetsStudio,
} from "../components/sheets-studio";

/**
 * What the grid actually paints.
 *
 * A registered command that flips a stored flag nothing renders is the worst
 * kind of feature: it photographs perfectly and does nothing. These tests read
 * the DOM for the states the workbar can set — gridlines, headers, formula view,
 * cell borders, sheet protection — so a toggle cannot ship as decoration.
 */

function workbook(overrides?: {
  sheet?: Record<string, unknown>;
  sheets?: Array<Record<string, unknown>>;
}) {
  return {
    workbook: { calculationMode: "automatic", locale: "en-US" },
    activeSheetId: "sheet-1",
    sheets: overrides?.sheets ?? [
      {
        id: "sheet-1",
        name: "Sheet1",
        rowCount: 20,
        columnCount: 8,
        tables: [],
        cells: { A1: { value: "Input" }, A2: { value: 4 } },
        ...overrides?.sheet,
      },
    ],
  };
}

function mount(content: unknown) {
  return render(
    <SheetsStudio
      artifactId="workbook-1"
      content={content}
      onChange={() => {}}
    />,
  );
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

describe("Excel import geometry and formula projections", () => {
  it("keeps ExcelJS cached results with their native formula support", () => {
    expect(
      projectExcelJsFormulaValue({
        formula: "XLOOKUP(A2,A:A,B:B)",
        result: 500,
      }),
    ).toMatchObject({
      formula: "=XLOOKUP(A2,A:A,B:B)",
      value: 500,
      nativeFormulaSupport: "cached-only",
    });
    expect(
      projectExcelJsFormulaValue({ formula: "SUM(B2:B3)", result: 60 }),
    ).toMatchObject({
      formula: "=SUM(B2:B3)",
      value: 60,
      nativeFormulaSupport: "recognized",
    });
    expect(
      projectExcelJsFormulaValue({ formula: "INDEX(A1:B2,2,2)", result: 20 }),
    ).toMatchObject({ nativeFormulaSupport: "recognized", value: 20 });
  });

  it("spans only visible rows when a merge crosses a hidden row", () => {
    expect(mergedRowEndPosition([0, 2, 3, 5], 0, 3)).toBe(2);
    expect(mergedRowEndPosition([0, 2, 3, 5], 1, 3)).toBe(2);
    expect(mergedRowEndPosition([0, 2, 4, 5], 0, 3)).toBe(1);
  });
});

describe("grid view state", () => {
  it("marks the frame when gridlines or headers are hidden", () => {
    const { container } = mount(
      workbook({ sheet: { showGridlines: false, showHeadings: false } }),
    );
    const frame = container.querySelector(".sheets-grid-frame");
    expect(frame?.getAttribute("data-gridlines")).toBe("off");
    expect(frame?.getAttribute("data-headings")).toBe("off");
    // Hiding the headers gives their track back to the grid rather than leaving
    // an empty gutter behind.
    expect(
      (frame as HTMLElement).style.getPropertyValue("--sheet-row-header"),
    ).toBe("0px");
  });

  it("leaves the frame unmarked by default", () => {
    const { container } = mount(workbook());
    const frame = container.querySelector(".sheets-grid-frame");
    expect(frame?.getAttribute("data-gridlines")).toBeNull();
    expect(frame?.getAttribute("data-headings")).toBeNull();
  });
});

describe("cell formatting", () => {
  it("paints every field the format model can hold", () => {
    const navy = "#123456";
    const { container } = mount(
      workbook({
        sheet: {
          cells: {
            A1: {
              value: "Styled",
              format: {
                bold: true,
                strike: true,
                wrap: true,
                rotation: 45,
                indent: 2,
                fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
                borders: {
                  bottom: { style: "double", color: navy },
                  top: { style: "thin" },
                },
              },
            },
          },
        },
      }),
    );
    const cell = container.querySelector('[data-address="A1"]') as HTMLElement;
    expect(cell).toBeTruthy();
    expect(cell.style.fontWeight).toBe("700");
    expect(cell.style.textDecoration).toContain("line-through");
    expect(cell.style.whiteSpace).toBe("pre-wrap");
    // Excel states rotation counter-clockwise; CSS is the other way round.
    expect(cell.style.transform).toBe("rotate(-45deg)");
    expect(cell.style.paddingLeft).toBe("24px");
    expect(cell.style.fontFamily).toContain("Inter");
    expect(cell.style.borderBottom).toBe("2px double rgb(18, 52, 86)");
    expect(cell.style.borderTop).toContain("1px solid");
  });
});

describe("sheet protection", () => {
  it("reads as locked when Excel's protection flag is set", () => {
    mount(workbook({ sheet: { protection: { locked: true } } }));
    const formulaBar = screen.getByLabelText("Formula for A1");
    expect(formulaBar.getAttribute("aria-readonly")).toBe("true");
  });

  it("stays editable when it is not", () => {
    mount(workbook());
    const formulaBar = screen.getByLabelText("Formula for A1");
    expect(formulaBar.getAttribute("aria-readonly")).toBe("false");
  });
});

describe("formula bar", () => {
  it("keeps an in-progress A1 edit when the workbook identity refreshes", () => {
    const { rerender } = render(
      <SheetsStudio
        artifactId="workbook-1"
        content={workbook()}
        onChange={() => {}}
      />,
    );
    const formulaBar = screen.getByLabelText("Formula for A1");
    formulaBar.focus();
    fireEvent.change(formulaBar, { target: { value: "P2V1R-A1" } });
    expect((formulaBar as HTMLInputElement).value).toBe("P2V1R-A1");
    const activeElement = vi
      .spyOn(document, "activeElement", "get")
      .mockReturnValue(document.body);
    rerender(
      <SheetsStudio
        artifactId="workbook-1"
        content={workbook({
          sheet: {
            cells: {
              A1: { value: "Input" },
              A2: { value: 4 },
              Z99: { value: "noise" },
            },
          },
        })}
        onChange={() => {}}
      />,
    );
    activeElement.mockRestore();
    expect(
      (screen.getByLabelText("Formula for A1") as HTMLInputElement).value,
    ).toBe("P2V1R-A1");
  });

  it("does not lift a formula-bar keystroke into the workbook", () => {
    const onChange = vi.fn();
    render(
      <SheetsStudio
        artifactId="workbook-1"
        content={workbook()}
        onChange={onChange}
      />,
    );
    const formulaBar = screen.getByLabelText("Formula for A1");
    formulaBar.focus();
    fireEvent.change(formulaBar, { target: { value: "Typed in the bar" } });
    expect(onChange).not.toHaveBeenCalled();
    expect((formulaBar as HTMLInputElement).value).toBe("Typed in the bar");
    expect(screen.getByText("Input")).toBeTruthy();
  });
});

/*
 * The sheet selector is not asserted here on purpose. It lives inside
 * `ArtifactWorkbar`, which only renders under the studio shell contract, so a
 * bare mount has no bar to read. Its one rule — a hidden sheet is not offered as
 * somewhere to navigate to — is a filter on the items prop in `sheets-studio.tsx`
 * and belongs to the shell-level pass.
 */
