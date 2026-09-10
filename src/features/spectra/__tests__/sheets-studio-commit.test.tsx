// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInteractionPresence } from "../collaboration/use-interaction-presence";
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

const denseWorkbook = {
  ...initialWorkbook,
  sheets: [
    {
      ...initialWorkbook.sheets[0],
      cells: Object.fromEntries(
        Array.from({ length: 1_800 }, (_, index) => {
          const row = Math.floor(index / 15) + 1;
          const column = String.fromCharCode(65 + (index % 15));
          return [`${column}${row}`, { value: `Dense ${index + 1}` }];
        }),
      ),
      rowCount: 120,
      columnCount: 15,
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

  it("commits one dense-workbook formula input without a render/update loop", async () => {
    const changes: unknown[] = [];
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    function DenseHost() {
      const [content, setContent] = useState<unknown>(denseWorkbook);
      return (
        <SheetsStudio
          artifactId="dense-workbook-1"
          content={content}
          onChange={(next) => {
            changes.push(next);
            setContent(next);
          }}
        />
      );
    }

    render(<DenseHost />);
    const formulaBar = screen.getByLabelText("Formula for A1");
    const started = performance.now();
    fireEvent.change(formulaBar, { target: { value: "RCV1-REACT-A1" } });
    fireEvent.keyDown(formulaBar, { key: "Enter" });

    await waitFor(() => expect(changes).toHaveLength(1));
    expect(performance.now() - started).toBeLessThan(250);
    const committed = changes[0] as {
      sheets: Array<{ cells: Record<string, { value?: unknown }> }>;
    };
    expect(committed.sheets[0]!.cells.A1?.value).toBe("RCV1-REACT-A1");
    expect(committed.sheets[0]!.cells.B1?.value).toBe("Dense 2");
    expect(committed.sheets[0]!.cells.O120?.value).toBe("Dense 1800");
    expect(
      consoleError.mock.calls.some(([message]) =>
        String(message).includes("Maximum update depth"),
      ),
    ).toBe(false);
  });

  it("accepts an incoming chart-only revision after a local cell edit", async () => {
    const changes: unknown[] = [];
    const { rerender, container } = render(
      <SheetsStudio
        artifactId="workbook-1"
        content={initialWorkbook}
        onChange={(next) => changes.push(next)}
      />,
    );
    const formulaBar = screen.getByLabelText("Formula for A1");
    fireEvent.change(formulaBar, { target: { value: "Cell revision" } });
    fireEvent.keyDown(formulaBar, { key: "Enter" });
    await waitFor(() => expect(changes).toHaveLength(1));
    const local = changes[0] as typeof initialWorkbook;
    const incoming = {
      ...local,
      sheets: [
        {
          ...local.sheets[0]!,
          charts: [
            {
              id: "chart-1",
              type: "column" as const,
              sourceRange: "A1:A1",
              title: "Incoming chart",
              position: { x: 0, y: 0, width: 280, height: 220 },
            },
          ],
        },
      ],
    };
    rerender(
      <SheetsStudio
        artifactId="workbook-1"
        content={incoming}
        onChange={(next) => changes.push(next)}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector(".sheets-chart-object")).toBeTruthy(),
    );
    expect(changes).toHaveLength(1);
    expect((formulaBar as HTMLInputElement).value).toBe("Cell revision");
  });

  it("keeps native formula input ahead of synchronous presence reconciliation", async () => {
    const changes: unknown[] = [];
    const listeners = new Set<() => void>();
    let presenceRevision = 0;
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);

    const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    const getSnapshot = () => presenceRevision;

    function PresenceComposedHost() {
      useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
      const surfaceRef = useRef<HTMLDivElement>(null);
      const [content, setContent] = useState<unknown>(initialWorkbook);
      const publish = useCallback(
        (state: Parameters<
          typeof useInteractionPresence
        >[0]["onPublish"] extends (value: infer Value) => void
          ? Value
          : never) => {
          if (state?.act.kind !== "type") return;
          presenceRevision += 1;
          for (const listener of listeners) listener();
        },
        [],
      );

      useInteractionPresence({
        artifactId: "workbook-1",
        typeKey: "sheets",
        actor: {
          clientId: "local-client",
          kind: "human",
          name: "Local user",
        },
        surfaceRef,
        onPublish: publish,
      });

      return (
        <div ref={surfaceRef} data-spectra-surface>
          <SheetsStudio
            artifactId="workbook-1"
            content={content}
            onChange={(next) => {
              changes.push(next);
              setContent(next);
            }}
          />
        </div>
      );
    }

    render(<PresenceComposedHost />);
    const formulaBar = screen.getByLabelText("Formula for A1");
    formulaBar.focus();
    now += 100;
    fireEvent.input(formulaBar, {
      target: { value: "RCV1-PRESENCE-A1" },
    });

    await waitFor(() =>
      expect((formulaBar as HTMLInputElement).value).toBe(
        "RCV1-PRESENCE-A1",
      ),
    );
    fireEvent.keyDown(formulaBar, { key: "Enter" });

    await waitFor(() => expect(changes).toHaveLength(1));
    expect(
      (
        changes[0] as {
          sheets: Array<{ cells: Record<string, { value?: unknown }> }>;
        }
      ).sheets[0]!.cells.A1?.value,
    ).toBe("RCV1-PRESENCE-A1");
  });
});


describe("SheetsStudio normalize-on-emit", () => {
  it("emits normalizeSheetsContent on commit paths like whiteboard/presentation", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(
      resolve(__dirname, "../components/sheets-studio.tsx"),
      "utf8",
    );
    expect(source).toContain(
      "const normalized = normalizeSheetsContent(committed)",
    );
    expect(source).toContain(
      "normalizeSheetsContent({ ...current, activeSheetId: sheetId })",
    );
    // No raw onChange of un-normalized workbook snapshots.
    expect(source).not.toMatch(/onChange\(committed\)/);
    expect(source).not.toMatch(/onChange\(previous\)/);
  });
});
