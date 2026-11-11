import { describe, expect, it } from "vitest";
import { mergeFallbackDocumentEdit } from "../document-fallback-merge";

const para = (blockId: string, text: string, attrs: Record<string, unknown> = {}) => ({
  type: "paragraph",
  attrs: { blockId, ...attrs },
  content: [{ type: "text", text }],
});
const doc = (...content: ReturnType<typeof para>[]) => ({ type: "doc", content });
const texts = (json: { content?: Array<{ content?: Array<{ text?: string }> }> }) =>
  (json.content ?? []).map((node) => node.content?.[0]?.text);

describe("merging an edit made away from the room", () => {
  it("writes nothing when the editor only normalised what it was given", () => {
    const seed = doc(para("a", "one"));
    const draft = doc(para("a", "one", { blockStyle: null, firstLineIndent: null }));
    const live = doc(para("a", "one"), para("b", "the AI wrote this"));
    const merged = mergeFallbackDocumentEdit({ seed, draft, live });
    expect(merged.changed).toBe(false);
    expect(merged.json).toBe(live);
  });

  it("does not count rebuilt nested ids as an edit", () => {
    const list = (id: string) => ({
      type: "bulletList",
      attrs: { blockId: "l" },
      content: [{ type: "listItem", attrs: { blockId: id }, content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }],
    });
    const merged = mergeFallbackDocumentEdit({
      seed: { type: "doc", content: [list("old")] },
      draft: { type: "doc", content: [list("new")] },
      live: { type: "doc", content: [list("old")] },
    });
    expect(merged.changed).toBe(false);
  });

  it("keeps what the room gained while changing only what was typed", () => {
    const merged = mergeFallbackDocumentEdit({
      seed: doc(para("a", "one"), para("b", "two")),
      draft: doc(para("a", "one typed"), para("b", "two")),
      live: doc(para("a", "one"), para("b", "two"), para("c", "the AI wrote this")),
    });
    expect(texts(merged.json)).toEqual(["one typed", "two", "the AI wrote this"]);
  });

  it("places a new block after the one it followed", () => {
    const merged = mergeFallbackDocumentEdit({
      seed: doc(para("a", "one"), para("b", "two")),
      draft: doc(para("a", "one"), para("n", "new"), para("b", "two")),
      live: doc(para("a", "rewritten by the AI"), para("b", "two")),
    });
    expect(texts(merged.json)).toEqual(["rewritten by the AI", "new", "two"]);
  });

  it("removes only what was removed here", () => {
    const merged = mergeFallbackDocumentEdit({
      seed: doc(para("a", "one"), para("b", "two")),
      draft: doc(para("b", "two")),
      live: doc(para("a", "one"), para("b", "two"), para("c", "three")),
    });
    expect(texts(merged.json)).toEqual(["two", "three"]);
  });

  it("never drops typed words when their neighbour is gone from the room", () => {
    const merged = mergeFallbackDocumentEdit({
      seed: doc(para("a", "one")),
      draft: doc(para("a", "one edited"), para("n", "new")),
      live: doc(para("z", "only this")),
    });
    expect(texts(merged.json)).toEqual(["only this", "new", "one edited"]);
  });
});
