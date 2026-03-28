import type { ImportedDocument } from "@/lib/editor/tiptap-import";
import { htmlToTiptapJson, plainTextToTiptapJson, textFromTiptapJson } from "@/lib/editor/tiptap-import";

export function importClipboardData(dataTransfer: DataTransfer | null): ImportedDocument | null {
  if (!dataTransfer) return null;

  const html = dataTransfer.getData("text/html");
  if (html.trim()) {
    const content = htmlToTiptapJson(html);
    return {
      content,
      contentPlaintext: textFromTiptapJson(content),
      source: "clipboard",
    };
  }

  const text = dataTransfer.getData("text/plain");
  if (text.trim()) {
    const content = plainTextToTiptapJson(text);
    return {
      content,
      contentPlaintext: textFromTiptapJson(content),
      source: "clipboard",
    };
  }

  return null;
}
