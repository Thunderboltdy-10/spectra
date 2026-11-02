// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor, Extension, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { workTransactionOrigin } from "../work/models/yjs/origins";
import { applyDocumentStudioProjection } from "../editor/document-studio-projection";
import { documentYjsAdapter, DOCUMENT_YJS_FRAGMENT } from "../work/models/yjs/document-adapter";

const BlockAttrs = Extension.create({ name: "projectionBlockAttrs", addGlobalAttributes() {
  return [{ types: ["paragraph"], attributes: { blockId: { default: null } } }];
} });
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach((run) => run()));
const paragraph = (id: string, text: string): JSONContent => ({ type: "paragraph", attrs: { blockId: id }, content: [{ type: "text", text, marks: [{ type: "bold" }] }] });
const before = { type: "doc", content: [paragraph("saved", "Previously saved sentence.")] };
const after = { type: "doc", content: [...before.content, paragraph("appended", "One new final paragraph.")] };
async function fixture() {
  const room = documentYjsAdapter.createDocument({ tiptap: before });
  cleanup.push(() => room.destroy());
  const writer = new Y.Doc();
  Y.applyUpdate(writer, Y.encodeStateAsUpdate(room));
  cleanup.push(() => writer.destroy());
  const baseline = Y.encodeStateVector(writer);
  documentYjsAdapter.applyProjection(writer, { tiptap: after }, workTransactionOrigin({ clientId: "writer", kind: "ai", accountId: "account", name: "Spectra" }, "ai_semantic_edit"));
  const admitted = Y.encodeStateAsUpdate(writer, baseline);
  const element = document.createElement("div"); document.body.appendChild(element);
  const editor = new Editor({ element, extensions: [StarterKit.configure({ undoRedo: false }), BlockAttrs, Collaboration.configure({ document: room, field: DOCUMENT_YJS_FRAGMENT })] });
  cleanup.push(() => { editor.destroy(); element.remove(); });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { room, editor, admitted };
}

describe("Document studio projection ownership", () => {
  it.each([false, true])("never authors an AI preview into a collaborative tree (native=%s)", async (_native) => {
    const { room, editor, admitted } = await fixture();
    const state = Y.encodeStateVector(room);
    applyDocumentStudioProjection(editor, after, { collaborative: true });
    expect(Y.encodeStateVector(room)).toEqual(state);
    expect(editor.getJSON().content).toHaveLength(1);
    Y.applyUpdate(room, admitted);
    expect(editor.getJSON().content).toHaveLength(2);
    const restored = new Y.Doc(); cleanup.push(() => restored.destroy());
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(room));
    const projected = documentYjsAdapter.project(restored);
    expect(projected.blocks).toHaveLength(2);
    expect(projected.blocks!.map((block) => block.text)).toEqual(["Previously saved sentence.", "One new final paragraph."]);
  });
  it("waits for the admitted delta when an ordinary canonical projection arrives first", async () => {
    const { room, editor, admitted } = await fixture();
    applyDocumentStudioProjection(editor, after, { collaborative: true });
    Y.applyUpdate(room, admitted);
    expect(editor.getJSON().content).toHaveLength(2);
    expect(editor.getJSON().content?.map((node) => node.attrs?.blockId)).toEqual(["saved", "appended"]);
  });
  it("never appends a stale Word projection's paragraphs after a native save (FLOW-011)", async () => {
    const { editor } = await fixture();
    // Word re-serialised the file: the room holds new ids, the record lags.
    const stale = { type: "doc", content: [paragraph("old-1", "One."), paragraph("old-2", "Two."), paragraph("old-3", "Three.")] };
    expect(applyDocumentStudioProjection(editor, stale, { collaborative: true })).toBe(0);
    expect(editor.getJSON().content?.map((node) => node.attrs?.blockId)).toEqual(["saved"]);
  });
});
