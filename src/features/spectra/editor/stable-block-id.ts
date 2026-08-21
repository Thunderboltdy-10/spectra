import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const REGION_NODE_TYPES = [
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "callout",
  "image",
  "equation",
] as const;

function createBlockId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return `block_${crypto.randomUUID()}`;
  return `block_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Gives every addressable document region a durable identity. IDs are stored in
 * the native ProseMirror JSON and rendered to the DOM for presence/effects; they
 * are never derived from array position, text, or a collaborator's session.
 * Duplicate ids (paste, AI short ids) are rewritten so Yjs region maps stay unique.
 */
export const StableBlockId = Extension.create({
  name: "spectraStableBlockId",

  addOptions() {
    return { nativeReadOnlyBlockIds: [] as string[] };
  },

  addGlobalAttributes() {
    return [
      {
        types: [...REGION_NODE_TYPES],
        attributes: {
          blockId: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-block-id"),
            renderHTML: (attributes) =>
              typeof attributes.blockId === "string" && attributes.blockId
                ? { "data-block-id": attributes.blockId }
                : {},
          },
          nativeReadOnly: {
            default: false,
            parseHTML: (element) =>
              element.getAttribute("data-native-read-only") === "true",
            renderHTML: (attributes) =>
              attributes.nativeReadOnly === true
                ? {
                    "data-native-read-only": "true",
                    contenteditable: "false",
                  }
                : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    const addressable = new Set<string>(REGION_NODE_TYPES);
    const configuredProtected = new Set<string>(
      this.options.nativeReadOnlyBlockIds,
    );
    const isProtected = (node: {
      attrs: { blockId?: unknown; nativeReadOnly?: unknown };
    }) =>
      node.attrs.nativeReadOnly === true ||
      (typeof node.attrs.blockId === "string" &&
        configuredProtected.has(node.attrs.blockId));
    return [
      new Plugin({
        key: new PluginKey("spectraStableBlockId"),
        filterTransaction: (transaction, state) => {
          if (!transaction.docChanged) return true;
          const protectedBlocks = new Map<string, string>();
          state.doc.descendants((node) => {
            if (
              isProtected(node) &&
              typeof node.attrs.blockId === "string" &&
              node.attrs.blockId
            )
              protectedBlocks.set(
                node.attrs.blockId,
                JSON.stringify(node.toJSON()),
              );
          });
          if (!protectedBlocks.size) return true;
          const nextProtected = new Map<string, string>();
          transaction.doc.descendants((node) => {
            if (
              typeof node.attrs.blockId === "string" &&
              protectedBlocks.has(node.attrs.blockId)
            )
              nextProtected.set(
                node.attrs.blockId,
                JSON.stringify(node.toJSON()),
              );
          });
          return [...protectedBlocks].every(
            ([blockId, serialized]) =>
              nextProtected.get(blockId) === serialized,
          );
        },
        props: {
          decorations: (state) => {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, position) => {
              if (!isProtected(node)) return;
              decorations.push(
                Decoration.node(position, position + node.nodeSize, {
                  "data-native-read-only": "true",
                  contenteditable: "false",
                }),
              );
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged))
            return null;
          const transaction = newState.tr;
          let changed = false;
          const seen = new Set<string>();
          newState.doc.descendants((node, position) => {
            if (!addressable.has(node.type.name)) return;
            let blockId =
              typeof node.attrs.blockId === "string" && node.attrs.blockId
                ? node.attrs.blockId
                : null;
            if (!blockId || seen.has(blockId)) {
              blockId = createBlockId();
              transaction.setNodeMarkup(position, undefined, {
                ...node.attrs,
                blockId,
              });
              changed = true;
            }
            seen.add(blockId);
          });
          return changed ? transaction : null;
        },
      }),
    ];
  },
});
