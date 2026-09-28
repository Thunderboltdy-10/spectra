import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { DOCUMENT_YJS_FRAGMENT, documentYjsAdapter } from "../work/models/yjs/document-adapter";
import { applyDocumentParagraphTextSplice } from "../work/models/yjs/document-adapter";
import { workYjsOrigins } from "../work/models/yjs/origins";
import { planNativeArtifactYjsMutation, readNativeArtifactYjsDocument } from "../work/models/yjs/native-artifact-model";
import { initializeNativeArtifactDocument } from "../../../../scripts/collaboration-native-projection.mjs";
import type { ArtifactLiveValue } from "../collaboration/artifact-yjs-model";

const human = { clientId: "human", kind: "human" as const };
const ai = workYjsOrigins({ clientId: "ai", kind: "ai", runId: "run", operationId: "splice" }).ai;
const change = { blockId: "p1", expectedText: "Hello world", index: 6, deleteCount: 0, insertText: "bright " };

function fixture(otherText = "Another paragraph") {
  const doc = documentYjsAdapter.createDocument({ blocks: [
    { id: "p1", type: "paragraph", text: "Hello world" },
    { id: "p2", type: "paragraph", text: otherText },
  ] });
  const fragment = doc.getXmlFragment(DOCUMENT_YJS_FRAGMENT);
  const paragraph = fragment.get(0) as Y.XmlElement;
  const text = paragraph.get(0) as Y.XmlText;
  return { doc, fragment, paragraph, text };
}

describe("S11 single-operation plain paragraph splice", () => {
  it("retains paragraph/text identity, relative selection and unrelated nodes in one transaction", () => {
    const { doc, fragment, paragraph, text } = fixture();
    const other = fragment.get(1);
    const anchor = Y.createRelativePositionFromTypeIndex(text, 6);
    const head = Y.createRelativePositionFromTypeIndex(text, 11);
    const updates = vi.fn();
    doc.on("update", updates);
    expect(applyDocumentParagraphTextSplice(doc, change, ai)).toMatchObject({ afterText: "Hello bright world", changed: true });
    expect(fragment.get(0)).toBe(paragraph);
    expect(paragraph.get(0)).toBe(text);
    expect(fragment.get(1)).toBe(other);
    expect(Y.createAbsolutePositionFromRelativePosition(anchor, doc)).toMatchObject({ type: text, index: 13 });
    expect(Y.createAbsolutePositionFromRelativePosition(head, doc)).toMatchObject({ type: text, index: 18 });
    expect(updates).toHaveBeenCalledTimes(1);
    expect(updates.mock.calls[0]![1]).toBe(ai);
    doc.destroy();
  });

  it("changes only a scratch clone until its exact delta is admitted", () => {
    const { doc, text } = fixture();
    const scratch = new Y.Doc();
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
    const base = Y.encodeStateVector(doc);
    applyDocumentParagraphTextSplice(scratch, change, ai);
    expect(text.toString()).toBe("Hello world");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(scratch, base), ai);
    expect(text.toString()).toBe("Hello bright world");
    scratch.destroy(); doc.destroy();
  });

  it("rejects a stale paragraph without overwriting the human edit", () => {
    const { doc, text } = fixture();
    text.insert(0, "Human ");
    const updates = vi.fn(); doc.on("update", updates);
    expect(() => applyDocumentParagraphTextSplice(doc, change, ai)).toThrow("DOCUMENT_TEXT_SPLICE_STALE");
    expect(text.toString()).toBe("Human Hello world");
    expect(updates).not.toHaveBeenCalled();
    doc.destroy();
  });

  it("preserves the human undo boundary", () => {
    const { doc, text } = fixture();
    const undo = documentYjsAdapter.createUndoManager(doc, human);
    applyDocumentParagraphTextSplice(doc, change, ai);
    expect(undo.undoStack).toHaveLength(0);
    doc.transact(() => text.insert(text.length, "!"), workYjsOrigins(human).localHuman);
    undo.undo();
    expect(text.toString()).toBe("Hello bright world");
    undo.destroy(); doc.destroy();
  });

  it.each(["marks", "reference", "duplicate"])("rejects %s instead of flattening canonical structure", (kind) => {
    const { doc, fragment, paragraph, text } = fixture();
    if (kind === "marks") text.format(0, 5, { strong: {} });
    if (kind === "reference") paragraph.push([new Y.XmlElement("spectraReference")]);
    if (kind === "duplicate") {
      const copy = new Y.XmlElement("paragraph"); copy.setAttribute("blockId", "p1"); fragment.push([copy]);
    }
    const before = Y.encodeStateAsUpdate(doc);
    expect(() => applyDocumentParagraphTextSplice(doc, change, ai)).toThrow(/DOCUMENT_TEXT_SPLICE_(UNSUPPORTED|TARGET)/);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    doc.destroy();
  });

  it("handles empty paragraphs and no-op replacements without replacing the block", () => {
    const { doc, paragraph, text } = fixture();
    expect(applyDocumentParagraphTextSplice(doc, { ...change, index: 0, deleteCount: 11, insertText: "Hello world" }, ai).changed).toBe(false);
    paragraph.delete(0, 1);
    applyDocumentParagraphTextSplice(doc, { ...change, expectedText: "", index: 0, insertText: "New" }, ai);
    expect(paragraph.get(0)).not.toBe(text);
    expect((paragraph.get(0) as Y.XmlText).toString()).toBe("New");
    expect(doc.getXmlFragment(DOCUMENT_YJS_FRAGMENT).get(0)).toBe(paragraph);
    doc.destroy();
  });

  it("rejects an offset inside a surrogate pair", () => {
    const { doc, text } = fixture();
    text.delete(0, text.length); text.insert(0, "A😀B");
    expect(() => applyDocumentParagraphTextSplice(doc, { ...change, expectedText: "A😀B", index: 2 }, ai)).toThrow("DOCUMENT_TEXT_SPLICE_INVALID");
    expect(text.toString()).toBe("A😀B");
    doc.destroy();
  });

  it("keeps authored update bytes small when an unrelated paragraph grows to one million characters", () => {
    const sizes = [20, 1_000_000].map((size) => {
      const { doc } = fixture("x".repeat(size));
      let bytes = 0;
      doc.on("update", (update: Uint8Array) => { bytes += update.byteLength; });
      applyDocumentParagraphTextSplice(doc, change, ai);
      doc.destroy();
      return bytes;
    });
    console.info("S11 synthetic paragraph splice update bytes", { unrelatedCharacters: [20, 1_000_000], updateBytes: sizes });
    expect(sizes.every(size => size > 0 && size < 128)).toBe(true);
    expect(Math.abs(sizes[1]! - sizes[0]!)).toBeLessThan(16);
  });
});

describe("AI paragraph edits through the live planner (the splice's real caller)", () => {
  const aiActor = { clientId: "ai", kind: "ai" as const, runId: "run", operationId: "edit" };
  function live(first: string) {
    const doc = new Y.Doc();
    initializeNativeArtifactDocument(doc, { typeKey: "document", schemaVersion: 4, title: "Work", tags: [],
      content: { blocks: [{ id: "p1", type: "paragraph", text: first }, { id: "p2", type: "paragraph", text: "Other" }] } });
    const current = readNativeArtifactYjsDocument(doc, "document")!;
    return { doc, current, fragment: doc.getXmlFragment(DOCUMENT_YJS_FRAGMENT) };
  }
  function edit(doc: Y.Doc, current: ArtifactLiveValue, text: string) {
    const blocks = (current.content as { blocks: Array<Record<string, unknown>> }).blocks
      .map((block) => block.id === "p1" ? { ...block, text } : block);
    const plan = planNativeArtifactYjsMutation(doc, "document", { ...current, content: { ...(current.content as Record<string, unknown>), blocks } }, aiActor);
    const vector = Y.encodeStateVector(doc);
    doc.transact(plan.apply, workYjsOrigins(aiActor).ai);
    return Y.encodeStateAsUpdate(doc, vector);
  }

  it("splices the existing paragraph text so a collaborator's caret and the node identity survive", () => {
    const { doc, current, fragment } = live("Hello world");
    const paragraph = fragment.get(0) as Y.XmlElement;
    const text = paragraph.get(0) as Y.XmlText;
    const caret = Y.createRelativePositionFromTypeIndex(text, 8);
    edit(doc, current, "Hello bright world");
    expect(fragment.get(0)).toBe(paragraph);
    expect(paragraph.get(0)).toBe(text);
    expect(text.toString()).toBe("Hello bright world");
    expect(Y.createAbsolutePositionFromRelativePosition(caret, doc)).toMatchObject({ type: text, index: 15 });
    doc.destroy();
  });

  it("admits an append whose bytes do not grow with the paragraph it extends", () => {
    const sizes = [20, 100_000].map((size) => {
      const { doc, current } = live("x".repeat(size));
      const bytes = edit(doc, current, `${"x".repeat(size)} appended`).byteLength;
      doc.destroy();
      return bytes;
    });
    expect(sizes[1]! - sizes[0]!).toBeLessThan(16);
  });

  it("never splits a surrogate pair when two emoji share their high half", () => {
    const { doc, current, fragment } = live("A\u{1F600}B");
    edit(doc, current, "A\u{1F601}B");
    expect(((fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText).toString()).toBe("A\u{1F601}B");
    doc.destroy();
  });

  it("keeps formatted paragraphs on the lossless node path", () => {
    const { doc, fragment } = live("Hello world");
    ((fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText).format(0, 5, { bold: {} });
    const formatted = readNativeArtifactYjsDocument(doc, "document")!;
    edit(doc, formatted, "Hello brave world");
    expect(readNativeArtifactYjsDocument(doc, "document")!.content).toMatchObject({ blocks: [{ id: "p1" }, { id: "p2", text: "Other" }] });
    expect(fragment.toString()).toContain("brave");
    doc.destroy();
  });
});
