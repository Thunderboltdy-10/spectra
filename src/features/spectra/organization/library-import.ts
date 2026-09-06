import type { ArtifactTypeKey } from "../artifacts/types";

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
].join(",");

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
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;
  const pageTexts: string[] = [];
  try {
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item: { str?: string }) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) pageTexts.push(text);
    }
  } finally {
    await pdf.destroy();
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
    const result = await mammoth.convertToHtml({
      arrayBuffer: await file.arrayBuffer(),
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
