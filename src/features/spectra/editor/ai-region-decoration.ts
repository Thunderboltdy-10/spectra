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
  /** What Spectra wrote and the user has not seen yet (MOTION.md, "Afterwards"). */
  unseen: DecorationSet;
  /** Both, for the view. */
  all: DecorationSet;
};

/** Seeing a written block: "fade" starts its tint fading, "clear" drops every faded tint. */
type UnseenAction = { unseen: "fade"; pos: number } | { unseen: "clear" };
const UNSEEN_META = "spectraAiUnseen";
/** What Spectra wrote counts as seen after this long half in view. */
export const SEEN_MS = 1500;
/** Without a way to tell what is in view, the tint simply fades after this long. */
export const UNSEEN_FALLBACK_MS = 4000;
/** The tint's fade before it is removed (--motion-slow and a little). */
const FADE_MS = 700;

const unseenMark = (from: number, to: number, state: "true" | "fading") =>
  Decoration.node(from, to, { "data-ai-unseen": state }, { unseen: state });

/** The regions Spectra just finished writing become unseen tints, replacing any older tint on the same block. */
function leaveUnseen(doc: ProseMirrorNode, unseen: DecorationSet, written: DecorationSet) {
  let next = unseen;
  for (const region of written.find()) {
    next = next.remove(next.find(region.from, region.to, (spec) => spec.unseen !== undefined).filter((mark) => mark.from === region.from));
    next = next.add(doc, [unseenMark(region.from, region.to, "true")]);
  }
  return next;
}

function applyUnseen(doc: ProseMirrorNode, unseen: DecorationSet, action: UnseenAction) {
  if (action.unseen === "clear") return unseen.remove(unseen.find(undefined, undefined, (spec) => spec.unseen === "fading"));
  const marks = unseen.find(action.pos, action.pos, (spec) => spec.unseen === "true").filter(Boolean);
  return unseen.remove(marks).add(doc, marks.map((mark) => unseenMark(mark.from, mark.to, "fading")));
}

const withAll = (doc: ProseMirrorNode, state: Omit<AiRegionDecorationState, "all">): AiRegionDecorationState => ({
  ...state,
  all: state.unseen === DecorationSet.empty ? state.decorations : DecorationSet.create(doc, [...state.decorations.find(), ...state.unseen.find()]),
});

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
            unseen: DecorationSet.empty,
            all: DecorationSet.empty,
          }),
          apply(transaction, previous) {
            const meta = transaction.getMeta(aiRegionDecorationKey) as
              AiRegionDecorationTarget | null | undefined;
            const action = transaction.getMeta(UNSEEN_META) as UnseenAction | undefined;
            if (meta === undefined && !action && !transaction.docChanged) return previous;
            const doc = transaction.doc;
            let unseen = previous.unseen.map(transaction.mapping, doc);
            // A new target, or none: what Spectra was writing is written, and waits to be seen.
            if (meta !== undefined) unseen = leaveUnseen(doc, unseen, previous.decorations.map(transaction.mapping, doc));
            if (action) unseen = applyUnseen(doc, unseen, action);
            const target = meta === undefined ? previous.target : meta;
            if (!target) return withAll(doc, { target: null, decorations: DecorationSet.empty, unseen });
            if (meta !== undefined || transaction.docChanged) {
              return withAll(doc, { target, decorations: decorationsFor(doc, target), unseen });
            }
            return action ? withAll(doc, { ...previous, unseen }) : previous;
          },
        },
        props: {
          decorations(state) {
            return aiRegionDecorationKey.getState(state)?.all;
          },
        },
        view(editorView) {
          // Seeing a tinted block for a moment lets its tint fade.
          const timers = new Map<Element, ReturnType<typeof setTimeout>>();
          const run = (action: UnseenAction) => {
            if (!editorView.isDestroyed) editorView.dispatch(editorView.state.tr.setMeta(UNSEEN_META, action).setMeta("addToHistory", false));
          };
          const seen = (element: Element) => {
            timers.delete(element);
            observer?.unobserve(element);
            if (!element.isConnected) return;
            let pos: number;
            try {
              pos = editorView.posAtDOM(element, 0);
            } catch {
              return;
            }
            run({ unseen: "fade", pos });
            setTimeout(() => run({ unseen: "clear" }), FADE_MS);
          };
          const wait = (element: Element, ms: number) => {
            clearTimeout(timers.get(element));
            timers.set(element, setTimeout(() => seen(element), ms));
          };
          const observer =
            typeof IntersectionObserver === "undefined"
              ? null
              : new IntersectionObserver(
                  (entries) => {
                    for (const entry of entries) {
                      if (entry.isIntersecting && document.visibilityState === "visible") wait(entry.target, SEEN_MS);
                      else {
                        clearTimeout(timers.get(entry.target));
                        timers.delete(entry.target);
                      }
                    }
                  },
                  { threshold: 0.5 },
                );
          const watched = new Set<Element>();
          const sync = () => {
            for (const element of watched) {
              if (element.isConnected && element.getAttribute("data-ai-unseen") === "true") continue;
              watched.delete(element);
              observer?.unobserve(element);
            }
            for (const element of editorView.dom.querySelectorAll("[data-ai-unseen='true']")) {
              if (watched.has(element)) continue;
              watched.add(element);
              if (observer) observer.observe(element);
              else wait(element, UNSEEN_FALLBACK_MS);
            }
          };
          sync();
          return {
            update: sync,
            destroy() {
              observer?.disconnect();
              for (const timer of timers.values()) clearTimeout(timer);
              timers.clear();
            },
          };
        },
      }),
    ];
  },
});
