import type { JSONContent } from "@tiptap/core";
import {
  documentBlocksFromJson,
  docxIntentFromDocumentBlocks,
} from "../lenses/document-projection";
import { record } from "./artifact-content-model";

/** Shared conversion for imports and edits, independent of the mounted studio. */
export function documentContentFromJson(json: JSONContent, previous: unknown) {
  const previousRecord = record(previous);
  const blocks = documentBlocksFromJson(json);
  const nativeIntent = docxIntentFromDocumentBlocks(previous, blocks);
  return {
    ...previousRecord,
    tiptap: json,
    blocks:
      blocks.length > 0
        ? blocks
        : [{ id: "intro", type: "paragraph", text: "" }],
    outline: blocks
      .filter((block) => block.type === "heading")
      .map((block, index) => ({
        id: block.id,
        title: block.text || `Section ${index + 1}`,
        level: 1,
      })),
    ...(nativeIntent
      ? { nativeIntent, nativeProjectionComplete: true as const }
      : {}),
  };
}
