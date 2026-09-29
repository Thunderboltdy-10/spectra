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
  const sourceMap: NonNullable<PreparedAttachment["sourceMap"]> = [];
  let characters = 0;
  let processedPages = 0;
  let truncated = false;
  for (
    let pageNumber = 1;
    pageNumber <= document.numPages && characters < characterLimit;
    pageNumber += 1
  ) {
    const page = await document.getPage(pageNumber);
    processedPages = pageNumber;
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
    const separatorLength = pages.length ? 2 : 0;
    const remaining = Math.max(0, characterLimit - characters - separatorLength);
    const retained = labelled.slice(0, remaining);
    truncated ||= retained.length < labelled.length;
    if (!retained) break;
    const startOffset = characters + separatorLength;
    pages.push(retained);
    characters = startOffset + retained.length;
    sourceMap.push({ kind: "page", label: `Page ${pageNumber}`, startOffset, endOffset: characters });
  }
  const pageCount = document.numPages;
  await document.cleanup();
  return { text: pages.join("\n\n"), pageCount, sourceMap, truncated: truncated || processedPages < pageCount };
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

/** All attachments of one request share this much extracted text. */
const EXTRACTED_TEXT_BUDGET = 80_000;
const count = (value: number) => value.toLocaleString("en-US");

type Extraction = {
  attachment: PreparedAttachment;
  /** Full extracted length, or undefined when the extractor stopped early. */
  totalCharacters?: number;
  stoppedEarly: boolean;
};

/**
 * Share the budget so every file is read: files shorter than an equal share
 * keep all their text and the rest is split among the longer ones. A long
 * first file can no longer leave a later file with nothing.
 */
function allocateExtractedText(extractions: Extraction[]) {
  const texts = extractions.filter((entry) => entry.attachment.extractedText);
  const allowance = new Map<Extraction, number>();
  let remaining = EXTRACTED_TEXT_BUDGET;
  const bySize = [...texts].sort(
    (left, right) =>
      left.attachment.extractedText!.length - right.attachment.extractedText!.length,
  );
  bySize.forEach((entry, index) => {
    const share = Math.floor(remaining / (bySize.length - index));
    const granted = Math.min(entry.attachment.extractedText!.length, share);
    allowance.set(entry, granted);
    remaining -= granted;
  });
  return allowance;
}

function truncationWarning(entry: Extraction, retained: number) {
  const { attachment, totalCharacters, stoppedEarly } = entry;
  if (attachment.handling === "pdf")
    return `Text was read from ${attachment.sourceMap?.length ?? 0} of ${attachment.pageCount ?? "?"} pages (${count(retained)} characters). The whole original PDF is still attached; extracted citations cover only the pages read.`;
  return stoppedEarly || totalCharacters === undefined
    ? `Only the first ${count(retained)} characters were read; the rest of the file was not.`
    : `Only the first ${count(retained)} of ${count(totalCharacters)} characters were read; the rest of the file was not.`;
}

export async function prepareAttachments(
  input: AttachmentInput[] | undefined,
): Promise<PreparedAttachment[]> {
  const rows = Array.isArray(input) ? input.slice(0, 4) : [];
  const extractions: Extraction[] = [];
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
    if (row.handling === "image") {
      if (
        !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mimeType) ||
        size > 8 * 1024 * 1024 ||
        typeof row.data !== "string" ||
        !row.data.startsWith(`data:${mimeType};base64,`)
      )
        throw new Error(`Invalid image attachment: ${name}`);
      extractions.push({
        attachment: { name, mimeType, size, handling: "image", data: row.data },
        stoppedEarly: false,
      });
      continue;
    }
    if (row.handling === "pdf") {
      if (size > 10 * 1024 * 1024 || typeof row.data !== "string" || !row.data.startsWith("data:application/pdf;base64,"))
        throw new Error(`Invalid PDF attachment: ${name}`);
      const local = await extractPdfText(attachmentBuffer(row.data, name, 10 * 1024 * 1024), 60_000);
      extractions.push({
        attachment: { name, mimeType: "application/pdf", size, handling: "pdf", data: row.data, extractedText: local.text, pageCount: local.pageCount, sourceMap: local.sourceMap },
        totalCharacters: local.truncated ? undefined : local.text.length,
        stoppedEarly: local.truncated,
      });
      continue;
    }
    if (row.handling === "text") {
      if (size > 2 * 1024 * 1024 || typeof row.data !== "string") throw new Error(`Invalid text attachment: ${name}`);
      const full = row.data.replace(/\u0000/g, "");
      extractions.push({
        attachment: { name, mimeType, size, handling: "text", extractedText: full.slice(0, 40_000) },
        totalCharacters: full.length,
        stoppedEarly: false,
      });
      continue;
    }
    if (row.handling === "docx") {
      if (size > 8 * 1024 * 1024 || typeof row.data !== "string") throw new Error(`Invalid DOCX attachment: ${name}`);
      const buffer = attachmentBuffer(row.data, name, 8 * 1024 * 1024);
      const checked = await readBoundedArchive(buffer, OFFICE_ARCHIVE_LIMITS);
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ arrayBuffer: bytesToArrayBuffer(checked.bytes) });
      const html = await mammoth.convertToHtml({ arrayBuffer: bytesToArrayBuffer(checked.bytes) });
      const full = result.value.replace(/\u0000/g, "");
      extractions.push({
        attachment: { name, mimeType, size, handling: "docx", data: row.data, extractedText: full.slice(0, 40_000), structuredRepresentation: { kind: "docx", value: { html: html.value, messages: [...result.messages, ...html.messages].map((message) => message.message) } } },
        totalCharacters: full.length,
        stoppedEarly: false,
      });
      continue;
    }
    if (row.handling === "xlsx" || row.handling === "pptx") {
      const maximum = row.handling === "xlsx" ? 12 : 20;
      if (size > maximum * 1024 * 1024 || typeof row.data !== "string") throw new Error(`Invalid ${row.handling.toUpperCase()} attachment: ${name}`);
      const buffer = attachmentBuffer(row.data, name, maximum * 1024 * 1024);
      // One character past the cap tells a complete file from a cut one.
      const probe = await (row.handling === "xlsx" ? extractXlsxText(buffer, 60_001) : extractPptxText(buffer, 60_001));
      extractions.push({
        attachment: { name, mimeType, size, handling: row.handling, data: row.data, extractedText: probe.slice(0, 60_000) },
        totalCharacters: probe.length > 60_000 ? undefined : probe.length,
        stoppedEarly: probe.length > 60_000,
      });
      continue;
    }
    throw new Error(`Unsupported attachment type: ${name}`);
  }
  const allowance = allocateExtractedText(extractions);
  const prepared = extractions.map((entry): PreparedAttachment => {
    const { attachment } = entry;
    if (!attachment.extractedText) return attachment;
    const extractedText = attachment.extractedText.slice(0, allowance.get(entry) ?? 0);
    const sourceMap = attachment.sourceMap
      ?.filter((location) => (location.startOffset ?? 0) < extractedText.length)
      .map((location) =>
        location.endOffset !== undefined && location.endOffset > extractedText.length
          ? { ...location, endOffset: extractedText.length }
          : location,
      );
    const next = { ...attachment, extractedText, ...(sourceMap ? { sourceMap } : {}) };
    const cut =
      entry.stoppedEarly ||
      (entry.totalCharacters !== undefined && extractedText.length < entry.totalCharacters);
    return cut
      ? {
          ...next,
          warnings: [{
            code: "extraction_truncated",
            message: truncationWarning({ ...entry, attachment: next }, extractedText.length),
          }],
        }
      : next;
  });
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
      warnings: attachment.warnings ?? (
        attachment.handling === "pdf" && !attachment.extractedText
          ? [{ code: "ocr_not_performed", message: "No extractable PDF text was found. Spectra retains the original for native visual understanding and does not claim OCR." }]
          : []),
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
