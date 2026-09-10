import type { ArtifactTypeKey } from "../artifacts/types";
import { bytesToArrayBuffer, enforcePdfInput, OFFICE_ARCHIVE_LIMITS, readBoundedArchive } from "../../../../shared/parser-limits";

export const LIBRARY_IMPORT_ACCEPT = [
  ".spectra-pkg",
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".csv",
  ".tsv",
  ".txt",
  ".md",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".html",
  ".css",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".zip",
  ".bin",
].join(",");

/** Native Spectra work types that Import projects into editable studios. */
const WORK_EXTENSIONS: Record<string, ArtifactTypeKey> = {
  ppt: "presentation",
  pptx: "presentation",
  xls: "sheets",
  xlsx: "sheets",
  csv: "sheets",
  tsv: "sheets",
  doc: "document",
  docx: "document",
  txt: "document",
  md: "document",
  markdown: "document",
  html: "code",
  htm: "code",
  js: "code",
  jsx: "code",
  ts: "code",
  tsx: "code",
  py: "code",
  css: "code",
  json: "code",
};

/**
 * Ordinary files (PDFs, images, unknown types) are Library resource citizens
 * (CANON D29) — not hollow Document JSON. Office/text/code stay as work.
 */
export function classifyLibraryImport(file: File): {
  kind: "portable" | "work" | "resource";
  blueprintKey?: ArtifactTypeKey;
  nativeFormat: string;
} {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const nativeFormat =
    extension && /^[a-z0-9][a-z0-9._-]{0,31}$/.test(extension)
      ? extension
      : file.type.startsWith("image/")
        ? file.type.slice("image/".length) || "img"
        : file.type === "application/pdf"
          ? "pdf"
          : "bin";
  if (extension === "spectra-pkg") {
    return { kind: "portable", nativeFormat: "spectra-pkg" };
  }
  const blueprintKey = WORK_EXTENSIONS[extension];
  if (blueprintKey) {
    return { kind: "work", blueprintKey, nativeFormat };
  }
  return { kind: "resource", nativeFormat };
}

export function documentContentFromImportedHtml(html: string) {
  const matches = [
    ...html.matchAll(/<(h[1-3]|p)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi),
  ];
  const blocks = matches.flatMap((match, index) => {
    const text = match[2]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return [];
    const heading = /^h[1-3]$/i.test(match[1]!);
    return [
      {
        id: `block-${index + 1}`,
        type: heading ? ("heading" as const) : ("paragraph" as const),
        text,
        ...(heading
          ? { attrs: { level: Number(match[1]!.slice(1)) } }
          : {}),
      },
    ];
  });
  return {
    blocks:
      blocks.length > 0
        ? blocks
        : [{ id: "intro", type: "paragraph" as const, text: "" }],
    outline: blocks
      .filter((block) => block.type === "heading")
      .map((block) => ({
        id: block.id,
        title: block.text,
        level: block.attrs?.level ?? 1,
      })),
  };
}

export function documentContentFromImportedPlainText(text: string) {
  const blocks = text
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((part, index) => ({
      id: `block-${index + 1}`,
      type: "paragraph" as const,
      text: part,
    }));
  return {
    blocks:
      blocks.length > 0
        ? blocks
        : [{ id: "intro", type: "paragraph" as const, text: "" }],
    outline: [] as Array<{ id: string; title: string; level: number }>,
  };
}

async function documentContentFromPdf(file: File) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = await file.arrayBuffer();
  enforcePdfInput(new Uint8Array(bytes));
  const pdfOptions = {
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    disableFontFace: true,
    enableScripting: false,
  };
  const loadingTask = pdfjs.getDocument(pdfOptions);
  const pdf = await loadingTask.promise;
  const pageTexts: string[] = [];
  try {
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) =>
          item && typeof item === "object" && "str" in item
            ? String((item as { str?: string }).str ?? "")
            : "",
        )
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) pageTexts.push(text);
    }
  } finally {
    await pdf.cleanup();
  }
  if (pageTexts.length === 0) return documentContentFromImportedPlainText("");
  const html = pageTexts
    .map(
      (page, index) =>
        `<h2>Page ${index + 1}</h2><p>${page
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</p>`,
    )
    .join("");
  return documentContentFromImportedHtml(html);
}

/**
 * Library import must project editable content, not a blank default whose
 * original bytes sit unused in import history.
 * PDFs are resource citizens (classifyLibraryImport) — this PDF projection
 * remains for callers that explicitly open a PDF as a document projection.
 */
export async function projectLibraryImportContent(
  file: File,
  blueprintKey: ArtifactTypeKey,
): Promise<unknown | undefined> {
  const name = file.name.toLowerCase();
  if (
    blueprintKey === "presentation" &&
    (name.endsWith(".pptx") || name.endsWith(".odp"))
  ) {
    const { importPresentationFile } = await import("../presentation/io");
    return (await importPresentationFile(file)).content;
  }
  if (blueprintKey !== "document") return undefined;
  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth/mammoth.browser");
    const checked = await readBoundedArchive(
      new Uint8Array(await file.arrayBuffer()),
      OFFICE_ARCHIVE_LIMITS,
    );
    const result = await mammoth.convertToHtml({
      arrayBuffer: bytesToArrayBuffer(checked.bytes),
    });
    return documentContentFromImportedHtml(result.value || "");
  }
  if (name.endsWith(".pdf")) return documentContentFromPdf(file);
  if (name.endsWith(".html") || name.endsWith(".htm")) {
    return documentContentFromImportedHtml(await file.text());
  }
  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown")
  ) {
    return documentContentFromImportedPlainText(await file.text());
  }
  return undefined;
}

export async function importLibraryResourceFile(
  file: File,
  options?: { workspaceId?: string; parentNodeId?: string; title?: string },
) {
  const body = new FormData();
  body.set("file", file, file.name);
  if (options?.title) body.set("title", options.title);
  if (options?.workspaceId) body.set("workspaceId", options.workspaceId);
  if (options?.parentNodeId) body.set("parentNodeId", options.parentNodeId);
  body.set("mimeType", file.type || "application/octet-stream");
  const response = await fetch("/api/spectra/resources", {
    method: "POST",
    body,
  });
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    artifactId?: string;
    nodeId?: string;
    nativeFormat?: string;
    error?: { message?: string };
    message?: string;
  } | null;
  if (!response.ok || !payload?.artifactId) {
    throw new Error(
      payload?.error?.message ||
        payload?.message ||
        "Could not import this file as a Library resource.",
    );
  }
  return {
    artifactId: payload.artifactId,
    nodeId: payload.nodeId,
    nativeFormat: payload.nativeFormat,
  };
}

/**
 * Parse Office files through the same lens contracts used by Bridge sync.
 * The bridge is deliberately not involved here: the server only needs the
 * uploaded bytes to produce the canonical native Spectra projection.
 */
export async function projectOfficeImportWithLens(file: File) {
  const body = new FormData();
  body.set("file", file, file.name);
  const response = await fetch("/api/spectra/imports/office", {
    method: "POST",
    body,
  });
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    blueprintKey?: ArtifactTypeKey;
    nativeFormat?: string;
    content?: unknown;
    fidelityReport?: Array<{
      scope: string;
      level: "exact" | "adapted" | "unsupported";
      message: string;
    }>;
    unsupportedFeatures?: string[];
    parserVersion?: string;
    message?: string;
  } | null;
  if (!response.ok || !payload?.ok || !payload.blueprintKey || payload.content === undefined) {
    throw new Error(payload?.message || "Could not parse this Office file with the Spectra lens.");
  }
  return payload;
}
