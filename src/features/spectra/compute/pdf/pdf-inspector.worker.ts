/// <reference lib="webworker" />

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { summarizePdfPages } from "./pdf-inspector";
import type {
  PdfInspection,
  PdfInspectionPage,
  PositionedPdfText,
} from "./pdf-inspector";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (event: MessageEvent<{ data: ArrayBuffer }>) => {
  try {
    const document = await getDocument({ data: new Uint8Array(event.data.data) }).promise;
    const pages: PdfInspectionPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const positionedText: PositionedPdfText[] = content.items.flatMap((item) => {
        if (!("str" in item) || typeof item.str !== "string" || !item.str.trim()) return [];
        const transform = item.transform;
        return [{
          text: item.str,
          x: Number(transform[4] ?? 0),
          y: Number(transform[5] ?? 0),
          width: Number(item.width ?? 0),
          height: Number(item.height ?? 0),
        }];
      });
      const text = positionedText.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
      const operatorList = await page.getOperatorList();
      const imageLikeOperations = operatorList.fnArray.filter((operation) => [82, 83, 84, 85, 86, 87].includes(operation)).length;
      const classification = text.length < 8
        ? "image_or_scanned"
        : imageLikeOperations > 0
          ? "mixed"
          : "text";
      pages.push({
        page: pageNumber,
        width: viewport.width,
        height: viewport.height,
        classification,
        text,
        markdown: `## Page ${pageNumber}\n\n${text}`,
        positionedText,
      });
    }
    const summary = summarizePdfPages(pages);
    const inspection: PdfInspection = {
      engine: "spectra-pdf-inspector/pdfjs",
      pageCount: document.numPages,
      classification: summary.classification,
      pages,
      searchableText: summary.searchableText,
      warnings: summary.warnings,
    };
    await document.destroy();
    self.postMessage({ ok: true, inspection });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : "PDF inspection failed." });
  }
};

export {};
