import { documentContentToProseMirrorJson } from "../../../../shared/document-projection.mjs";

/** Rebuild the local animation canvas without the saved document showing
 * through unreached blocks. This value is only passed to a read-only editor,
 * never the room or a persistence API. Keep canonical subtrees for blocks
 * still present, including their rich lists and reference identities. */
export function documentPerformancePreview(value: unknown) {
  const content = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const blocks = Array.isArray(content.blocks) ? content.blocks as Array<{ id?: string }> : [];
  const ids = new Set(blocks.map((block) => block.id));
  const saved = content.tiptap && typeof content.tiptap === "object" ? content.tiptap as { content?: Array<{ attrs?: { blockId?: string } }> } : {};
  const tiptap = { type: "doc", content: (saved.content ?? []).filter((node) => ids.has(node.attrs?.blockId)) };
  return { ...content, tiptap: documentContentToProseMirrorJson({ ...content, tiptap }) };
}
