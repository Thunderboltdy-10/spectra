import { documentBlocksFromJson, documentContentToProseMirrorJson, type DocumentJsonNode } from "../lenses/document-projection";
import { createWhiteboardNode, normalizeWhiteboardContent } from "../whiteboard/model";
import { normalizePresentationContent } from "../presentation/model";

export type OperationReference = Record<string, unknown> & {
  embedId: string;
  placementOperationId: string;
  containerRegionId: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hasPlacement(value: unknown, reference: OperationReference): boolean {
  if (Array.isArray(value)) return value.some((child) => hasPlacement(child, reference));
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (row.placementOperationId === reference.placementOperationId) {
    if (row.embedId !== reference.embedId || row.containerRegionId !== reference.containerRegionId)
      throw new Error("REFERENCE_PLACEMENT_CONFLICT");
    return true;
  }
  return Object.values(row).some((child) => hasPlacement(child, reference));
}

/** Rebase on the current model. Replay recognizes the journal operation, not
 * a label or source id (two intentional references to one source are valid). */
export function insertOperationReference(type: string, content: unknown, reference: OperationReference) {
  if (hasPlacement(content, reference)) return content;
  const current = record(content);
  if (type === "document") {
    const document = documentContentToProseMirrorJson(current);
    const tiptap: DocumentJsonNode = { ...document, content: [...document.content ?? [], {
      type: "spectraReference", attrs: { ...reference, blockId: reference.containerRegionId },
    }] };
    // Keep the existing source bundle, native metadata and all rich inline
    // content; both canonical representations describe the same insertion.
    return { ...current, tiptap, blocks: documentBlocksFromJson(tiptap) };
  }
  if (type === "whiteboard") {
    const board = normalizeWhiteboardContent(content);
    const pageId = board.viewport.pageId;
    const layer = board.layers.find((candidate) => candidate.pageId === pageId && candidate.visible && !candidate.locked);
    if (!layer) throw new Error("Unlock a visible board layer before adding a live reference.");
    const pageNodes = board.nodes.filter((node) => node.pageId === pageId);
    const x = pageNodes.length ? Math.max(...pageNodes.map((node) => node.x + node.width)) + 24 : board.viewport.x;
    const y = pageNodes.length ? Math.min(...pageNodes.map((node) => node.y)) : board.viewport.y;
    const node = { ...createWhiteboardNode("embed", pageId, layer.id, x, y, board.nodes.length + 1),
      id: reference.containerRegionId, content: reference };
    return { ...current, ...board, nodes: [...board.nodes, node], zOrder: [...board.zOrder, node.id] };
  }
  if (type === "presentation") {
    const deck = normalizePresentationContent(content);
    const slide = deck.slides.at(-1);
    if (!slide) throw new Error("A presentation needs a slide before adding linked work.");
    const canvasHeight = deck.settings?.aspectRatio === "4:3" ? 750 : 562.5;
    const width = 440;
    const height = 210;
    const gap = 18;
    const xs = [40, 520];
    const ys = [48, 276, 504].filter((candidate) => candidate + height <= canvasHeight);
    const fits = (x: number, y: number) =>
      slide.objects.every((object) =>
        x + width + gap <= object.x ||
        object.x + object.width + gap <= x ||
        y + height + gap <= object.y ||
        object.y + object.height + gap <= y,
      );
    const slot = ys.flatMap((y) => xs.map((x) => ({ x, y }))).find(({ x, y }) => fits(x, y));
    let host = deck;
    let targetSlide = slide;
    let position = slot;
    if (!position) {
      targetSlide = {
        id: `reference-slide:${reference.containerRegionId}`,
        title: "Linked work",
        objects: [],
        sourceRefs: [],
        accessibility: { label: "Linked work" },
      };
      position = { x: 280, y: Math.max(48, Math.round((canvasHeight - height) / 2)) };
      host = { ...deck, slides: [...deck.slides, targetSlide] };
    }
    const nextOrder = targetSlide.objects.reduce(
      (maximum, object) => Math.max(maximum, object.readingOrder ?? 0),
      -1,
    ) + 1;
    const label = typeof reference.label === "string" ? reference.label : "Linked work";
    const object = {
      id: reference.containerRegionId,
      type: "embed" as const,
      ...position,
      width,
      height,
      rotation: 0,
      content: {
        embedId: reference.embedId,
        placementOperationId: reference.placementOperationId,
        containerRegionId: reference.containerRegionId,
        label,
        sourceArtifactId: reference.sourceArtifactId,
        versionPolicy: reference.versionPolicy,
        ...(reference.versionPolicy === "pinned"
          ? { pinnedVersionId: reference.pinnedVersionId }
          : {}),
      },
      altText: `${label} · linked artifact`,
      readingOrder: nextOrder,
      sourceBinding: {
        artifactId: String(reference.sourceArtifactId),
        kind: "artifact" as const,
        live: reference.versionPolicy === "live",
      },
    };
    const updatedSlide = { ...targetSlide, objects: [...targetSlide.objects, object] };
    const slides = host.slides.map((candidate) => candidate.id === targetSlide.id ? updatedSlide : candidate);
    return { ...host, slides };
  }
  throw new Error("Live references can be inserted into documents, whiteboards, and presentations. Use one of those as the host.");
}
