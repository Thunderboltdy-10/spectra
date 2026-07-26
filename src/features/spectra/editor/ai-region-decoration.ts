import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type AiRegionDecorationTarget = {
  all: boolean;
  indices: number[];
  blockIds: string[];
  /** Bullet / soft-line indices scoped to a top-level block. */
  lines: Array<{ blockId?: string; index?: number; line: number }>;
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
  const linesByBlockId = new Map<string, Set<number>>();
  const linesByIndex = new Map<number, Set<number>>();
  for (const entry of target.lines) {
    if (typeof entry.blockId === "string" && entry.blockId) {
      const set = linesByBlockId.get(entry.blockId) ?? new Set<number>();
      set.add(entry.line);
      linesByBlockId.set(entry.blockId, set);
    }
    if (typeof entry.index === "number" && Number.isFinite(entry.index)) {
      const set = linesByIndex.get(entry.index) ?? new Set<number>();
      set.add(entry.line);
      linesByIndex.set(entry.index, set);
    }
  }
  const decorations: Decoration[] = [];
  doc.forEach((node, offset, index) => {
    const blockId =
      typeof node.attrs.blockId === "string" ? node.attrs.blockId : undefined;
    const matched =
      target.all ||
      indices.has(index) ||
      (blockId !== undefined && blockIds.has(blockId));
    const lineSet =
      (blockId ? linesByBlockId.get(blockId) : undefined) ??
      linesByIndex.get(index);
    if (lineSet && lineSet.size > 0) {
      if (
        node.type.name === "bulletList" ||
        node.type.name === "orderedList"
      ) {
        let pos = offset + 1;
        node.forEach((child, _childOffset, childIndex) => {
          if (lineSet.has(childIndex)) {
            decorations.push(
              Decoration.node(pos, pos + child.nodeSize, {
                "data-ai-region": "true",
              }),
            );
          }
          pos += child.nodeSize;
        });
        return;
      }
      decorations.push(
        Decoration.node(offset, offset + node.nodeSize, {
          "data-ai-region": "true",
        }),
      );
      return;
    }
    if (matched) {
      // Prefer the last list item when AI only published /blocks/{id}/text —
      // whole-list cyan wash feels dead; the rewritten bullet is usually last.
      if (
        node.type.name === "bulletList" ||
        node.type.name === "orderedList"
      ) {
        let lastFrom = -1;
        let lastTo = -1;
        let pos = offset + 1;
        node.forEach((child) => {
          if (child.type.name === "listItem") {
            lastFrom = pos;
            lastTo = pos + child.nodeSize;
          }
          pos += child.nodeSize;
        });
        if (lastFrom >= 0) {
          decorations.push(
            Decoration.node(lastFrom, lastTo, {
              "data-ai-region": "true",
            }),
          );
          return;
        }
      }
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
