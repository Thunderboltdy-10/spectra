import { expect, it } from "vitest";
import * as Y from "yjs";
import { documentBlocksFromJson, type DocumentJsonNode } from "../lenses/document-projection";
import { canonicalArtifactWriteContent, resolveArtifactWriteInput, validateAiArtifactWriteContent } from "../operations/artifact-write-content";
import { initializeNativeArtifactDocument, nativeArtifactProjection } from "../../../../scripts/collaboration-native-projection.mjs";
import { planNativeArtifactYjsMutation } from "../work/models/yjs/native-artifact-model";

it("admits a validated rich list without collapsing its items when JSON fields are reordered", () => {
  const tiptap: DocumentJsonNode = { type: "doc", content: [{ type: "bulletList", attrs: { blockId: "methods" }, content: [
    { type: "listItem", content: [{ type: "paragraph", content: [
      { type: "text", text: "Lines: ", marks: [{ type: "bold" }] },
      { type: "inlineEquation", attrs: { latex: "r=a+tb" } },
    ] }] },
    { type: "listItem", content: [{ type: "paragraph", content: [
      { type: "text", text: "Check the third component.", marks: [{ type: "bold" }] },
    ] }] },
  ] }] };
  const input = { content: { tiptap, blocks: documentBlocksFromJson(tiptap) } };
  const content = validateAiArtifactWriteContent("document", input.content);
  const document = new Y.Doc();
  try {
    initializeNativeArtifactDocument(document, { typeKey: "document", title: "Revision", tags: [], content: { blocks: [] }, schemaVersion: 4 });
    document.transact(planNativeArtifactYjsMutation(document, "document", { title: "Revision", tags: [], content }, { clientId: "ai", kind: "ai", name: "Spectra" }).apply);
    const actual = canonicalArtifactWriteContent("document", nativeArtifactProjection(document, 4)!.content);
    const expected = resolveArtifactWriteInput("document", { blocks: [] }, input, "Make a revision page").content;
    expect(actual).toEqual(expected);
    expect((expected as { tiptap: DocumentJsonNode }).tiptap.content?.[0]?.content).toHaveLength(2);
  } finally { document.destroy(); }
});
