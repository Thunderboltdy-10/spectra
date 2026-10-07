// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import type { PresentationContent } from "../../presentation/model";
import { richContentFromProseMirror } from "../../rich-content/prosemirror";
import { FileViewer } from "../file-viewer";
import { fileViewKind, officeSizeRefusal } from "../file-kind";
import type { OfficePreview } from "../office-preview";

const life = vi.hoisted(() => ({ launchFrom: vi.fn(), useLifeLanding: vi.fn() }));
vi.mock("../../life/use-life", async (original) => ({
  ...(await original<typeof import("../../life/use-life")>()),
  launchFrom: life.launchFrom,
  useLifeLanding: life.useLifeLanding,
}));

const reader = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../office-preview-client", async (original) => ({
  ...(await original<typeof import("../office-preview-client")>()),
  loadOfficePreview: reader.load,
}));

// The Office views load lazily in the app; warm the module so a test waits
// for the file, not for the transform.
beforeAll(async () => {
  await import("../office-view");
}, 30_000);
beforeEach(() => {
  reader.load.mockReset();
  life.launchFrom.mockReset();
  life.useLifeLanding.mockReset();
});
afterEach(cleanup);

describe("fileViewKind", () => {
  it.each([
    ["application/pdf", "essay.pdf", "pdf"],
    ["", "essay.PDF", "pdf"],
    ["image/jpeg", "garden.jpg", "image"],
    ["application/octet-stream", "garden.webp", "image"],
    ["image/svg+xml", "diagram.svg", null],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "essay.docx", "document"],
    ["application/octet-stream", "Lab report.DOCX", "document"],
    ["", "pitch.pptx", "slides"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "data", "sheet"],
    ["", "budget.xlsm", "sheet"],
    ["application/msword", "old.doc", "legacy"],
    ["", "deck.ppt", "legacy"],
    ["application/vnd.ms-excel", "marks", "legacy"],
    [undefined, "notes", null],
  ] as const)("%s %s → %s", (mimeType, filename, kind) => {
    expect(fileViewKind(mimeType, filename)).toBe(kind);
  });

  it("refuses a file past its reader's limit in one plain sentence", () => {
    expect(officeSizeRefusal("slides", 12_000_000)).toBeNull();
    expect(officeSizeRefusal("sheet", 42_000_000)).toBe("This Excel workbook is 42 MB. Spectra shows Excel workbooks up to 30 MB here.");
  });
});

describe("FileViewer: photos and PDFs", () => {
  it("holds a ghost until the kept copy is ready, then shows the PDF in Spectra", () => {
    const { rerender } = render(<FileViewer file={{ key: "f1", filename: "essay.pdf", kind: "pdf" }} onClose={() => {}} />);
    const ghost = screen.getByRole("status", { name: "Opening essay.pdf" });
    expect(ghost.hasAttribute("data-life-ghost")).toBe(true);
    expect(screen.queryByRole("link", { name: "Open in a new tab" })).toBeNull();

    rerender(<FileViewer file={{ key: "f1", filename: "essay.pdf", kind: "pdf", url: "https://files.example/essay" }} onClose={() => {}} />);
    expect(screen.getByTitle("essay.pdf").getAttribute("src")).toBe("https://files.example/essay");
    const link = screen.getByRole("link", { name: "Open in a new tab" });
    expect(link.getAttribute("href")).toBe("https://files.example/essay");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows a photo, and says so in one line when it can't", () => {
    render(<FileViewer file={{ key: "f2", filename: "garden.jpg", kind: "image", url: "https://files.example/garden" }} onClose={() => {}} />);
    const photo = screen.getByRole("img", { name: "garden.jpg" });
    fireEvent.error(photo);
    expect(screen.getByRole("alert").textContent).toContain("garden.jpg didn't show here.");
  });

  it("closes from its close control and carries the caller's actions", () => {
    const onClose = vi.fn();
    render(
      <FileViewer
        file={{ key: "f3", filename: "essay.pdf", kind: "pdf", url: "https://files.example/essay" }}
        onClose={onClose}
        actions={<Button>Copy into Library</Button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Copy into Library" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when no file is open", () => {
    render(<FileViewer file={null} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("FileViewer: older Office files", () => {
  it("names the format honestly and opens no viewer", () => {
    render(
      <FileViewer
        file={{ key: "l1", filename: "marks.xls", kind: "legacy", url: "https://files.example/marks" }}
        onClose={() => {}}
        actions={<Button>Copy into Library</Button>}
      />,
    );
    expect(screen.getByText("marks.xls is an older Office file.")).toBeTruthy();
    expect(screen.getByText(/saved as \.docx, \.pptx or \.xlsx/)).toBeTruthy();
    expect(reader.load).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("link", { name: "Open in a new tab" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy into Library" })).toBeTruthy();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function textObject(id: string, text: string) {
  return { id, type: "text" as const, x: 100, y: 100, width: 800, height: 120, rotation: 0, content: { text }, style: { fontSize: 40 } };
}

const DECK: PresentationContent = {
  theme: { id: "native-pptx", name: "PowerPoint theme" },
  settings: { aspectRatio: "16:9", showSlideNumbers: true },
  slides: [
    { id: "s1", title: "Photosynthesis", objects: [textObject("t1", "Photosynthesis")], speakerNotes: "Start with the leaf." },
    { id: "s2", title: "Light reactions", objects: [textObject("t2", "Light reactions")] },
    { id: "s3", title: "Calvin cycle", objects: [textObject("t3", "Calvin cycle")] },
  ],
} as PresentationContent;

describe("FileViewer: Office files", () => {
  it("shows a Word document on the shared prose renderer once the ghost hands over", async () => {
    const load = deferred<OfficePreview>();
    reader.load.mockReturnValue(load.promise);
    render(<FileViewer file={{ key: "d1", filename: "essay.docx", kind: "document", url: "https://files.example/essay", bytes: 2048 }} onClose={() => {}} />);
    expect(await screen.findByRole("status", { name: "Opening essay.docx" })).toBeTruthy();
    await vi.waitFor(() => expect(reader.load).toHaveBeenCalled());
    expect(reader.load).toHaveBeenCalledWith({ kind: "document", url: "https://files.example/essay", bytes: 2048 }, expect.any(AbortSignal));

    await act(async () => {
      load.resolve({
        kind: "document",
        media: [],
        ast: richContentFromProseMirror({
          type: "doc",
          content: [
            { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Lab report" }] },
            { type: "paragraph", content: [{ type: "text", text: "Enzymes ", marks: [{ type: "bold" }] }, { type: "text", text: "speed reactions." }] },
          ],
        }),
      });
    });
    expect(screen.queryByRole("status", { name: "Opening essay.docx" })).toBeNull();
    const view = document.querySelector("[data-file-view='document']")!;
    expect(view.querySelector(".spectra-prose h1")?.textContent).toBe("Lab report");
    expect(view.querySelector(".spectra-prose strong")?.textContent).toBe("Enzymes ");
  });

  it("shows a deck as thumbnails and the current slide, and moves with the arrow keys as a morph", async () => {
    reader.load.mockResolvedValue({ kind: "slides", deck: DECK, media: [] });
    render(<FileViewer file={{ key: "p1", filename: "biology.pptx", kind: "slides", url: "https://files.example/deck" }} onClose={() => {}} />);
    const slides = await screen.findByRole("group", { name: /Slides/ });
    const rail = within(slides).getByRole("list", { name: "All slides" });
    expect(within(rail).getAllByRole("button")).toHaveLength(3);
    expect(within(rail).getByRole("button", { name: "Slide 1: Photosynthesis" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("Slide 1 of 3")).toBeTruthy();
    expect(screen.getByText("Start with the leaf.")).toBeTruthy();
    expect(document.querySelector(".file-viewer-stage")?.getAttribute("data-slide-id")).toBe("s1");

    fireEvent.keyDown(slides, { key: "ArrowRight" });
    expect(screen.getByText("Slide 2 of 3")).toBeTruthy();
    expect(document.querySelector(".file-viewer-stage")?.getAttribute("data-slide-id")).toBe("s2");
    // The slide that was there is where the next one grows from.
    expect(life.launchFrom).toHaveBeenCalledWith(document.querySelector(".file-viewer-stage"));
    expect(life.useLifeLanding).toHaveBeenLastCalledWith(expect.anything(), "s2");

    fireEvent.keyDown(slides, { key: "End" });
    expect(screen.getByText("Slide 3 of 3")).toBeTruthy();
    fireEvent.keyDown(slides, { key: "ArrowRight" });
    expect(screen.getByText("Slide 3 of 3")).toBeTruthy();
    fireEvent.keyDown(slides, { key: "ArrowLeft" });
    expect(screen.getByText("Slide 2 of 3")).toBeTruthy();

    const thumb = within(rail).getByRole("button", { name: "Slide 1: Photosynthesis" });
    fireEvent.click(thumb);
    expect(life.launchFrom).toHaveBeenLastCalledWith(thumb);
    expect(screen.getByText("Slide 1 of 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous slide" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows a workbook as a read-only grid with its sheet tabs", async () => {
    reader.load.mockResolvedValue({
      kind: "sheet",
      activeSheetId: "a",
      sheets: [
        {
          id: "a", name: "Marks", rowCount: 24, columnCount: 8, frozenRows: 1, frozenColumns: 0, hiddenRows: [], hiddenColumns: [],
          columnWidths: {}, rowHeights: {}, merges: [{ row: 3, column: 0, rows: 1, columns: 2 }], showGridlines: true, clipped: false,
          cells: { A1: { text: "Student", format: { bold: true } }, B2: { text: "7", numeric: true }, A4: { text: "Merged note" }, B3: { text: "9", numeric: true } },
          conditional: { B2: { backgroundColor: "var(--danger)" }, B3: { bar: { color: "var(--accent)", ratio: 0.5 } } },
          notes: { C2: { author: "Ms Ade", text: "Check this mark" } },
          charts: [],
          pictures: [
            { id: "p1", label: "School crest", mediaId: "spectra-preview-media:0", position: { x: 0, y: 0, width: 10, height: 10 }, anchor: { from: { column: 1, row: 4, x: 4, y: 2 }, to: { column: 3, row: 8, x: 0, y: 0 } } },
            { id: "p2", label: "Old logo", position: { x: 0, y: 0, width: 10, height: 10 }, anchor: { from: { column: 4, row: 4, x: 0, y: 0 }, width: 80, height: 40 } },
          ],
        },
        {
          id: "b", name: "Summary", tabColor: "var(--accent-mint)", rowCount: 24, columnCount: 8, frozenRows: 0, frozenColumns: 0, hiddenRows: [], hiddenColumns: [],
          columnWidths: {}, rowHeights: {}, merges: [], showGridlines: false, clipped: true, cells: { C3: { text: "Mean" } },
          conditional: {}, notes: {}, charts: [], pictures: [],
        },
      ],
      media: [{ id: "spectra-preview-media:0", mediaType: "image/png", bytes: new Uint8Array([137, 80, 78, 71]).buffer }],
    } satisfies OfficePreview);
    // jsdom has no object URLs; the viewer only needs one per picture.
    URL.createObjectURL = vi.fn(() => "blob:crest");
    URL.revokeObjectURL = vi.fn();
    render(<FileViewer file={{ key: "x1", filename: "marks.xlsx", kind: "sheet", url: "https://files.example/marks" }} onClose={() => {}} />);
    const grid = await screen.findByRole("region", { name: "Marks, read-only" });
    const cell = (address: string) => grid.querySelector<HTMLElement>(`[data-address='${address}']`)!;
    expect(cell("A1").textContent).toBe("Student");
    expect(cell("A1").style.fontWeight).toBe("700");
    // Numbers sit to the right, as in Excel.
    expect(cell("B2").textContent).toBe("7");
    expect(cell("B2").style.textAlign).toBe("right");
    // A merge spans the columns it covers (Excel's 64px default), and the cell under it is not drawn.
    expect(cell("A4").style.width).toBe("128px");
    expect(cell("B4")).toBeNull();
    // The frozen row is drawn in its own pane, which stays put while the body scrolls.
    expect(grid.querySelector(".is-frozen-rows [data-address='A1']")).toBeTruthy();
    expect(grid.querySelector(".is-body [data-address='B2']")).toBeTruthy();
    // Conditional formats arrive evaluated: a fill, and a data bar as long as its value.
    expect(cell("B2").style.backgroundColor).toBe("var(--danger)");
    expect(cell("B3").style.backgroundSize).toBe("50% 72%");
    // Excel's notes mark their cell and read on hover.
    expect(cell("C2").getAttribute("title")).toBe("Ms Ade: Check this mark");
    expect(cell("C2").querySelector(".file-viewer-note-mark")).toBeTruthy();
    // Pictures sit on their cells; one the browser can't draw says so.
    const crest = within(grid).getByRole("img", { name: "School crest" });
    expect(crest.style.left).toBe("68px");
    expect(crest.style.width).toBe("124px");
    expect(within(grid).getByRole("img", { name: "Old logo" }).textContent).toContain("doesn't show here");

    const tabs = screen.getByRole("tablist", { name: "Sheets" });
    expect(within(tabs).getByRole("tab", { name: "Marks" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(tabs).getByRole("tab", { name: "Summary" }));
    expect(screen.getByRole("region", { name: "Summary, read-only" })).toBeTruthy();
    expect(screen.getByText("Mean")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toContain("Showing the first 10,000 rows");
    fireEvent.keyDown(tabs, { key: "ArrowLeft" });
    expect(screen.getByRole("region", { name: "Marks, read-only" })).toBeTruthy();
  });

  it("says why a file can't show and keeps the ways out", async () => {
    const { OfficePreviewRefusal } = await import("../office-preview-client");
    reader.load.mockRejectedValue(new OfficePreviewRefusal("This PowerPoint deck is 92 MB. Spectra shows PowerPoint decks up to 80 MB here.", "too-large"));
    render(
      <FileViewer
        file={{ key: "p2", filename: "huge.pptx", kind: "slides", url: "https://files.example/huge" }}
        onClose={() => {}}
        actions={<Button>Copy into Library</Button>}
      />,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("huge.pptx didn't show here.");
    expect(alert.textContent).toContain("This PowerPoint deck is 92 MB.");
    expect(alert.textContent).toContain("Open it in a new tab instead.");
    expect(screen.getByRole("link", { name: "Open in a new tab" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy into Library" })).toBeTruthy();
  });
});
