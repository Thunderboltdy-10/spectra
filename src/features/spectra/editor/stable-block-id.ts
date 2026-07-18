import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

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
 */
export const StableBlockId = Extension.create({
  name: "spectraStableBlockId",

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
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    const addressable = new Set<string>(REGION_NODE_TYPES);
    return [
      new Plugin({
        key: new PluginKey("spectraStableBlockId"),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged))
            return null;
          const transaction = newState.tr;
          let changed = false;
          newState.doc.descendants((node, position) => {
            if (!addressable.has(node.type.name) || node.attrs.blockId) return;
            transaction.setNodeMarkup(position, undefined, {
              ...node.attrs,
              blockId: createBlockId(),
            });
            changed = true;
          });
          return changed ? transaction : null;
        },
      }),
    ];
  },
});
