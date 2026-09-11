export type AttachmentInput = {
  id?: string;
  assetId?: string;
  importId?: string;
  sourceRef?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  handling?: "pdf" | "text" | "docx" | "xlsx" | "pptx" | "image";
  data?: string;
};

import {
  bytesToArrayBuffer,
  decodeBase64DataUrl,
  OFFICE_ARCHIVE_LIMITS,
  readBoundedArchive,
  enforcePdfInput,
} from "../../../../../shared/parser-limits";

export type PreparedAttachment = {
  id?: string;
  name: string;
  mimeType: string;
  size: number;
  handling: "pdf" | "text" | "docx" | "xlsx" | "pptx" | "image";
  data?: string;
  extractedText?: string;
  pageCount?: number;
  visualPdfData?: string;
  structuredRepresentation?: { kind: string; value: unknown };
  sourceMap?: Array<{
    kind: "page" | "slide" | "sheet" | "range" | "section";
    label: string;
    startOffset?: number;
    endOffset?: number;
  }>;
  warnings?: Array<{ code: string; message: string }>;
  provenance?: {
    source: "user_upload" | "integration" | "linked_work" | "research";
    originalFileId: string;
    originalName: string;
    originalMimeType: string;
    originalBytes: number;
    preparedAt: string;
    extractor: string;
  };
};

async function officeTextPdf(name: string, text: string) {
  const { jsPDF } = await import("jspdf");
  const document = new jsPDF({ unit: "pt", format: "a4" });
  document.setFont("helvetica", "normal");
  document.setFontSize(10);
  const margin = 46;
  const width = document.internal.pageSize.getWidth() - margin * 2;
  const height = document.internal.pageSize.getHeight() - margin;
  let y = margin;
  document.setFontSize(13);
  document.text(name.slice(0, 120), margin, y);
  y += 24;
  document.setFontSize(10);
  for (const line of document.splitTextToSize(text.slice(0, 80_000), width) as string[]) {
    if (y > height) {
      document.addPage();
      y = margin;
    }
    document.text(line, margin, y);
    y += 13;
  }
  const bytes = Buffer.from(document.output("arraybuffer"));
  return `data:application/pdf;base64,${bytes.toString("base64")}`;
}

export function attachmentBuffer(data: string, name: string, maxBytes = 25_000_000) {
  return decodeBase64DataUrl(data, name, maxBytes);
}

function decodePackageXmlText(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    );
}

async function extractPdfText(buffer: Uint8Array, characterLimit: number) {
  enforcePdfInput(buffer);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfOptions = { data: buffer, enableScripting: false };
  const document = await pdfjs.getDocument(pdfOptions).promise;
  const pages: string[] = [];
  let characters = 0;
  for (
    let pageNumber = 1;
    pageNumber <= document.numPages && characters < characterLimit;
    pageNumber += 1
  ) {
    const page = await document.getPage(pageNumber);
    const text = await page.getTextContent();
    const pageText = text.items
      .flatMap((item) =>
        "str" in item && typeof item.str === "string" ? [item.str] : [],
      )
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!pageText) continue;
    const labelled = `Page ${pageNumber}\n${pageText}`;
    const remaining = Math.max(0, characterLimit - characters);
    pages.push(labelled.slice(0, remaining));
    characters += Math.min(labelled.length, remaining);
  }
  const pageCount = document.numPages;
  await document.cleanup();
  return { text: pages.join("\n\n"), pageCount };
}

async function extractXlsxText(buffer: Uint8Array, characterLimit: number) {
  const checked = await readBoundedArchive(buffer, OFFICE_ARCHIVE_LIMITS);
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    checked.bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const sections: string[] = [];
  let characters = 0;
  workbook.eachSheet((sheet) => {
    if (characters >= characterLimit) return;
    const rows: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (characters >= characterLimit) return;
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) =>
        values.push(cell.text.replace(/\u0000/g, "").trim()),
      );
      const line = values.join("\t").replace(/\t+$/g, "");
      if (line.trim()) {
        rows.push(line);
        characters += line.length + 1;
      }
    });
    sections.push(
      `Worksheet: ${sheet.name}\n${rows.join("\n")}`.slice(
        0,
        Math.max(0, characterLimit),
      ),
    );
  });
  return sections.join("\n\n").slice(0, characterLimit);
}

async function extractPptxText(buffer: Uint8Array, characterLimit: number) {
  const archive = (await readBoundedArchive(buffer, OFFICE_ARCHIVE_LIMITS)).entries;
  const decoder = new TextDecoder();
  const names = Object.keys(archive)
    .filter((name) => /^ppt\/(?:slides|notesSlides)\/[^/]+\.xml$/i.test(name))
    .sort((left, right) => {
      const leftNumber = Number(left.match(/(\d+)\.xml$/)?.[1] ?? 0);
      const rightNumber = Number(right.match(/(\d+)\.xml$/)?.[1] ?? 0);
      const leftNotes = left.includes("notesSlides") ? 1 : 0;
      const rightNotes = right.includes("notesSlides") ? 1 : 0;
      return leftNotes - rightNotes || leftNumber - rightNumber;
    });
  const sections: string[] = [];
  let characters = 0;
  for (const name of names) {
    if (characters >= characterLimit) break;
    const text = [...decoder.decode(archive[name]).matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi)]
      .map((match) => decodePackageXmlText(match[1] ?? ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const number = Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);
    const section = `${name.includes("notesSlides") ? "Speaker notes" : "Slide"} ${number}\n${text}`;
    sections.push(section);
    characters += section.length;
  }
  return sections.join("\n\n").slice(0, characterLimit);
}

export async function prepareAttachments(
  input: AttachmentInput[] | undefined,
): Promise<PreparedAttachment[]> {
  const rows = Array.isArray(input) ? input.slice(0, 4) : [];
  let extractedCharacters = 0;
  const prepared: PreparedAttachment[] = [];
  for (const row of rows) {
    const name =
      typeof row.name === "string"
        ? row.name.replace(/[\u0000-\u001f]/g, "").slice(0, 180)
        : "attachment";
    const mimeType =
      typeof row.mimeType === "string"
        ? row.mimeType.slice(0, 120)
        : "application/octet-stream";
    const size = Number.isFinite(row.size) ? (row.size as number) : 0;
    const remaining = Math.max(0, 80_000 - extractedCharacters);
    if (row.handling === "image") {
      if (
        !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mimeType) ||
        size > 8 * 1024 * 1024 ||
        typeof row.data !== "string" ||
        !row.data.startsWith(`data:${mimeType};base64,`)
      )
        throw new Error(`Invalid image attachment: ${name}`);
      prepared.push({ name, mimeType, size, handling: "image", data: row.data });
      continue;
    }
    if (row.handling === "pdf") {
      if (size > 10 * 1024 * 1024 || typeof row.data !== "string" || !row.data.startsWith("data:application/pdf;base64,"))
        throw new Error(`Invalid PDF attachment: ${name}`);
      const local = await extractPdfText(attachmentBuffer(row.data, name, 10 * 1024 * 1024), Math.min(60_000, remaining));
      extractedCharacters += local.text.length;
      prepared.push({ name, mimeType: "application/pdf", size, handling: "pdf", data: row.data, extractedText: local.text, pageCount: local.pageCount });
      continue;
    }
    if (row.handling === "text") {
      if (size > 2 * 1024 * 1024 || typeof row.data !== "string") throw new Error(`Invalid text attachment: ${name}`);
      const extractedText = row.data.replace(/\u0000/g, "").slice(0, Math.min(40_000, remaining));
      extractedCharacters += extractedText.length;
      prepared.push({ name, mimeType, size, handling: "text", extractedText });
      continue;
    }
    if (row.handling === "docx") {
      if (size > 8 * 1024 * 1024 || typeof row.data !== "string") throw new Error(`Invalid DOCX attachment: ${name}`);
      const buffer = attachmentBuffer(row.data, name, 8 * 1024 * 1024);
      const checked = await readBoundedArchive(buffer, OFFICE_ARCHIVE_LIMITS);
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ arrayBuffer: bytesToArrayBuffer(checked.bytes) });
      const html = await mammoth.convertToHtml({ arrayBuffer: bytesToArrayBuffer(checked.bytes) });
      const extractedText = result.value.replace(/\u0000/g, "").slice(0, Math.min(40_000, remaining));
      extractedCharacters += extractedText.length;
      prepared.push({ name, mimeType, size, handling: "docx", data: row.data, extractedText, visualPdfData: await officeTextPdf(name, extractedText), structuredRepresentation: { kind: "docx", value: { html: html.value, messages: [...result.messages, ...html.messages].map((message) => message.message) } } });
      continue;
    }
    if (row.handling === "xlsx" || row.handling === "pptx") {
      const maximum = row.handling === "xlsx" ? 12 : 20;
      if (size > maximum * 1024 * 1024 || typeof row.data !== "string") throw new Error(`Invalid ${row.handling.toUpperCase()} attachment: ${name}`);
      const buffer = attachmentBuffer(row.data, name, row.handling === "xlsx" ? 12 * 1024 * 1024 : 20 * 1024 * 1024);
      const extractedText = await (row.handling === "xlsx" ? extractXlsxText(buffer, Math.min(60_000, remaining)) : extractPptxText(buffer, Math.min(60_000, remaining)));
      extractedCharacters += extractedText.length;
      prepared.push({ name, mimeType, size, handling: row.handling, data: row.data, extractedText, visualPdfData: await officeTextPdf(name, extractedText) });
      continue;
    }
    throw new Error(`Unsupported attachment type: ${name}`);
  }
  const preparedAt = new Date().toISOString();
  return prepared.map((attachment, index) => {
    const sourceMap = attachment.sourceMap ?? (() => {
      if (attachment.pageCount) return Array.from({ length: attachment.pageCount }, (_, pageIndex) => ({ kind: "page" as const, label: `Page ${pageIndex + 1}` }));
      if (attachment.handling === "pptx") return attachment.extractedText?.split(/\n\n(?=(?:Slide|Speaker notes) \d+)/).map((section) => ({ kind: "slide" as const, label: section.split("\n", 1)[0] || "Slide" })) ?? [];
      if (attachment.handling === "xlsx") return attachment.extractedText?.split(/\n\n(?=Worksheet: )/).map((section) => ({ kind: "sheet" as const, label: section.split("\n", 1)[0]?.replace(/^Worksheet:\s*/, "") || "Worksheet" })) ?? [];
      if (attachment.handling === "docx") return [{ kind: "section" as const, label: "Document body" }];
      return [];
    })();
    const originalFileId =
      rows[index]?.assetId ??
      rows[index]?.importId ??
      rows[index]?.id ??
      `file:${attachment.name}:${attachment.size}`;
    return {
      ...attachment,
      id: originalFileId,
      structuredRepresentation:
        attachment.structuredRepresentation ??
        (attachment.extractedText
          ? { kind: attachment.handling, value: { text: attachment.extractedText } }
          : undefined),
      sourceMap,
      warnings:
        attachment.handling === "pdf" && !attachment.extractedText
          ? [{ code: "ocr_not_performed", message: "No extractable PDF text was found. Spectra retains the original for native visual understanding and does not claim OCR." }]
          : [],
      provenance: {
        source: "user_upload" as const,
        originalFileId,
        originalName: attachment.name,
        originalMimeType: attachment.mimeType,
        originalBytes: attachment.size,
        preparedAt,
        extractor: `spectra/${attachment.handling}`,
      },
    };
  });
}
