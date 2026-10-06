// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { SchoolFileViewer, schoolFileKind } from "../school-file-viewer";

afterEach(cleanup);

describe("schoolFileKind", () => {
  it.each([
    ["application/pdf", "essay.pdf", "pdf"],
    ["", "essay.PDF", "pdf"],
    ["image/jpeg", "garden.jpg", "image"],
    ["application/octet-stream", "garden.webp", "image"],
    ["image/svg+xml", "diagram.svg", null],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "essay.docx", null],
    [undefined, "notes", null],
  ] as const)("%s %s → %s", (mimeType, filename, kind) => {
    expect(schoolFileKind(mimeType, filename)).toBe(kind);
  });
});

describe("SchoolFileViewer", () => {
  it("holds a ghost until the kept copy is ready, then shows the PDF in Spectra", () => {
    const { rerender } = render(<SchoolFileViewer file={{ key: "f1", filename: "essay.pdf", kind: "pdf" }} onClose={() => {}} />);
    expect(screen.getByRole("status", { name: "Opening essay.pdf" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open in a new tab" })).toBeNull();

    rerender(<SchoolFileViewer file={{ key: "f1", filename: "essay.pdf", kind: "pdf", url: "https://files.example/essay" }} onClose={() => {}} />);
    expect(screen.getByTitle("essay.pdf").getAttribute("src")).toBe("https://files.example/essay");
    const link = screen.getByRole("link", { name: "Open in a new tab" });
    expect(link.getAttribute("href")).toBe("https://files.example/essay");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows a photo, and says so in one line when it can't", () => {
    render(<SchoolFileViewer file={{ key: "f2", filename: "garden.jpg", kind: "image", url: "https://files.example/garden" }} onClose={() => {}} />);
    const photo = screen.getByRole("img", { name: "garden.jpg" });
    fireEvent.error(photo);
    expect(screen.getByRole("alert").textContent).toContain("garden.jpg didn't show here.");
  });

  it("closes from its close control and carries the caller's actions", () => {
    const onClose = vi.fn();
    render(
      <SchoolFileViewer
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
    render(<SchoolFileViewer file={null} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
