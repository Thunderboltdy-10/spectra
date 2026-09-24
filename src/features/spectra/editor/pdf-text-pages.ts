type TextPage = {
  getTextContent(): Promise<{ items: readonly unknown[] }>;
  cleanup(): unknown;
};
type TextLoadingTask = {
  promise: Promise<{ numPages: number; getPage(pageNumber: number): Promise<TextPage> }>;
  destroy(): Promise<void>;
};

/** Preserve empty pages and release pdf.js resources even when a page fails. */
export async function readPdfTextPages(loadingTask: TextLoadingTask) {
  const pages: string[] = [];
  try {
    const document = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const textContent = await page.getTextContent();
        pages.push(textContent.items.flatMap((item) =>
          item && typeof item === "object" && "str" in item ? [String(item.str)] : [],
        ).join(" "));
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } finally {
    // cleanup() alone keeps the worker and document alive across imports.
    await loadingTask.destroy();
  }
}
