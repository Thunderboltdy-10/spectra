import mammoth from "mammoth";
import type { ImportedDocument } from "@/lib/editor/tiptap-import";
import { htmlToTiptapJson, textFromTiptapJson, titleFromFilename } from "@/lib/editor/tiptap-import";

/**
 * Lossy, one-shot DOCX import. This creates an independent Spectra document;
 * it is deliberately not exported from, or reachable by, the native replica
 * synchronization path in `features/spectra/lenses`.
 */
export async function importDocxCopyFile(file: File): Promise<ImportedDocument> {
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
