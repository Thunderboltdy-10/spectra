import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { aiRegionDecorationKey } from "./ai-region-decoration";
import { isYjsOriginDocumentTransaction } from "./collaboration-change";

/*
 * Spectra writing prose (MOTION.md, "Spectra writing"): text resolves out of
 * the light front a few words at a time, from a slight blur, and never
 * character by character. Each chunk of Spectra's text that arrives while it
 * is writing a region resolves on its own (CSS, .spectra-ai-resolve). Then
 * the mark is dropped, and the text is ordinary content.
 */

/** How long a chunk takes to resolve, a little longer than its CSS animation. */
export const RESOLVE_MS = 520;
/** A larger insertion is a hydration or a whole reload, not writing: it simply appears. */
export const MAX_RESOLVE_CHARS = 400;

type ResolveState = DecorationSet;
const EXPIRE_META = "spectraAiResolveExpire";

export const aiTextResolveKey = new PluginKey<ResolveState>("spectraAiTextResolve");

/** The ranges a transaction inserted, in the new document. */
export function insertedRanges(transaction: Transaction) {
  const ranges: Array<[number, number]> = [];
  transaction.mapping.maps.forEach((map, index) => {
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      if (newEnd <= newStart) return;
      // Map the range through the steps after this one.
      const later = transaction.mapping.slice(index + 1);
      const from = later.map(newStart, 1);
      const to = later.map(newEnd, -1);
      if (to > from) ranges.push([from, to]);
    });
  });
  return ranges;
}

export const AiTextResolve = Extension.create({
  name: "spectraAiTextResolve",
  addProseMirrorPlugins() {
    return [
      new Plugin<ResolveState>({
        key: aiTextResolveKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, previous, oldState) {
            let next = previous.map(transaction.mapping, transaction.doc);
            const expireBefore = transaction.getMeta(EXPIRE_META) as number | undefined;
            if (expireBefore !== undefined) next = next.remove(next.find(undefined, undefined, (spec) => spec.at <= expireBefore));
            const writing = Boolean(aiRegionDecorationKey.getState(oldState)?.target);
            if (!transaction.docChanged || !writing || !isYjsOriginDocumentTransaction(transaction)) return next;
            const at = Date.now();
            const marks: Decoration[] = [];
            for (const [from, to] of insertedRanges(transaction)) {
              const text = transaction.doc.textBetween(from, to, " ");
              if (!text.trim() || text.length > MAX_RESOLVE_CHARS) continue;
              marks.push(Decoration.inline(from, to, { class: "spectra-ai-resolve" }, { at }));
            }
            return marks.length ? next.add(transaction.doc, marks) : next;
          },
        },
        props: {
          decorations(state) {
            return aiTextResolveKey.getState(state);
          },
        },
        view(editorView) {
          let timer: ReturnType<typeof setTimeout> | null = null;
          const schedule = () => {
            if (timer || !aiTextResolveKey.getState(editorView.state)?.find().length) return;
            timer = setTimeout(() => {
              timer = null;
              if (editorView.isDestroyed) return;
              editorView.dispatch(editorView.state.tr.setMeta(EXPIRE_META, Date.now() - RESOLVE_MS).setMeta("addToHistory", false));
              schedule();
            }, RESOLVE_MS);
          };
          return {
            update: schedule,
            destroy() {
              if (timer) clearTimeout(timer);
            },
          };
        },
      }),
    ];
  },
});
