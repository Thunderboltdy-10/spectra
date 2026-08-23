"use client";

import { Extension, Node, mergeAttributes, type CommandProps } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";

/**
 * Footnotes and endnotes.
 *
 * Word keeps note text in separate package parts, and Spectra preserves those
 * parts rather than rewriting them — so a note *written in Spectra* is a Spectra
 * note: an inline marker carrying its own text, numbered by CSS counters so the
 * sequence is always right without a field to refresh. The marker is the anchor
 * a reader clicks; the text is edited in place, where the writer is already
 * looking, instead of in a panel at the other end of the page.
 *
 * The distinction is stated in the workbar hint, not hidden: on a linked Word
 * file these commands are unavailable, because `footnotes` is a preserved region
 * and Spectra will not fabricate a `footnotes.xml` entry it cannot round-trip.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    spectraNotes: {
      insertFootnote: (attrs?: { text?: string }) => ReturnType;
      insertEndnote: (attrs?: { text?: string }) => ReturnType;
      /** Rewrites the note the caret is on. */
      setNoteText: (text: string) => ReturnType;
    };
  }
}

/** True only when this node is the selection, not when a range covers it. */
function isFocusedNode({ editor, getPos }: Pick<NodeViewProps, "editor" | "getPos">) {
  if (!editor || typeof getPos !== "function") return false;
  const position = getPos();
  if (typeof position !== "number") return false;
  const { selection } = editor.state;
  return selection instanceof NodeSelection && selection.from === position;
}

function NoteView({ node, editor, getPos, selected, updateAttributes }: NodeViewProps) {
  const text = typeof node.attrs.text === "string" ? node.attrs.text : "";
  const kind = node.type.name === "endnote" ? "endnote" : "footnote";
  const focused = Boolean(selected) && isFocusedNode({ editor, getPos });
  return (
    <NodeViewWrapper
      as="span"
      className={`spectra-note spectra-note-${kind} ${focused ? "is-selected" : ""}`}
      data-note={kind}
      data-empty={text.trim() ? undefined : "true"}
    >
      <sup className="spectra-note-marker" aria-label={`${kind} marker`} />
      {focused ? (
        <span className="spectra-note-editor">
          <textarea
            value={text}
            rows={Math.max(2, Math.min(6, text.split("\n").length + 1))}
            aria-label={`${kind === "endnote" ? "Endnote" : "Footnote"} text`}
            placeholder={
              kind === "endnote"
                ? "The note collected at the end of the document"
                : "The note printed at the foot of the page"
            }
            onChange={(event) => updateAttributes({ text: event.target.value })}
          />
        </span>
      ) : (
        <span className="spectra-note-preview" aria-hidden={text.trim() ? undefined : "true"}>
          {text.trim() || "Empty note"}
        </span>
      )}
    </NodeViewWrapper>
  );
}

function noteNode(name: "footnote" | "endnote") {
  return Node.create({
    name,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
      return { text: { default: "" } };
    },
    parseHTML() {
      return [{ tag: `span[data-note="${name}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return [
        "span",
        mergeAttributes(HTMLAttributes, { "data-note": name, class: `spectra-note spectra-note-${name}` }),
      ];
    },
    addNodeView() {
      return ReactNodeViewRenderer(NoteView) as never;
    },
  });
}

export const Footnote = noteNode("footnote");
export const Endnote = noteNode("endnote");

/**
 * The two insert commands and the shared text setter live on one small
 * extension so a studio mounts a single thing and both note kinds behave the
 * same way — including the selection that follows the insert, which is what
 * lets a writer type the note immediately instead of hunting for it.
 */
export const SpectraNotes = Extension.create({
  name: "spectraNotesCommands",
  addCommands() {
    const insert =
      (type: "footnote" | "endnote") =>
      (attrs?: { text?: string }) =>
      ({ commands }: CommandProps) =>
        commands.insertContent({ type, attrs: { text: attrs?.text ?? "" } });
    return {
      insertFootnote: insert("footnote"),
      insertEndnote: insert("endnote"),
      setNoteText:
        (text: string) =>
        ({ state, tr, dispatch }: CommandProps) => {
          const { selection } = state;
          if (!(selection instanceof NodeSelection)) return false;
          const node = selection.node;
          if (node.type.name !== "footnote" && node.type.name !== "endnote") return false;
          tr.setNodeMarkup(selection.from, undefined, { ...node.attrs, text });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});
