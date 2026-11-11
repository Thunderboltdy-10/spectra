import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import { isYjsOriginDocumentTransaction } from "./collaboration-change";

/**
 * Keeps somewhere to type below a list or table, without touching a document
 * nobody edited. StarterKit's trailing node adds its paragraph as soon as the
 * shared document arrives, so only opening a document ending in a list wrote a
 * new version of it, moved it up the recent list and could change a Word file.
 * Here the paragraph arrives with the person's own edit, or when they click in
 * the space under the last block.
 */
export const LocalTrailingParagraph = Extension.create({
  name: "spectraLocalTrailingParagraph",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("spectraLocalTrailingParagraph"),
        appendTransaction: (transactions, _oldState, state) => {
          const changes = transactions.filter((transaction) => transaction.docChanged);
          if (!changes.length || changes.every(isYjsOriginDocumentTransaction)) return null;
          const type = state.schema.nodes.paragraph;
          if (!type || state.doc.lastChild?.type === type) return null;
          return state.tr.insert(state.doc.content.size, type.create());
        },
        props: {
          handleClick: (view, _position, event) => {
            const last = view.dom.lastElementChild;
            const type = view.state.schema.nodes.paragraph;
            if (!view.editable || !last || !type) return false;
            if (view.state.doc.lastChild?.type === type) return false;
            if (event.clientY <= last.getBoundingClientRect().bottom) return false;
            const { doc, tr } = view.state;
            const end = doc.content.size;
            tr.insert(end, type.create());
            tr.setSelection(TextSelection.create(tr.doc, end + 1));
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
