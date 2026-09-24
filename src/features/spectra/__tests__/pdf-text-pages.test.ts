import { describe, expect, it, vi } from "vitest";
import { readPdfTextPages } from "../editor/pdf-text-pages";

describe("PDF text import lifetime", () => {
  it("keeps blank-page positions and destroys the task after cleaning every page", async () => {
    const first = { getTextContent: vi.fn().mockResolvedValue({ items: [{ str: "First" }, { type: "marker" }] }), cleanup: vi.fn() };
    const blank = { getTextContent: vi.fn().mockResolvedValue({ items: [] }), cleanup: vi.fn() };
    const getPage = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(blank);
    const task = { promise: Promise.resolve({ numPages: 2, getPage }), destroy: vi.fn().mockResolvedValue(undefined) };
    await expect(readPdfTextPages(task)).resolves.toEqual(["First", ""]);
    expect(getPage.mock.calls).toEqual([[1], [2]]);
    expect(first.cleanup).toHaveBeenCalledOnce();
    expect(blank.cleanup).toHaveBeenCalledOnce();
    expect(task.destroy).toHaveBeenCalledOnce();
  });

  it("cleans a failed page and destroys both failed parses and failed page reads", async () => {
    const page = { getTextContent: vi.fn().mockRejectedValue(new Error("bad page")), cleanup: vi.fn() };
    const task = { promise: Promise.resolve({ numPages: 1, getPage: vi.fn().mockResolvedValue(page) }), destroy: vi.fn().mockResolvedValue(undefined) };
    await expect(readPdfTextPages(task)).rejects.toThrow("bad page");
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(task.destroy).toHaveBeenCalledOnce();
    const failed = { promise: Promise.reject(new Error("bad PDF")), destroy: vi.fn().mockResolvedValue(undefined) };
    await expect(readPdfTextPages(failed)).rejects.toThrow("bad PDF");
    expect(failed.destroy).toHaveBeenCalledOnce();
  });
});
