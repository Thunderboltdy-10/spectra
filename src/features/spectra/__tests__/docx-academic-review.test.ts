import { describe, expect, it } from "vitest";
import { Document } from "@ariadng/office/docx";
import { docxLens } from "../lenses/docx-lens";
import { applyDocumentAcademicOperations } from "../commands/office/document-academic-operations";
import { docxProjectionFromContent } from "../lenses/document-projection";
import { documentYjsAdapter } from "../work/models/yjs/document-adapter";
import { parseXml } from "@ariadng/office/xml";
import { WML_NAMESPACE } from "@ariadng/office/docx";

async function blank() {
  const document = Document.create();
  document.addParagraph("Evidence supports this claim.");
  document.addParagraph("The neighbor remains editable.");
  return docxLens.open(await document.save());
}

async function shared(base: Awaited<ReturnType<typeof blank>>, operations: unknown) {
  const desired = applyDocumentAcademicOperations(base.projection, operations);
  const update = docxProjectionFromContent(desired, base.projection);
  const bytes = await docxLens.materialize({ carry: base.preservedCarry, projection: update.projection });
  return docxLens.open(bytes);
}

describe("Shared academic review operations", () => {
  it("recognizes modern comment extensions by relationship and keeps disjoint text editable", async () => {
    const base = await blank(); const block = base.projection.blocks[0]!;
    const classic = await shared(base, [{ kind: "add-word-comment", commentId: "91", anchor: { regionId: block.id, expectedText: block.text, start: 0, end: 8 }, comment: { author: "Fixture", text: "Modern thread" } }]);
    const document = await Document.open(classic.preservedCarry.payload);
    document.office.package.addPart("/word/vendorThreadState.xml", "application/vnd.ms-word.commentsExtended+xml", new TextEncoder().encode('<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"/>'));
    document.office.mainPart.relationships().add({ type: "http://schemas.microsoft.com/office/2011/relationships/commentsExtended", target: "vendorThreadState.xml" });
    const modern = await docxLens.open(await document.save());
    expect(modern.projection.nativeBinding.wordComments?.[0]?.readOnlyReason).toMatch(/modern/);
    await expect(shared(modern, [{ kind: "edit-word-comment", commentId: "91", expectedText: "Modern thread", text: "Changed" }])).rejects.toThrow(/modern/);
    const neighbor = modern.projection.blocks[1]!;
    const result = await shared(modern, [{ kind: "insert-note", noteId: "92", noteType: "footnote", content: [[{ text: "Neighbor note" }]], anchor: { regionId: neighbor.id, expectedText: neighbor.text, start: 0, end: 0 } }]);
    expect(result.projection.nativeBinding.wordComments).toEqual(modern.projection.nativeBinding.wordComments);
  });
  it("keeps bold and italic native revision runs when rejecting a deletion", async () => {
    const document = Document.create();
    const paragraph = document.addParagraph("Before ");
    paragraph.element.appendChild(parseXml(`<w:del xmlns:w="${WML_NAMESPACE}" w:id="88" w:author="Native Author"><w:r><w:rPr><w:b/></w:rPr><w:delText>bold</w:delText></w:r><w:r><w:rPr><w:i/></w:rPr><w:delText> italic</w:delText></w:r></w:del>`).root);
    document.addParagraph("Neighbor");
    const base = await docxLens.open(await document.save());
    const result = await shared(base, [{ kind: "review-revision", regionId: base.projection.blocks[0]!.id, revisionId: "88", revisionKind: "del", expectedText: "bold italic", decision: "reject" }]);
    const runs = result.projection.blocks[0]!.inlineContent;
    expect(runs).toEqual(expect.arrayContaining([expect.objectContaining({ text: "bold", format: expect.objectContaining({ bold: true }) }), expect.objectContaining({ text: " italic", format: expect.objectContaining({ italic: true }) })]));
  });

  it("keeps an unsupported native revision exact during a disjoint paragraph edit", async () => {
    const document = Document.create();
    const paragraph = document.addParagraph("");
    paragraph.element.appendChild(parseXml(`<w:ins xmlns:w="${WML_NAMESPACE}" w:id="89" w:author="Native Author"><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>colored revision</w:t></w:r></w:ins>`).root);
    document.addParagraph("Neighbor");
    const base = await docxLens.open(await document.save());
    expect(base.projection.blocks[0]!.attrs?.nativeReadOnly).toBe(true);
    const neighbor = base.projection.blocks[1]!;
    const result = await shared(base, [{ kind: "insert-note", noteType: "endnote", noteId: "90", content: [[{ text: "Disjoint note" }]], anchor: { regionId: neighbor.id, expectedText: neighbor.text, start: 1, end: 1 } }]);
    expect(result.projection.blocks[0]).toEqual(base.projection.blocks[0]);
  });
  it("creates, reads, edits and deletes an anchored native comment without changing the text", async () => {
    const base = await blank();
    const block = base.projection.blocks[0]!;
    const anchor = { regionId: block.id, expectedText: block.text, start: 9, end: 17 };
    const opened = await shared(base, [{ kind: "add-word-comment", commentId: "51", anchor, comment: { author: "Fixture Author", initials: "FA", text: "Check the supporting passage.", date: "2026-09-20T10:00:00Z" } }]);
    expect(opened.projection.blocks[0]!.text).toBe(block.text);
    expect(opened.projection.nativeBinding.wordComments).toMatchObject([{ id: "51", author: "Fixture Author", text: "Check the supporting passage." }]);
    expect(opened.projection.blocks[0]!.attrs?.nativeReadOnly).toBeUndefined();
    const inline = opened.projection.blocks[0]!.inlineContent!;
    const start = inline.findIndex((item) => item.kind === "commentBoundary" && item.boundary === "start");
    const end = inline.findIndex((item) => item.kind === "commentBoundary" && item.boundary === "end");
    expect(inline.slice(start + 1, end).map((item) => item.kind === "text" ? item.text : "").join("")).toBe("supports");
    const ydoc = documentYjsAdapter.createDocument(opened.projection);
    expect(docxProjectionFromContent(documentYjsAdapter.project(ydoc), opened.projection).operations).toEqual([]);
    ydoc.destroy();
    const edited = await shared(opened, [{ kind: "edit-word-comment", commentId: "51", expectedText: "Check the supporting passage.", text: "The passage confirms this." }]);
    expect(edited.projection.nativeBinding.wordComments?.[0]?.text).toBe("The passage confirms this.");
    const deleted = await shared(edited, [{ kind: "delete-word-comment", commentId: "51", expectedText: "The passage confirms this." }]);
    expect(deleted.projection.nativeBinding.wordComments ?? []).toEqual([]);
    expect(deleted.projection.blocks.map((block) => block.text)).toEqual(base.projection.blocks.map((block) => block.text));
  });

  it.each(["accept", "reject"] as const)("authors and individually %ss insertion/deletion revisions", async (decision) => {
    const base = await blank();
    const block = base.projection.blocks[0]!;
    const opened = await shared(base, [{ kind: "track-text", revisionId: "71", anchor: { regionId: block.id, expectedText: block.text, start: 9, end: 17 }, replacement: "qualifies", provenance: { author: "Fixture Reviewer", date: "2026-09-20T10:00:00Z" } }]);
    expect(opened.projection.blocks[0]!.text).toBe("Evidence qualifies this claim.");
    const marks = opened.projection.blocks[0]!.inlineContent?.filter((item) => item.kind === "revision");
    expect(marks).toMatchObject([{ revisionKind: "del", text: "supports", author: "Fixture Reviewer" }, { revisionKind: "ins", text: "qualifies" }]);
    const ydoc = documentYjsAdapter.createDocument(opened.projection);
    expect(docxProjectionFromContent(documentYjsAdapter.project(ydoc), opened.projection).operations).toEqual([]);
    ydoc.destroy();
    const reviewed = await shared(opened, [
      { kind: "review-revision", regionId: block.id, revisionId: "71", revisionKind: "del", expectedText: "supports", decision },
      { kind: "review-revision", regionId: block.id, revisionId: "71", revisionKind: "ins", expectedText: "qualifies", decision },
    ]);
    expect(reviewed.projection.blocks[0]!.text).toBe(decision === "accept" ? "Evidence qualifies this claim." : block.text);
    expect(reviewed.projection.nativeBinding.wordRevisions ?? []).toEqual([]);
    expect(reviewed.projection.blocks[1]!.text).toBe(base.projection.blocks[1]!.text);
  });

  it("fails atomically for stale review and anchor state", async () => {
    const base = await blank();
    const before = JSON.stringify(base.projection);
    expect(() => applyDocumentAcademicOperations(base.projection, [{ kind: "add-word-comment", commentId: "5", anchor: { regionId: base.projection.blocks[0]!.id, expectedText: "wrong", start: 0, end: 1 }, comment: { author: "Fixture", text: "comment" } }])).toThrow(/changed/);
    expect(JSON.stringify(base.projection)).toBe(before);
  });
});
