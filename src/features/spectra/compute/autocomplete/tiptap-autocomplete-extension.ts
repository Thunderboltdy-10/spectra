import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { nextSuggestionWord, requestLocalAutocomplete } from "./autocomplete";

type GhostState = {
  text: string;
  position: number;
  suppressUntil: number;
};

const pluginKey = new PluginKey<GhostState>("spectraLocalAutocomplete");

function remoteOrAiTransaction(transaction: Transaction) {
  return Boolean(
    transaction.getMeta(ySyncPluginKey) ||
      transaction.getMeta("spectra:ai-origin") ||
      transaction.getMeta("spectra:remote-origin"),
  );
}

export const SpectraTiptapAutocomplete = Extension.create<{
  enabled: boolean;
  delayMs: number;
}>({
  name: "spectraLocalAutocomplete",
  addOptions() {
    return { enabled: true, delayMs: 420 };
  },
  addProseMirrorPlugins() {
    if (!this.options.enabled) return [];
    const delayMs = this.options.delayMs;
    return [
      new Plugin<GhostState>({
        key: pluginKey,
        state: {
          init: () => ({ text: "", position: 0, suppressUntil: 0 }),
          apply(transaction, previous) {
            const meta = transaction.getMeta(pluginKey) as
              | { type: "offer"; text: string; position: number }
              | { type: "clear" }
              | undefined;
            if (meta?.type === "offer") {
              return {
                text: meta.text,
                position: meta.position,
                suppressUntil: previous.suppressUntil,
              };
            }
            if (meta?.type === "clear") return { ...previous, text: "" };
            if (transaction.docChanged || transaction.selectionSet) {
              return {
                text: "",
                position: transaction.selection.to,
                suppressUntil: remoteOrAiTransaction(transaction)
                  ? Date.now() + 700
                  : previous.suppressUntil,
              };
            }
            return previous;
          },
        },
        props: {
          decorations(state) {
            const ghost = pluginKey.getState(state);
            if (!ghost?.text || ghost.position !== state.selection.to) {
              return DecorationSet.empty;
            }
            return DecorationSet.create(state.doc, [
              Decoration.widget(
                ghost.position,
                () => {
                  const span = document.createElement("span");
                  span.className = "spectra-autocomplete-ghost";
                  span.setAttribute("aria-hidden", "true");
                  span.textContent = ghost.text;
                  return span;
                },
                { side: 1, key: `spectra-ghost:${ghost.position}:${ghost.text}` },
              ),
            ]);
          },
          handleKeyDown(view, event) {
            const ghost = pluginKey.getState(view.state);
            if (!ghost?.text) return false;
            if (event.key === "Escape") {
              view.dispatch(view.state.tr.setMeta(pluginKey, { type: "clear" }));
              return true;
            }
            const accepted =
              event.key === "Tab"
                ? ghost.text
                : event.key === "ArrowRight" && view.state.selection.empty
                  ? nextSuggestionWord(ghost.text)
                  : "";
            if (!accepted) return false;
            const transaction = view.state.tr
              .insertText(accepted, view.state.selection.from, view.state.selection.to)
              .setMeta("spectra:autocomplete-accepted", true)
              .setMeta(pluginKey, { type: "clear" });
            view.dispatch(transaction);
            return true;
          },
        },
        view(view) {
          let timer: ReturnType<typeof setTimeout> | null = null;
          let request: ReturnType<typeof requestLocalAutocomplete> | null = null;
          let composing = false;
          let version = 0;
          const clearPending = () => {
            if (timer) clearTimeout(timer);
            timer = null;
            request?.cancel();
            request = null;
          };
          const schedule = () => {
            clearPending();
            const ghost = pluginKey.getState(view.state);
            if (
              composing ||
              !view.state.selection.empty ||
              !view.state.selection.$from.parent.isTextblock ||
              Date.now() < (ghost?.suppressUntil ?? 0)
            ) {
              return;
            }
            const position = view.state.selection.to;
            const from = Math.max(0, position - 320);
            const value = view.state.doc.textBetween(from, position, "\n", " ");
            if (value.trim().length < 8) return;
            const requestVersion = ++version;
            timer = setTimeout(() => {
              request = requestLocalAutocomplete({
                value,
                cursor: value.length,
                surface: "document",
              });
              void request.result
                .then((suggestion) => {
                  if (
                    requestVersion !== version ||
                    !suggestion ||
                    view.state.selection.to !== position
                  ) {
                    return;
                  }
                  view.dispatch(
                    view.state.tr.setMeta(pluginKey, {
                      type: "offer",
                      text: suggestion.text,
                      position,
                    }),
                  );
                })
                .catch(() => {});
            }, delayMs);
          };
          const dom = view.dom;
          const onCompositionStart = () => {
            composing = true;
            clearPending();
            view.dispatch(view.state.tr.setMeta(pluginKey, { type: "clear" }));
          };
          const onCompositionEnd = () => {
            composing = false;
            schedule();
          };
          dom.addEventListener("compositionstart", onCompositionStart);
          dom.addEventListener("compositionend", onCompositionEnd);
          schedule();
          return {
            update: schedule,
            destroy() {
              clearPending();
              dom.removeEventListener("compositionstart", onCompositionStart);
              dom.removeEventListener("compositionend", onCompositionEnd);
            },
          };
        },
      }),
    ];
  },
});
