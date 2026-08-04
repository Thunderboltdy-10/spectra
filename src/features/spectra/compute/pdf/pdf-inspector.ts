import type { ComputeDecision } from "../broker";

export type PdfPageClassification = "text" | "mixed" | "image_or_scanned";
export type PositionedPdfText = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type PdfInspectionPage = {
  page: number;
  width: number;
  height: number;
  classification: PdfPageClassification;
  text: string;
  markdown: string;
  positionedText: PositionedPdfText[];
};
export type PdfInspection = {
  engine: "spectra-pdf-inspector/pdfjs";
  pageCount: number;
  classification: PdfPageClassification;
  pages: PdfInspectionPage[];
  searchableText: string;
  warnings: Array<{ code: "ocr_not_performed" | "partial_text"; message: string }>;
};

export type PdfInspectorScore = {
  candidate: "Firecrawl PDF Inspector";
  adopted: false;
  score: number;
  reason: string;
};

export const FIRECRAWL_PDF_INSPECTOR_SCORE: PdfInspectorScore = {
  candidate: "Firecrawl PDF Inspector",
  adopted: false,
  score: 52,
  reason:
    "No stable, separately versioned browser/WASM package is present in this repository. Spectra keeps a replaceable inspector contract and uses the already-audited PDF.js worker until the candidate clears bundle, mobile, maintenance and code-only fixture gates.",
};

export function summarizePdfPages(pages: readonly PdfInspectionPage[]) {
  const classification: PdfPageClassification = pages.every(
    (page) => page.classification === "text",
  )
    ? "text"
    : pages.every((page) => page.classification === "image_or_scanned")
      ? "image_or_scanned"
      : "mixed";
  const warnings: PdfInspection["warnings"] = pages.some(
    (page) => page.classification === "image_or_scanned",
  )
    ? [
        {
          code: "ocr_not_performed",
          message:
            "One or more pages contain no extractable text. Spectra PDF Inspector does not perform OCR; the original PDF remains available for native visual understanding.",
        },
      ]
    : [];
  return {
    classification,
    warnings,
    searchableText: pages
      .map((page) => `Page ${page.page}\n${page.text}`)
      .join("\n\n"),
  };
}

export type PdfInspectionHandle = {
  result: Promise<PdfInspection>;
  cancel: () => void;
};

export function inspectPdfInWorker(
  data: ArrayBuffer,
  decision: ComputeDecision,
  timeoutMs = 18_000,
): PdfInspectionHandle {
  if (decision.path !== "local_worker") {
    return {
      result: Promise.reject(
        new Error(`PDF_INSPECTION_${decision.path.toUpperCase()}: ${decision.disclosure}`),
      ),
      cancel: () => {},
    };
  }
  const worker = new Worker(new URL("./pdf-inspector.worker.ts", import.meta.url), {
    type: "module",
    name: "spectra-pdf-inspector",
  });
  let settled = false;
  let rejectTask: (reason?: unknown) => void = () => {};
  const cleanup = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    worker.terminate();
  };
  const result = new Promise<PdfInspection>((resolve, reject) => {
    rejectTask = reject;
    worker.onmessage = (event: MessageEvent<{ ok: boolean; inspection?: PdfInspection; error?: string }>) => {
      if (event.data?.ok && event.data.inspection) resolve(event.data.inspection);
      else reject(new Error(event.data?.error || "PDF inspection failed."));
      cleanup();
    };
    worker.onerror = (event) => {
      reject(new Error(event.message || "The PDF inspector worker stopped."));
      cleanup();
    };
    worker.postMessage({ data }, [data]);
  });
  const timer = window.setTimeout(() => {
    rejectTask(new Error("PDF inspection exceeded its worker safety limit."));
    cleanup();
  }, timeoutMs);
  return {
    result,
    cancel: () => {
      rejectTask(new DOMException("PDF inspection was cancelled.", "AbortError"));
      cleanup();
    },
  };
}

export function fallbackForPdfInspection(decision: ComputeDecision) {
  if (decision.path === "local_worker") return "pdfjs_worker" as const;
  if (decision.path === "server") return "pdfjs_server" as const;
  if (decision.path === "provider") return "native_pdf" as const;
  return "native_pdf_with_no_local_text" as const;
}
