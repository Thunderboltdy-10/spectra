// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../office-preview-client", async (original) => ({
  ...(await original<typeof import("../office-preview-client")>()),
  loadOfficePreview: mocks.load,
}));

import { FileViewer, type ViewedFile } from "../file-viewer";
import { ImportOriginal, type ImportedOriginal } from "../import-original";

function History({ entry }: { entry: ImportedOriginal }) {
  const [viewing, setViewing] = useState<ViewedFile | null>(null);
  return (
    <>
      <ImportOriginal entry={entry} downloadUrl="https://files.example/original" onView={setViewing} />
      <FileViewer file={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

beforeAll(async () => {
  await import("../office-view");
}, 30_000);
afterEach(() => {
  cleanup();
  mocks.load.mockReset();
});

describe("An imported artifact's original", () => {
  it("opens read-only in the shared viewer, next to the download", async () => {
    mocks.load.mockResolvedValue({
      kind: "slides",
      media: [],
      deck: { theme: { id: "native-pptx", name: "PowerPoint theme" }, settings: { aspectRatio: "16:9" }, slides: [{ id: "s1", title: "Cells", objects: [] }] },
    });
    render(<History entry={{ jobId: "job-1", format: "pptx", name: "Cells.pptx", bytes: 2048 }} />);
    expect(screen.getByRole("link", { name: "Original" }).getAttribute("href")).toBe("https://files.example/original");
    fireEvent.click(screen.getByRole("button", { name: "View the original Cells.pptx" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("button", { name: "Slide 1: Cells" })).toBeTruthy();
    expect(mocks.load).toHaveBeenCalledWith({ kind: "slides", url: "https://files.example/original", bytes: 2048 }, expect.any(AbortSignal));
  });

  it("offers only the download for a format Spectra has no reader for", () => {
    render(<History entry={{ jobId: "job-2", format: "odp" }} />);
    expect(screen.queryByRole("button", { name: /View the original/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Original" })).toBeTruthy();
  });

  it("offers only the download for an older PowerPoint file", () => {
    render(<History entry={{ jobId: "job-3", format: "ppt", name: "Old.ppt" }} />);
    expect(screen.queryByRole("button", { name: "View the original Old.ppt" })).toBeNull();
  });
});
