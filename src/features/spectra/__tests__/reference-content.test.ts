import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { insertOperationReference, removeOperationReference } from "../operations/reference-content";
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

  it("sets a document reference at the end of the section it belongs to", () => {
    const heading = (blockId: string, level: number, text: string) => ({ type: "heading", attrs: { blockId, level }, content: [{ type: "text", text }] });
    const paragraph = (blockId: string, text: string) => ({ type: "paragraph", attrs: { blockId }, content: [{ type: "text", text }] });
    const tiptap = { type: "doc", content: [
      heading("h1", 2, "Session 1 – Membranes"), paragraph("p1", "Diffusion and osmosis."), heading("h1a", 3, "Check yourself"), paragraph("p1a", "Why does water move?"),
      heading("h2", 2, "Session 2 – Enzymes"), paragraph("p2", "Active sites."),
    ] };
    const ids = (value: unknown) => ((value as { tiptap: typeof tiptap }).tiptap.content).map((node) => node.attrs.blockId);
    const changed = insertOperationReference("document", { tiptap }, reference, { after: "session 1 – membranes" });
    expect(ids(changed)).toEqual(["h1", "p1", "h1a", "p1a", "reference-region", "h2", "p2"]);
    expect(ids(insertOperationReference("document", { tiptap }, reference, { after: "Session 2 – Enzymes" })).at(-1)).toBe("reference-region");
    expect(() => insertOperationReference("document", { tiptap }, reference, { after: "Session 3" })).toThrow(/No heading matches/);
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
  it("removes an embed's node from each host and leaves other content alone", () => {
    const doc = insertOperationReference("document", { blocks: [{ id: "paragraph", type: "paragraph", text: "Kept" }] }, reference);
    const fromDoc = removeOperationReference("document", doc, reference.embedId);
    expect(fromDoc.removed).toBe(1);
    expect(JSON.stringify(fromDoc.content)).not.toContain('"embedId":"embed"');
    expect(JSON.stringify(fromDoc.content)).toContain("Kept");
    expect(removeOperationReference("document", fromDoc.content, reference.embedId)).toEqual({ content: fromDoc.content, removed: 0 });

    const board = insertOperationReference("whiteboard", normalizeWhiteboardContent({}), reference) as ReturnType<typeof normalizeWhiteboardContent>;
    const linked = { ...board, edges: [{ id: "edge", from: reference.containerRegionId, to: "other" }] };
    const fromBoard = removeOperationReference("whiteboard", linked, reference.embedId);
    const boardAfter = fromBoard.content as typeof board;
    expect(fromBoard.removed).toBe(1);
    expect(boardAfter.nodes.some((node) => node.id === reference.containerRegionId)).toBe(false);
    expect(boardAfter.edges).toEqual([]);
    expect(boardAfter.zOrder).not.toContain(reference.containerRegionId);

    const deck = insertOperationReference("presentation", createDefaultPresentationContent(), reference);
    const fromDeck = removeOperationReference("presentation", deck, reference.embedId);
    expect(fromDeck.removed).toBe(1);
    expect(presentationContentSchema.safeParse(fromDeck.content).success).toBe(true);
    expect(removeOperationReference("quiz", {}, reference.embedId)).toEqual({ content: {}, removed: 0 });
  });
});
