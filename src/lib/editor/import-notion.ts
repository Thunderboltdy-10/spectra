import { marked } from "marked";
import type { ImportedDocument } from "@/lib/editor/tiptap-import";
import { htmlToTiptapJson, textFromTiptapJson, titleFromFilename } from "@/lib/editor/tiptap-import";

export async function importNotionMarkdown(markdown: string, title?: string): Promise<ImportedDocument> {
  const html = await marked.parse(markdown, {
    gfm: true,
    breaks: false,
  });
  const content = htmlToTiptapJson(html);
  return {
    title,
    content,
    contentPlaintext: textFromTiptapJson(content),
    source: "markdown",
  };
}

export function importNotionHtml(html: string, title?: string): ImportedDocument {
  const content = htmlToTiptapJson(html);
  return {
    title,
    content,
    contentPlaintext: textFromTiptapJson(content),
    source: "html",
  };
}

export async function importNotionFile(file: File): Promise<ImportedDocument> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  const text = await file.text();
  if (ext === "html" || ext === "htm") {
    return importNotionHtml(text, titleFromFilename(file.name));
  }
  return importNotionMarkdown(text, titleFromFilename(file.name));
}
