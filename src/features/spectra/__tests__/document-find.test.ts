import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { documentSchemaExtensions } from "../editor/document-extensions";
import { findInEditor, replaceMatches, replacementFor } from "../editor/document-find";

const schema = getSchema(documentSchemaExtensions());
const stateOf = (content: unknown[]) => EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content }) });
const paragraph = (content: unknown[], attrs: Record<string, unknown> = {}) => ({ type: "paragraph", attrs, content });
const text = (value: string, marks?: string[]) => ({ type: "text", text: value, ...(marks ? { marks: marks.map((type) => ({ type })) } : {}) });

describe("find and replace in a document", () => {
  it("finds a word split across formatting, and keeps its look when replaced", () => {
    const state = stateOf([paragraph([text("The "), text("pho", ["bold"]), text("ton", ["bold", "italic"]), text(" moves.")])]);
    const matches = findInEditor(state.doc, "photon");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.text).toBe("photon");
    const transaction = state.tr;
    expect(replaceMatches(transaction, matches, () => "electron")).toBe(1);
    const run = transaction.doc.firstChild!.child(1);
    expect(run.text).toBe("electron");
    expect(run.marks.map((mark) => mark.type.name)).toEqual(["bold"]);
    expect(transaction.doc.textContent).toBe("The electron moves.");
  });

  it("never matches across a paragraph or an inline object", () => {
    const state = stateOf([paragraph([text("ends in a")]), paragraph([text("b starts")])]);
    expect(findInEditor(state.doc, "ab")).toHaveLength(0);
    expect(findInEditor(state.doc, "a\\s*b", { regex: true })).toHaveLength(0);
  });

  it("uses a pattern's groups in the replacement, and takes plain text as written", () => {
    expect(replacementFor("2026-11-20", String.raw`(\d+)-(\d+)-(\d+)`, "$3/$2/$1", { regex: true })).toBe("20/11/2026");
    expect(replacementFor("cost", "cost", "$5")).toBe("$5");
  });

  it("leaves matches in parts Word keeps as they are, and replaces the rest", () => {
    const state = stateOf([paragraph([text("keep this")], { blockId: "locked" }), paragraph([text("change this")])]);
    const matches = findInEditor(state.doc, "this", {}, (node) => node.attrs.blockId === "locked");
    expect(matches.map((match) => match.readOnly)).toEqual([true, false]);
    const transaction = state.tr;
    expect(replaceMatches(transaction, matches, () => "that")).toBe(1);
    expect(transaction.doc.textContent).toBe("keep thischange that");
  });

  it("finds text inside table cells", () => {
    const state = stateOf([{ type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [paragraph([text("Mass (g)")])] }] }] }]);
    expect(findInEditor(state.doc, "mass")).toHaveLength(1);
  });
});
