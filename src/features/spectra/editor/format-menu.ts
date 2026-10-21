import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";

/*
 * The floating formatting bar opens on a right-click, never on its own: the
 * bar at the top of the document carries the same commands, and a bar that
 * jumps up at every selection covers the words being selected. A right-click
 * outside the selection moves the caret there first (or picks the picture or
 * table it landed on), as a right-click does in Word; Shift and right-click
 * still give the browser's own menu. The bar closes when the selection moves,
 * the words change, or on Escape.
 */

const formatMenuKey = new PluginKey<boolean>("formatMenu");
/** The floating bar's own plugin key (BubbleMenu's `pluginKey`), told to show and hide. */
export const FORMAT_BAR_KEY = "formatBar";

/** Whether a right-click asked for the floating bar and it still stands. */
export function formatMenuOpen(state: EditorState) {
  return formatMenuKey.getState(state) ?? false;
}

export const FormatMenu = Extension.create({
  name: "formatMenu",
  addProseMirrorPlugins() {
    return [
      new Plugin<boolean>({
        key: formatMenuKey,
        state: {
          init: () => false,
          apply(transaction, open) {
            const asked = transaction.getMeta(formatMenuKey) as boolean | undefined;
            if (asked !== undefined) return asked;
            return open && !transaction.selectionSet && !transaction.docChanged;
          },
        },
        props: {
          handleDOMEvents: {
            contextmenu(view, event) {
              if (event.shiftKey || !view.editable) return false;
              event.preventDefault();
              const transaction = view.state.tr.setMeta(formatMenuKey, true).setMeta(FORMAT_BAR_KEY, "show");
              const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
              const { from, to } = view.state.selection;
              if (at && (at.pos < from || at.pos > to)) {
                const node = at.inside >= 0 ? view.state.doc.nodeAt(at.inside) : null;
                transaction.setSelection(
                  node?.isAtom
                    ? NodeSelection.create(view.state.doc, at.inside)
                    : TextSelection.near(view.state.doc.resolve(at.pos)),
                );
              }
              view.focus();
              view.dispatch(transaction);
              // The bar measures itself once shown; place it again on the next frame.
              requestAnimationFrame(() => {
                if (formatMenuOpen(view.state)) view.dispatch(view.state.tr.setMeta(FORMAT_BAR_KEY, "updatePosition"));
              });
              return true;
            },
          },
          handleKeyDown(view, event) {
            if (event.key !== "Escape" || !formatMenuOpen(view.state)) return false;
            // This Escape only closes the bar; whatever holds the editor must not act on it too.
            event.stopPropagation();
            view.dispatch(view.state.tr.setMeta(formatMenuKey, false).setMeta(FORMAT_BAR_KEY, "hide"));
            return true;
          },
        },
      }),
    ];
  },
});
