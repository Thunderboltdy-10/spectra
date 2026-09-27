import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { insertOperationReference } from "../operations/reference-content";
import { documentYjsAdapter } from "../work/models/yjs/document-adapter";
import { presentationYjsAdapter } from "../work/models/yjs/structured-adapters";
import { workYjsOrigins } from "../work/models/yjs/origins";
import { normalizeWhiteboardContent } from "../whiteboard/model";
import { createDefaultPresentationContent, normalizePresentationContent } from "../presentation/model";
import { presentationContentSchema } from "../artifacts/schemas";

const reference = { embedId: "embed", placementOperationId: "operation", containerRegionId: "reference-region",
  containerType: "artifact", containerId: "host", sourceArtifactId: "source", mode: "compact", interaction: "read", versionPolicy: "live", contextPolicy: "summary", state: "ready" };

describe("unmounted reference content", () => {
  it("preserves rich content and source metadata through the document Yjs adapter", () => {
    const content = { blocks: [{ id: "paragraph", type: "paragraph", text: "Authored text" }],
      tiptap: { type: "doc", content: [{ type: "paragraph", attrs: { blockId: "paragraph" }, content: [
        { type: "text", text: "Authored text", marks: [{ type: "bold" }] },
      ] }] }, sourceBundle: { sources: [{ id: "source" }], evidence: [{ id: "passage" }] } };
    const changed = insertOperationReference("document", content, reference) as Record<string, unknown>;
    expect(changed.sourceBundle).toEqual(content.sourceBundle);
    expect((changed.tiptap as typeof content.tiptap).content[0]).toEqual(content.tiptap.content[0]);
    const doc = new Y.Doc();
    documentYjsAdapter.applyProjection(doc, changed, workYjsOrigins({ clientId: "test", kind: "ai", name: "Spectra" }).ai);
    const saved = documentYjsAdapter.project(doc);
    expect(JSON.stringify(saved)).toContain('"placementOperationId":"operation"');
    expect(insertOperationReference("document", saved, reference)).toBe(saved);
    const next = insertOperationReference("document", saved, { ...reference, embedId: "embed-2", placementOperationId: "operation-2", containerRegionId: "reference-2" }) as Record<string, unknown>;
    expect((next.blocks as unknown[]).length).toBe(3);
    doc.destroy();
  });

  it("places a board reference in an unlocked visible layer without moving its viewport", () => {
    const board = normalizeWhiteboardContent({});
    const changed = insertOperationReference("whiteboard", board, reference) as typeof board;
    expect(changed.viewport).toEqual(board.viewport);
    expect(changed.nodes.at(-1)).toMatchObject({ type: "embed", id: reference.containerRegionId, content: reference });
    expect(insertOperationReference("whiteboard", changed, reference)).toBe(changed);
    expect(() => insertOperationReference("whiteboard", { ...board, layers: board.layers.map((layer) => ({ ...layer, locked: true })) }, reference)).toThrow("Unlock");
  });

  it("embeds a linked Code artifact in a presentation and preserves canonical identity", () => {
    const deck = createDefaultPresentationContent();
    const codeReference = {
      ...reference,
      label: "Interactive lab",
      sourceArtifactId: "code-artifact-7",
      versionPolicy: "live",
    };
    const changed = insertOperationReference("presentation", deck, codeReference) as typeof deck;
    const embed = changed.slides.at(-1)?.objects.find((object) => object.id === reference.containerRegionId);
    expect(embed).toMatchObject({
      type: "embed",
      sourceBinding: { artifactId: "code-artifact-7", kind: "artifact", live: true },
      content: {
        embedId: reference.embedId,
        placementOperationId: reference.placementOperationId,
        sourceArtifactId: "code-artifact-7",
      },
    });
    expect(presentationContentSchema.safeParse(changed).success).toBe(true);
    expect(insertOperationReference("presentation", changed, codeReference)).toBe(changed);
  });

  it("creates a new slide when the active slide has no non-overlapping embed slot", () => {
    const deck = createDefaultPresentationContent();
    deck.slides[0]!.objects = [{
      id: "background",
      type: "shape",
      x: 0,
      y: 0,
      width: 1_000,
      height: 562.5,
      rotation: 0,
      content: { shape: "rectangle" },
      readingOrder: 0,
    }];
    const changed = insertOperationReference("presentation", deck, reference) as typeof deck;
    expect(changed.slides).toHaveLength(deck.slides.length + 1);
    expect(changed.slides.at(-1)?.objects[0]).toMatchObject({
      id: reference.containerRegionId,
      type: "embed",
    });
    expect(presentationContentSchema.safeParse(changed).success).toBe(true);
  });

  it("keeps the exact pinned version through presentation insertion and normalization", () => {
    const pinned = { ...reference, versionPolicy: "pinned", pinnedVersionId: "version-old", label: "Retained work" };
    const inserted = insertOperationReference("presentation", createDefaultPresentationContent(), pinned);
    const saved = normalizePresentationContent(JSON.parse(JSON.stringify(inserted)));
    const embed = saved.slides.flatMap((slide) => slide.objects).find((object) => object.id === reference.containerRegionId);
    expect(embed).toMatchObject({
      type: "embed",
      sourceBinding: { live: false },
      content: {
        embedId: reference.embedId,
        sourceArtifactId: reference.sourceArtifactId,
        placementOperationId: reference.placementOperationId,
        containerRegionId: reference.containerRegionId,
        versionPolicy: "pinned",
        pinnedVersionId: "version-old",
      },
    });
    expect(insertOperationReference("presentation", saved, pinned)).toBe(saved);
    const doc = new Y.Doc();
    try {
      presentationYjsAdapter.applyProjection(doc, saved, workYjsOrigins({ clientId: "test", kind: "ai", name: "Spectra" }).ai);
      const projected = presentationYjsAdapter.project(doc);
      expect(projected.slides.flatMap((slide) => slide.objects).find((object) => object.id === reference.containerRegionId)?.content).toMatchObject({
        versionPolicy: "pinned", pinnedVersionId: "version-old", placementOperationId: reference.placementOperationId,
      });
    } finally {
      doc.destroy();
    }
  });

  it("rejects identity conflicts and gives unsupported hosts a supported alternative", () => {
    const saved = insertOperationReference("document", { blocks: [] }, reference);
    expect(() => insertOperationReference("document", saved, { ...reference, embedId: "other" })).toThrow("CONFLICT");
    expect(() => insertOperationReference("quiz", {}, reference)).toThrow("documents, whiteboards, and presentations");
  });
});
