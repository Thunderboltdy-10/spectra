import { documentContentToProseMirrorJson } from "./document-projection.mjs";
import { isDurableContentRef, MAX_DURABLE_PAYLOAD_BYTES } from "./durable-content";

/** Identity of a retained pin, read from its server-owned embed row. */
export type PinnedPlacementTarget = {
  embedId: string;
  containerId: string;
  containerRegionId: string;
  sourceArtifactId: string;
  pinnedVersionId: string;
  placementOperationId?: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function exactReference(value: unknown, target: PinnedPlacementTarget): boolean {
  const reference = record(value);
  return reference.embedId === target.embedId &&
    reference.sourceArtifactId === target.sourceArtifactId &&
    reference.containerRegionId === target.containerRegionId &&
    reference.versionPolicy === "pinned" &&
    reference.pinnedVersionId === target.pinnedVersionId &&
    (reference.containerType == null || reference.containerType === "artifact") &&
    (reference.containerId == null || reference.containerId === target.containerId) &&
    // Older Tiptap schemas discarded the operation attribute. The exact typed
    // placement is still evidence; a conflicting operation never is.
    (reference.placementOperationId == null || reference.placementOperationId === target.placementOperationId);
}

function legacyDocumentReference(value: unknown, target: PinnedPlacementTarget): boolean {
  const reference = record(value);
  return !target.placementOperationId && reference.embedId == null &&
    typeof reference.id === "string" && reference.id.length > 0 &&
    target.containerRegionId === `document:reference:${reference.id}` &&
    reference.workId === target.sourceArtifactId &&
    record(reference.versionPolicy).pinnedVersionId === target.pinnedVersionId;
}

const documentBlockContainers = new Set(["doc", "blockquote", "callout", "listItem", "taskItem", "tableCell", "tableHeader"]);
// Only these block nodes can lead to an embedded reference. Structural-only
// nodes must be reached through their table/list parent, never a block slot.
const documentReferenceBlocks = new Set(["spectraReference", "blockquote", "callout", "bulletList", "orderedList", "taskList", "table"]);
const documentStructuralChildren: Record<string, ReadonlySet<string>> = {
  bulletList: new Set(["listItem"]), orderedList: new Set(["listItem"]), taskList: new Set(["taskItem"]),
  table: new Set(["tableRow"]), tableRow: new Set(["tableCell", "tableHeader"]),
};

/**
 * Only actual model slots qualify. Metadata, source bundles, mirrored document
 * blocks and arbitrary authored objects cannot manufacture a placement. The
 * caller supplies materialized current content, never a durable-ref wrapper.
 * A finite complete traversal is required, even after finding a match.
 */
export function containsPinnedArtifactPlacement(
  typeKey: string,
  content: unknown,
  target: PinnedPlacementTarget,
  limits = { nodes: MAX_DURABLE_PAYLOAD_BYTES, depth: 1024 },
): boolean {
  if (isDurableContentRef(content)) return false;
  let remaining = limits.nodes;
  let found = false;
  const root = record(content);
  if (typeKey === "document") {
    // Follow the same block/native reconciliation as the editor and gateway,
    // rather than granting from a stale alternate representation.
    let projected: unknown;
    try { projected = documentContentToProseMirrorJson(root); }
    catch { return false; }
    if (record(projected).type !== "doc") return false;
    const stack: Array<{ node: unknown; depth: number; parentType?: string }> = [{ node: projected, depth: 0 }];
    while (stack.length) {
      const entry = stack.pop()!;
      if (--remaining < 0 || entry.depth > limits.depth) return false;
      const node = record(entry.node);
      if ((node.type === "listItem" || node.type === "taskItem") &&
        (!Array.isArray(node.content) || record(node.content[0]).type !== "paragraph")) continue;
      if (node.type === "spectraReference" && documentBlockContainers.has(entry.parentType ?? "")) {
        found ||= exactReference(node.attrs, target) || legacyDocumentReference(node.attrs, target);
      }
      const type = typeof node.type === "string" ? node.type : "";
      const structuralChildren = documentStructuralChildren[type];
      if (Array.isArray(node.content) && (documentBlockContainers.has(type) || structuralChildren)) {
        if (node.content.length > remaining) return false;
        for (const child of node.content) {
          const childType = String(record(child).type);
          if (structuralChildren ? !structuralChildren.has(childType) : !documentReferenceBlocks.has(childType)) continue;
          stack.push({ node: child, depth: entry.depth + 1, parentType: type });
        }
      }
    }
    return found;
  }
  if (typeKey === "whiteboard") {
    const nodes = Array.isArray(root.nodes) ? root.nodes : [];
    if (nodes.length > remaining) return false;
    for (const value of nodes) {
      const node = record(value);
      if (node.type === "embed" && node.id === target.containerRegionId && exactReference(node.content, target)) found = true;
    }
    return found;
  }
  if (typeKey === "presentation") {
    const slides = Array.isArray(root.slides) ? root.slides : [];
    for (const value of slides) {
      if (--remaining < 0) return false;
      const objects = record(value).objects;
      if (!Array.isArray(objects)) continue;
      remaining -= objects.length;
      if (remaining < 0) return false;
      for (const candidate of objects) {
        const object = record(candidate);
        if (object.type === "embed" && object.id === target.containerRegionId && exactReference(object.content, target)) found = true;
      }
    }
    return found;
  }
  return false;
}
