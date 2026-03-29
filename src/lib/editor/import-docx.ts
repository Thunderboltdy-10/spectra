import mammoth from "mammoth";
import type { ImportedDocument } from "@/lib/editor/tiptap-import";
import { htmlToTiptapJson, textFromTiptapJson, titleFromFilename } from "@/lib/editor/tiptap-import";

export async function importDocxFile(file: File): Promise<ImportedDocument> {
  const bytes = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes });
  const content = htmlToTiptapJson(result.value);
  return {
    title: titleFromFilename(file.name),
    content,
    contentPlaintext: textFromTiptapJson(content),
    source: "docx",
  };
}
