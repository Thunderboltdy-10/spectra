import { documentBlocksFromJson, documentContentToProseMirrorJson, type DocumentJsonNode } from "../lenses/document-projection";
import { createWhiteboardNode, normalizeWhiteboardContent } from "../whiteboard/model";

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
  throw new Error("Live references can be inserted into documents and whiteboards. Use a document or board as the host.");
}
