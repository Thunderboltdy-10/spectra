"use client";

import { Extension, Node, mergeAttributes, type CommandProps } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { editNoteText } from "./note-text-edit";
import { applyDocumentAcademicOperations } from "../commands/office/document-academic-operations";
import { nextWordNoteId } from "../lenses/docx-academic-schema";
import { academicSelection } from "./document-academic-commands";

/**
 * Footnotes and endnotes.
 *
 * The inline marker owns a stable native note ID. The shared command edits its
 * rich story; the DOCX lens writes the separate footnote or endnote part.
 * Unmodeled stories expose their precise read-only reason in the editor.
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

function NoteView({ node, editor, getPos, selected }: NodeViewProps) {
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
            readOnly={Boolean(node.attrs.nativeReadOnly)}
            title={node.attrs.readOnlyReason || undefined}
            onChange={(event) => editor.commands.setNoteText(event.target.value)}
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
      return {
        text: { default: "" },
        /** Present when this marker was projected from a Word note part. */
        nativeNoteId: { default: null },
        noteContent: { default: null },
        readOnlyReason: { default: null },
        nativeReadOnly: { default: false },
      };
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
      ({ state, tr, dispatch }: CommandProps) => {
        const usedIds: string[] = [];
        state.doc.descendants((node) => {
          if (node.type.name === type && node.attrs.nativeNoteId != null) usedIds.push(String(node.attrs.nativeNoteId));
        });
        const nativeNoteId = nextWordNoteId(usedIds, crypto.getRandomValues(new Uint32Array(1))[0]!);
        const text = attrs?.text ?? "";
        const noteContent = text.split("\n").map((line) => [{ text: line }]);
        // Match References: validate the paragraph and preserve selected prose,
        // placing the reference at the range end. Use the command transaction
        // so chained commands and can() checks keep their normal semantics.
        applyDocumentAcademicOperations({ tiptap: state.doc.toJSON() }, [{ kind: "insert-note", noteType: type, noteId: nativeNoteId, anchor: academicSelection({ state }), content: noteContent }]);
        if (dispatch) {
          const position = state.selection.to;
          tr.insert(position, state.schema.nodes[type]!.create({ text, nativeNoteId, noteContent }));
          tr.setSelection(NodeSelection.create(tr.doc, position));
        }
        return true;
      };
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
          if (node.attrs.nativeReadOnly) return false;
          const noteContent = editNoteText(node.attrs.text, text, node.attrs.noteContent);
          applyDocumentAcademicOperations({ tiptap: state.doc.toJSON() }, [{ kind: "edit-note", noteType: node.type.name, noteId: node.attrs.nativeNoteId, expectedText: node.attrs.text, content: noteContent }]);
          tr.setNodeMarkup(selection.from, undefined, { ...node.attrs, text, noteContent });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});
