import type { ImportedDocument } from "@/lib/editor/tiptap-import";
import { plainTextToTiptapJson, textFromTiptapJson, titleFromFilename } from "@/lib/editor/tiptap-import";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsModulePromise: Promise<PdfJsModule> | null = null;

async function getPdfjsModule() {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsModulePromise;
}

export async function importPdfFile(file: File): Promise<ImportedDocument> {
  const pdfjs = await getPdfjsModule();
  const bytes = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;
  const pageTexts: string[] = [];

  try {
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) pageTexts.push(text);
    }
  } finally {
    await pdf.destroy();
  }

  const content = plainTextToTiptapJson(pageTexts.join("\n\n"));
  return {
    title: titleFromFilename(file.name),
    content,
    contentPlaintext: textFromTiptapJson(content),
    source: "pdf",
  };
}
