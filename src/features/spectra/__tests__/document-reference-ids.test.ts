import { Fragment, Schema, Slice, type Node } from "@tiptap/pm/model";
import { expect, it, vi } from "vitest";
import { documentReferenceIds, type ReferenceNode } from "../components/document-reference-ids";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
    spectraReference: { group: "inline", inline: true, atom: true, attrs: { embedId: { default: null } } },
  },
});

const paragraph = (...content: Node[]) => schema.node("paragraph", null, content);
const reference = (embedId: string | null) => schema.node("spectraReference", { embedId });

it("finds every reference embed, at any depth, once", () => {
  const doc = schema.node("doc", null, [
    paragraph(schema.text("See "), reference("embed_a")),
    paragraph(reference("embed_b"), reference(null), reference("embed_a")),
  ]);
  expect(documentReferenceIds(doc as unknown as ReferenceNode)).toEqual(new Set(["embed_a", "embed_b"]));
});

it("walks only what an edit replaced", () => {
  const paragraphs = Array.from({ length: 50 }, (_, index) =>
    paragraph(schema.text(`Paragraph ${index}`), ...(index === 7 ? [reference("embed_seven")] : [])),
  );
  const before = schema.node("doc", null, paragraphs);
  documentReferenceIds(before as unknown as ReferenceNode);

  // Typing in the last paragraph: ProseMirror keeps the other 49 as the same objects.
  const end = before.content.size - 1;
  const after = before.replace(end, end, new Slice(Fragment.from(schema.text("!")), 0, 0));
  expect(after.child(7)).toBe(before.child(7));
  const walked = vi.spyOn(Object.getPrototypeOf(after) as Node, "forEach");
  expect(documentReferenceIds(after as unknown as ReferenceNode)).toEqual(new Set(["embed_seven"]));
  // The document and the edited paragraph (and its text); a fresh walk would open all 50 paragraphs.
  expect(walked.mock.calls.length).toBeLessThan(5);
  walked.mockRestore();
});
