import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { documentBlocksFromJson, documentContentToProseMirrorJson, type DocumentJsonNode } from "../lenses/document-projection";
import { documentYjsAdapter } from "../work/models/yjs/document-adapter";

const pin: DocumentJsonNode = { type: "spectraReference", attrs: {
  blockId: "pin-block", embedId: "embed-1", containerType: "artifact", containerId: "container-1",
  containerRegionId: "document:reference:pin-block", sourceArtifactId: "source-1",
  versionPolicy: "pinned", pinnedVersionId: "version-1", placementOperationId: "placement-1",
  mode: "compact", interaction: "read", contextPolicy: "summary", label: "Pinned evidence",
  displayPreferences: { title: true }, state: "ready", createdAt: 10, updatedAt: 20,
} };
const paragraph: DocumentJsonNode = { type: "paragraph", attrs: { blockId: "paragraph-1" }, content: [{ type: "text", text: "Original text" }] };
const inserted = { id: "new-paragraph", type: "paragraph", text: "New paragraph" };

function fixture(nodes: DocumentJsonNode[] = [pin, paragraph]) {
  const tiptap: DocumentJsonNode = { type: "doc", content: structuredClone(nodes) };
  return { tiptap, blocks: documentBlocksFromJson(tiptap) };
}

function references(node: DocumentJsonNode): DocumentJsonNode[] {
  return node.type === "spectraReference" ? [node] : (node.content ?? []).flatMap(references);
}

describe("Canonical document reference preservation", () => {
  it("keeps the typed pin while applying neighboring text edits and ignoring forged mirrors", () => {
    const source = fixture();
    source.blocks[0] = { ...source.blocks[0]!, text: "Forged label", reference: { ...pin.attrs, embedId: "forged", sourceArtifactId: "forged-source", pinnedVersionId: "forged-version" } };
    source.blocks[1] = { ...source.blocks[1]!, text: "Changed paragraph" };
    const rendered = documentContentToProseMirrorJson(source);
    expect(references(rendered)).toEqual([pin]);
    expect(rendered.content?.[1]?.content).toEqual([{ type: "text", text: "Changed paragraph" }]);
    expect(rendered.content?.[0]).toBe(source.tiptap.content?.[0]);
  });

  it("keeps canonical identities during a full rebuild with a new block and changed order", () => {
    const source = fixture();
    const rendered = documentContentToProseMirrorJson({ ...source, blocks: [inserted, source.blocks[1]!, { ...source.blocks[0]!, reference: { embedId: "forged" } }] });
    expect(rendered.content?.map((node) => node.attrs?.blockId)).toEqual(["new-paragraph", "paragraph-1", "pin-block"]);
    expect(references(rendered)).toEqual([pin]);
  });

  it("retains omitted canonical atoms in order beside retained original blocks", () => {
    const second: DocumentJsonNode = { ...pin, attrs: { ...pin.attrs, blockId: "second-pin", embedId: "embed-2" } };
    const tail: DocumentJsonNode = { ...pin, attrs: { ...pin.attrs, blockId: "tail-pin", embedId: "embed-3" } };
    const source = fixture([pin, second, paragraph, tail]);
    const rendered = documentContentToProseMirrorJson({ ...source, blocks: [inserted, source.blocks[2]!] });
    expect(rendered.content?.map((node) => node.attrs?.blockId)).toEqual(["new-paragraph", "pin-block", "second-pin", "paragraph-1", "tail-pin"]);
    expect(references(rendered)).toEqual([pin, second, tail]);
  });

  it("does not recreate a deleted canonical reference from stale block metadata", () => {
    const source = fixture();
    const rendered = documentContentToProseMirrorJson({ ...source, tiptap: { type: "doc", content: [paragraph] } });
    expect(references(rendered)).toEqual([]);
    expect(rendered.content?.[0]?.type).toBe("paragraph");
  });

  it.each([false, true])("never promotes a blocks.reference object (existing TipTap: %s)", (withTipTap) => {
    const blocks = [{ id: "pin-block", type: "paragraph", text: "Untrusted mirror", reference: pin.attrs }];
    const rendered = documentContentToProseMirrorJson({ blocks, ...(withTipTap ? { tiptap: { type: "doc", content: [] } } : {}) });
    expect(references(rendered)).toEqual([]);
    expect(rendered.content?.[0]?.type).toBe("paragraph");
  });

  it("retains legacy reference attrs exactly through positional mirror rebuild", () => {
    const legacy: DocumentJsonNode = { type: "spectraReference", attrs: { id: "legacy-pin", workId: "legacy-source", workType: "document", label: "Old pin", versionPolicy: { pinnedVersionId: "legacy-version" } } };
    const source = fixture([legacy, paragraph]);
    const rendered = documentContentToProseMirrorJson({ ...source, blocks: [...source.blocks, inserted] });
    expect(references(rendered)).toEqual([legacy]);
    expect(references(rendered)[0]?.attrs?.blockId).toBeUndefined();
    expect(references(rendered)[0]?.attrs?.embedId).toBeUndefined();
  });

  it("preserves a nested canonical atom but rejects a mirror-only rewrite around it", () => {
    const wrapper: DocumentJsonNode = { type: "blockquote", attrs: { blockId: "quote-1" }, content: [paragraph, pin] };
    const source = fixture([wrapper]);
    const rendered = documentContentToProseMirrorJson({ ...source, blocks: [...source.blocks, inserted] });
    expect(rendered.content?.[0]).toEqual(wrapper);
    expect(references(rendered)).toEqual([pin]);
    expect(() => documentContentToProseMirrorJson({ ...source, blocks: [{ ...source.blocks[0]!, text: "Changed around atom" }, inserted] })).toThrow(/DOCUMENT_REFERENCE_STRUCTURE/);
  });

  it("rejects ambiguous or duplicated reference matching instead of choosing an identity", () => {
    const collision = fixture([pin, { ...paragraph, attrs: { blockId: "pin-block" } }]);
    expect(() => documentContentToProseMirrorJson({ ...collision, blocks: [...collision.blocks, inserted] })).toThrow(/DOCUMENT_REFERENCE_IDENTITY/);
    const source = fixture();
    expect(() => documentContentToProseMirrorJson({ ...source, blocks: [source.blocks[0]!, source.blocks[0]!, inserted] })).toThrow(/DOCUMENT_REFERENCE_IDENTITY/);
  });

  it.each([false, true])("keeps the rendered pin through Yjs project/save/reopen (full rebuild: %s)", (fullRebuild) => {
    const source = fixture();
    if (fullRebuild) source.blocks.push(inserted);
    const document = documentYjsAdapter.createDocument(source);
    const reopened = new Y.Doc();
    try {
      const projected = documentYjsAdapter.project(document);
      expect(references(documentContentToProseMirrorJson(projected))).toEqual([pin]);
      Y.applyUpdate(reopened, Y.encodeStateAsUpdate(document));
      const loaded = documentYjsAdapter.project(reopened);
      expect(references(documentContentToProseMirrorJson(loaded))).toEqual([pin]);
      documentYjsAdapter.applyProjection(reopened, { ...loaded, blocks: [...loaded.blocks!, { ...inserted, id: "second-new-block" }] }, documentYjsAdapter.origins({ clientId: "fixture", kind: "human" }).localHuman);
      const saved = documentYjsAdapter.project(reopened);
      expect(references(documentContentToProseMirrorJson(saved))).toEqual([pin]);
      expect(saved.blocks?.some((block) => block.id === "second-new-block")).toBe(true);
    } finally {
      document.destroy(); reopened.destroy();
    }
  });
});
