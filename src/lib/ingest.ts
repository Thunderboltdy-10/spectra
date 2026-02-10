import mammoth from "mammoth";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { MODEL_CONFIG } from "@/lib/model-config";
import { openRouterEmbedding } from "@/lib/openrouter";

pdfjs.GlobalWorkerOptions.workerSrc = "pdfjs-dist/legacy/build/pdf.worker.mjs";

export type ParsedFile = {
  text: string;
  pages: Array<{ page?: number; text: string }>;
};

const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 160;

export async function parseUploadedFile(file: File): Promise<ParsedFile> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const bytes = await file.arrayBuffer();

  if (ext === "txt" || ext === "md") {
    const text = new TextDecoder().decode(bytes);
    return { text, pages: [{ text }] };
  }

  if (ext === "docx") {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return { text: result.value, pages: [{ text: result.value }] };
  }

  if (ext === "pdf") {
    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    const pages: Array<{ page?: number; text: string }> = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .trim();
      pages.push({ page: i, text });
    }
    return {
      text: pages.map((page) => page.text).join("\n"),
      pages,
    };
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

export function chunkTextWithPages(pages: Array<{ page?: number; text: string }>) {
  const chunks: Array<{ text: string; page?: number }> = [];

  for (const page of pages) {
    const text = page.text.replace(/\s+/g, " ").trim();
    if (!text) continue;

    let cursor = 0;
    while (cursor < text.length) {
      const end = Math.min(cursor + CHUNK_SIZE, text.length);
      const chunk = text.slice(cursor, end).trim();
      if (chunk) {
        chunks.push({ text: chunk, page: page.page });
      }
      if (end === text.length) break;
      cursor = Math.max(0, end - CHUNK_OVERLAP);
    }
  }

  return chunks;
}

export async function embedChunks(chunks: Array<{ text: string; page?: number }>) {
  const embedded: Array<{ text: string; page?: number; embedding: number[] }> = [];
  for (const chunk of chunks) {
    const embedding = await openRouterEmbedding(chunk.text, MODEL_CONFIG.embedding);
    embedded.push({ ...chunk, embedding });
  }
  return embedded;
}
