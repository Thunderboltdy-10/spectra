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

vi.mock("../components/artifact-embed-host", () => ({ ArtifactEmbedById: () => null }));
const BlockAttrs = Extension.create({ name: "testBlockAttrs", addGlobalAttributes() { return [{ types: ["paragraph"], attributes: { blockId: { default: null }, textAlign: { default: "left" } } }]; } });
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((run) => run()));

describe("Academic ProseMirror commands", () => {
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
});
