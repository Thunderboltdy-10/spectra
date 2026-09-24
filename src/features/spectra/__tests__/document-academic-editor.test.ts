// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import { Footnote, Endnote, SpectraNotes } from "../editor/document-notes";
import { WordRevision, WordCommentBoundary, SpectraCitationNode } from "../editor/reference-citation-nodes";
import { academicSelection, executeAcademicEditorOperations } from "../editor/document-academic-commands";
import { documentYjsAdapter, DOCUMENT_YJS_FRAGMENT } from "../work/models/yjs/document-adapter";
import { documentBlocksFromJson } from "../lenses/document-projection";
import { MAX_WORD_NOTE_ID } from "../lenses/docx-academic-schema";

vi.mock("../components/artifact-embed-host", () => ({ ArtifactEmbedById: () => null }));
const BlockAttrs = Extension.create({ name: "testBlockAttrs", addGlobalAttributes() { return [{ types: ["paragraph"], attributes: { blockId: { default: null }, textAlign: { default: "left" } } }]; } });
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((run) => run()));

describe("Academic ProseMirror commands", () => {
  it.each(["footnote", "endnote"] as const)("inserts a %s at the range end with an unused Word-compatible ID", (type) => {
    const element = document.createElement("div"); document.body.appendChild(element);
    const editor = new Editor({ element, extensions: [StarterKit, BlockAttrs, Footnote, Endnote, SpectraNotes], content: {
      type: "doc", content: [{ type: "paragraph", attrs: { blockId: "p" }, content: [
        { type: "text", text: "Keep this claim." },
        { type, attrs: { nativeNoteId: "1", text: "Existing note" } },
      ] }],
    } });
    cleanup.push(() => { editor.destroy(); element.remove(); });
    const entropy = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint32Array)[0] = 2_147_483_646;
      return array;
    });
    cleanup.push(() => entropy.mockRestore());
    editor.commands.setTextSelection({ from: 1, to: 5 });
    expect(type === "footnote" ? editor.commands.insertFootnote({ text: "New note" }) : editor.commands.insertEndnote({ text: "New note" })).toBe(true);
    const block = documentBlocksFromJson(editor.getJSON())[0]!;
    expect(block.text).toBe("Keep this claim.");
    const notes = block.inlineContent!.filter((item) => item.kind === "noteRef");
    expect(notes).toHaveLength(2);
    expect(new Set(notes.map((item) => item.noteId)).size).toBe(2);
    expect(notes.every((item) => Number(item.noteId) > 0 && Number(item.noteId) <= MAX_WORD_NOTE_ID)).toBe(true);
    expect(editor.commands.setNoteText("Edited new note")).toBe(true);
    expect(documentBlocksFromJson(editor.getJSON())[0]!.inlineContent).toContainEqual(expect.objectContaining({ kind: "noteRef", text: "Edited new note" }));
  });

  it("uses a fenced keyboard selection, preserves paragraph alignment, and undoes through collaboration", async () => {
    const ydoc = documentYjsAdapter.createDocument({ tiptap: { type: "doc", content: [{ type: "paragraph", attrs: { blockId: "p", textAlign: "center" }, content: [{ type: "text", text: "Bold words", marks: [{ type: "bold" }] }] }, { type: "paragraph", attrs: { blockId: "neighbor" }, content: [{ type: "text", text: "Neighbor" }] }] } });
    const element = document.createElement("div"); document.body.appendChild(element);
    const editor = new Editor({ element, extensions: [StarterKit.configure({ undoRedo: false }), BlockAttrs, Footnote, Endnote, SpectraNotes, WordRevision, WordCommentBoundary, SpectraCitationNode, Collaboration.configure({ document: ydoc, field: DOCUMENT_YJS_FRAGMENT })] });
    cleanup.push(() => { editor.destroy(); ydoc.destroy(); element.remove(); });
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.commands.setTextSelection({ from: 1, to: 5 });
    const anchor = academicSelection(editor);
    expect(anchor).toEqual({ regionId: "p", start: 0, end: 4, expectedText: "Bold words" });
    const initial = editor.getJSON();
    executeAcademicEditorOperations(editor, {}, [{ kind: "track-text", revisionId: "44", anchor, replacement: "Clear", provenance: { author: "Fixture" } }]);
    expect(editor.state.doc.firstChild!.attrs.textAlign).toBe("center");
    expect(documentBlocksFromJson(editor.getJSON())[0]!.text).toBe("Clear words");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(initial);
    expect(editor.commands.redo()).toBe(true);
    executeAcademicEditorOperations(editor, {}, [{ kind: "review-revision", regionId: "p", revisionId: "44", revisionKind: "del", expectedText: "Bold", decision: "reject" }, { kind: "review-revision", regionId: "p", revisionId: "44", revisionKind: "ins", expectedText: "Clear", decision: "reject" }]);
    expect(editor.state.doc.firstChild!.firstChild!.marks.some((mark) => mark.type.name === "bold")).toBe(true);
    expect(documentBlocksFromJson(editor.getJSON())[0]!.text).toBe("Bold words");
  });

  it("anchors imported comment and citation selections to their inline-visible text", async () => {
    const citationText = "Author. (2026). Supplied source";
    const ydoc = documentYjsAdapter.createDocument({ tiptap: { type: "doc", content: [
      { type: "paragraph", attrs: { blockId: "commented" }, content: [
        { type: "wordCommentBoundary", attrs: { native: { kind: "commentBoundary", commentId: "51", boundary: "start", comment: { author: "Fixture", text: "Existing comment" } } } },
        { type: "text", text: "A neighboring" },
        { type: "wordCommentBoundary", attrs: { native: { kind: "commentBoundary", commentId: "51", boundary: "end" } } },
        { type: "wordCommentBoundary", attrs: { native: { kind: "commentBoundary", commentId: "51", boundary: "reference" } } },
        { type: "text", text: " paragraph." },
      ] },
      { type: "paragraph", attrs: { blockId: "bibliography" }, content: [
        { type: "spectraCitation", attrs: { label: citationText, native: { kind: "bibliography", sources: [], text: citationText } } },
        { type: "text", text: " " },
      ] },
    ] } });
    const element = document.createElement("div"); document.body.appendChild(element);
    const editor = new Editor({ element, extensions: [StarterKit.configure({ undoRedo: false }), BlockAttrs, Footnote, Endnote, SpectraNotes, WordRevision, WordCommentBoundary, SpectraCitationNode, Collaboration.configure({ document: ydoc, field: DOCUMENT_YJS_FRAGMENT })] });
    cleanup.push(() => { editor.destroy(); ydoc.destroy(); element.remove(); });
    await new Promise((resolve) => setTimeout(resolve, 0));

    let commentStart = -1;
    editor.state.doc.descendants((node, pos) => { if (node.attrs.blockId === "commented") commentStart = pos + 1; });
    editor.commands.setTextSelection({ from: commentStart + 17, to: commentStart + 27 });
    const commentAnchor = academicSelection(editor);
    expect(commentAnchor).toEqual({ regionId: "commented", expectedText: "A neighboring paragraph.", start: 14, end: 24 });
    executeAcademicEditorOperations(editor, {}, [{ kind: "add-word-comment", commentId: "52", anchor: commentAnchor, comment: { author: "Fixture Operator", text: "Placed on the selected range." } }]);
    expect(documentBlocksFromJson(editor.getJSON())[0]!.text).toBe("A neighboring paragraph.");

    let citationPosition = -1;
    editor.state.doc.descendants((node, pos) => { if (node.attrs.blockId === "bibliography") citationPosition = pos + 1; });
    editor.commands.setTextSelection({ from: citationPosition, to: citationPosition + 1 });
    const citationAnchor = academicSelection(editor);
    expect(citationAnchor).toEqual({ regionId: "bibliography", expectedText: `${citationText} `, start: 0, end: citationText.length });
    executeAcademicEditorOperations(editor, {}, [{ kind: "add-word-comment", commentId: "53", anchor: citationAnchor, comment: { author: "Fixture Operator", text: "Citation placement check." } }]);
    expect(documentBlocksFromJson(editor.getJSON())[1]!.text).toBe(citationText);
  });
});
