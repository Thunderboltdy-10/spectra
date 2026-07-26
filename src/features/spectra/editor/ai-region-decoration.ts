import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type AiRegionDecorationTarget = {
  all: boolean;
  indices: number[];
  blockIds: string[];
};

type AiRegionDecorationState = {
  target: AiRegionDecorationTarget | null;
  decorations: DecorationSet;
};

export const aiRegionDecorationKey = new PluginKey<AiRegionDecorationState>(
  "spectraAiRegionDecoration",
);

function decorationsFor(
  doc: ProseMirrorNode,
  target: AiRegionDecorationTarget,
) {
  const indices = new Set(target.indices);
  const blockIds = new Set(target.blockIds);
  const decorations: Decoration[] = [];
  doc.forEach((node, offset, index) => {
    if (
      target.all ||
      indices.has(index) ||
      (typeof node.attrs.blockId === "string" &&
        blockIds.has(node.attrs.blockId))
    ) {
      decorations.push(
        Decoration.node(offset, offset + node.nodeSize, {
          "data-ai-region": "true",
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

export const AiRegionDecoration = Extension.create({
  name: "spectraAiRegionDecoration",
  addProseMirrorPlugins() {
    return [
      new Plugin<AiRegionDecorationState>({
        key: aiRegionDecorationKey,
        state: {
          init: () => ({
            target: null,
            decorations: DecorationSet.empty,
          }),
          apply(transaction, previous) {
            const meta = transaction.getMeta(aiRegionDecorationKey) as
              AiRegionDecorationTarget | null | undefined;
            const target = meta === undefined ? previous.target : meta;
            if (!target)
              return {
                target: null,
                decorations: DecorationSet.empty,
              };
            if (meta !== undefined || transaction.docChanged) {
              return {
                target,
                decorations: decorationsFor(transaction.doc, target),
              };
            }
            return previous;
          },
        },
        props: {
          decorations(state) {
            return aiRegionDecorationKey.getState(state)?.decorations;
          },
        },
      }),
    ];
  },
});
