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
  if (blueprintKey === "document" && name.endsWith(".docx")) {
    const mammoth = await import("mammoth/mammoth.browser");
    const result = await mammoth.convertToHtml({
      arrayBuffer: await file.arrayBuffer(),
    });
    return documentContentFromImportedHtml(result.value || "");
  }
  return undefined;
}
