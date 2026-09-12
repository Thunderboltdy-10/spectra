import type { ImportedDocument } from "@/lib/editor/tiptap-import";
import { textFromTiptapJson, titleFromFilename } from "@/lib/editor/tiptap-import";
import { importDocxPayload } from "@/features/spectra/lenses/docx-adapter";

/**
 * Shared native DOCX import. This creates an independent Spectra document;
 * linked writeback still goes through the retained-package lens, while this
 * path uses the same projection semantics without retaining source authority.
 */
export async function importDocxCopyFile(file: File): Promise<ImportedDocument> {
  const result = await importDocxPayload(new Uint8Array(await file.arrayBuffer()));
  const content = result.json;
  return {
    title: titleFromFilename(file.name),
    content,
    contentPlaintext: textFromTiptapJson(content),
    source: "docx",
  };
}
