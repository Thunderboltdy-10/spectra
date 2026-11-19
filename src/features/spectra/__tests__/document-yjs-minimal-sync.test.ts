import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { yXmlFragmentToProsemirrorJSON } from "y-prosemirror";
import { DOCUMENT_YJS_FRAGMENT, documentYjsAdapter } from "../work/models/yjs/document-adapter";
import { workYjsOrigins } from "../work/models/yjs/origins";
import { mergeThreeWay } from "../lenses/three-way-merge";

const origin = workYjsOrigins({ clientId: "native", kind: "system" }).migration;
type J = { type: string; attrs?: Record<string, unknown>; content?: J[]; text?: string; marks?: Array<{ type: string; attrs?: Record<string, unknown> }> };
const p = (blockId: string, ...content: J[]): J => ({ type: "paragraph", attrs: { blockId }, content });
const t = (text: string, ...marks: string[]): J => ({ type: "text", text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });

function room(blocks: J[]) {
  const doc = documentYjsAdapter.createDocument({ tiptap: { type: "doc", content: blocks } });
  return { doc, fragment: doc.getXmlFragment(DOCUMENT_YJS_FRAGMENT) };
}

function apply(doc: Y.Doc, blocks: J[]) {
  const updates: Uint8Array[] = [];
  const listen = (update: Uint8Array) => updates.push(update);
  doc.on("update", listen);
  documentYjsAdapter.applyProjection(doc, { tiptap: { type: "doc", content: blocks } }, origin);
  doc.off("update", listen);
  return updates.reduce((total, update) => total + update.byteLength, 0);
}

const long = (n: number) => Array.from({ length: n }, (_, index) => p(`b${index}`, t(`Paragraph number ${index} with a sentence of ordinary length.`)));

describe("document projection applies the smallest Yjs edit", () => {
  it("writes nothing when the projection already matches the room", () => {
    const blocks = long(200);
    const { doc } = room(blocks);
    expect(apply(doc, blocks)).toBe(0);
    // Absent-valued attributes are not a change either.
    expect(apply(doc, blocks.map((block) => ({ ...block, attrs: { ...block.attrs, textAlign: null } })))).toBe(0);
  });

  it("edits one paragraph in place and leaves every other node and cursor alone", () => {
    const blocks = long(200);
    const { doc, fragment } = room(blocks);
    const before = fragment.toArray();
    const target = fragment.get(120) as Y.XmlElement;
    const text = target.get(0) as Y.XmlText;
    const cursor = Y.createRelativePositionFromTypeIndex(text, 10);
    const next = blocks.map((block, index) => index === 120 ? p("b120", t("Paragraph number 120, now "), t("rewritten", "bold"), t(" by Word.")) : block);
    const bytes = apply(doc, next);
    expect(bytes).toBeLessThan(200);
    expect(fragment.toArray().every((node, index) => node === before[index])).toBe(true);
    const absolute = Y.createAbsolutePositionFromRelativePosition(cursor, doc);
    expect(absolute?.type === text && absolute.index).toBe(10);
    expect((yXmlFragmentToProsemirrorJSON(fragment) as J).content?.[120]).toEqual({
      type: "paragraph", attrs: { blockId: "b120" },
      content: [t("Paragraph number 120, now "), { ...t("rewritten"), marks: [{ type: "bold", attrs: {} }] }, t(" by Word.")],
    });
  });

  it("inserts, deletes and moves blocks without rewriting their neighbours", () => {
    const blocks = long(50);
    const { doc, fragment } = room(blocks);
    const keep = fragment.get(10);
    const next = [...blocks.slice(0, 5), p("new", t("Inserted")), ...blocks.slice(6)];
    next.push({ type: "heading", attrs: { blockId: "h", level: 2 }, content: [t("Appendix")] });
    expect(apply(doc, next)).toBeLessThan(300);
    expect(fragment.get(10)).toBe(keep);
    expect(yXmlFragmentToProsemirrorJSON(fragment)).toEqual({ type: "doc", content: next });
  });

  it("replaces a node whose type changed and keeps surrogate pairs whole", () => {
    const { doc, fragment } = room([p("a", t("Smile 😀 here")), p("b", t("Body"))]);
    apply(doc, [{ type: "heading", attrs: { blockId: "a", level: 1 }, content: [t("Smile 😃 here")] }, p("b", t("Body"))]);
    expect(yXmlFragmentToProsemirrorJSON(fragment)).toEqual({ type: "doc", content: [
      { type: "heading", attrs: { blockId: "a", level: 1 }, content: [t("Smile 😃 here")] }, p("b", t("Body")),
    ] });
    apply(doc, [{ type: "heading", attrs: { blockId: "a", level: 1 }, content: [t("Smile 😀 here")] }, p("b", t("Body"))]);
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    expect(JSON.stringify(yXmlFragmentToProsemirrorJSON(peer.getXmlFragment(DOCUMENT_YJS_FRAGMENT)))).toContain("Smile 😀 here");
  });

  it("formats existing text without retyping it and clears formatting it no longer has", () => {
    const { doc, fragment } = room([p("a", t("one two three"))]);
    apply(doc, [p("a", t("one "), t("two", "italic"), t(" three"))]);
    apply(doc, [p("a", t("one two three"))]);
    expect(yXmlFragmentToProsemirrorJSON(fragment)).toEqual({ type: "doc", content: [p("a", t("one two three"))] });
  });
});

describe("three-way merge equality", () => {
  it("does not treat absent-valued fields as edits", () => {
    const base = [{ id: "a", text: "x", attrs: { styleId: "Normal" } }];
    const ours = [{ id: "a", text: "x", attrs: { styleId: "Normal", nativePath: undefined, alignment: null } }];
    const theirs = [{ id: "a", text: "y", attrs: { styleId: "Normal" } }];
    const merged = mergeThreeWay({ base, ours, theirs, id: (value) => value.id });
    expect(merged.conflicts).toEqual([]);
    expect(merged.value[0]?.text).toBe("y");
  });
});
