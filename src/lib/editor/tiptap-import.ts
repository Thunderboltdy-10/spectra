import { generateJSON, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

const IMPORT_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    codeBlock: { languageClassPrefix: "language-" },
  }),
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function htmlToTiptapJson(html: string): JSONContent {
  const normalized = html.trim();
  if (!normalized) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("htmlToTiptapJson requires a DOM environment.");
  }
  return generateJSON(normalized, IMPORT_EXTENSIONS);
}

export function plainTextToTiptapJson(text: string): JSONContent {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length === 0) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
  return {
    type: "doc",
    content: blocks.map((block) => ({
      type: "paragraph",
      content: [{ type: "text", text: block }],
    })),
  };
}

export function titleFromFilename(filename: string) {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imported note";
}

export function textFromTiptapJson(content: JSONContent | null | undefined): string {
  const chunks: string[] = [];

  function walk(node: JSONContent | undefined) {
    if (!node) return;
    if (isNonEmptyString(node.text)) {
      chunks.push(node.text);
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
      if (node.type === "paragraph" || node.type === "heading" || node.type === "blockquote" || node.type === "codeBlock") {
        chunks.push("\n");
      }
    }
  }

  walk(content ?? undefined);
  return chunks.join("").replace(/\n{3,}/g, "\n\n").trim();
}

export type ImportedDocument = {
  title?: string;
  content: JSONContent;
  contentPlaintext: string;
  source: "markdown" | "html" | "docx" | "pdf" | "clipboard" | "text";
};
