import mammoth from "mammoth";
import type { ImportedDocument } from "@/lib/editor/tiptap-import";
import { htmlToTiptapJson, textFromTiptapJson, titleFromFilename } from "@/lib/editor/tiptap-import";
import { bytesToArrayBuffer, OFFICE_ARCHIVE_LIMITS, readBoundedArchive } from "../../../shared/parser-limits";

/**
 * Lossy, one-shot DOCX import. This creates an independent Spectra document;
 * it is deliberately not exported from, or reachable by, the native replica
 * synchronization path in `features/spectra/lenses`.
 */
export async function importDocxCopyFile(file: File): Promise<ImportedDocument> {
  const bytes = await file.arrayBuffer();
  const checked = await readBoundedArchive(new Uint8Array(bytes), OFFICE_ARCHIVE_LIMITS);
  const result = await mammoth.convertToHtml({ arrayBuffer: bytesToArrayBuffer(checked.bytes) });
  const content = htmlToTiptapJson(result.value);
  return {
    title: titleFromFilename(file.name),
    content,
    contentPlaintext: textFromTiptapJson(content),
    source: "docx",
  };
}
