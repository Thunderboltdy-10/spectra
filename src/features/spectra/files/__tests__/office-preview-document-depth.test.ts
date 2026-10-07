import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Document, WML_NAMESPACE } from "@ariadng/office/docx";
import { parseXml } from "@ariadng/office/xml";
import { parseOfficePreview, type DocumentPreview } from "../office-preview";
import type { RichBlock, RichInline } from "../../rich-content/ast";

const fixture = (name: string) => readFile(join(process.cwd(), "fixtures", "office", "docx", name)).then((buffer) => new Uint8Array(buffer));

async function documentPreview(bytes: Uint8Array) {
  const preview = await parseOfficePreview("document", bytes);
  if (preview.kind !== "document") throw new Error("expected a document");
  return preview;
}

/** Every inline in the document, nested ones included. */
function inlines(preview: DocumentPreview) {
  const found: RichInline[] = [];
  const visit = (content: readonly RichInline[]) => {
    for (const inline of content) {
      found.push(inline);
      if (inline.type === "link" || inline.type === "revision" || inline.type === "comment") visit(inline.content);
    }
  };
  const block = (entry: RichBlock) => {
    if (entry.type === "paragraph" || entry.type === "heading" || entry.type === "footnote" || entry.type === "source_note") visit(entry.content);
    if (entry.type === "table") entry.rows.forEach((row) => row.forEach(visit));
    if (entry.type === "list") entry.items.forEach((item) => item.blocks.forEach(block));
    if (entry.type === "quote" || entry.type === "callout") entry.blocks.forEach(block);
  };
  preview.ast.blocks.forEach(block);
  return found;
}

describe("Word depth in the viewer", () => {
  it("shows insertions and deletions with who made them", async () => {
    const document = Document.create();
    const paragraph = document.addParagraph("The enzyme ");
    paragraph.element.appendChild(
      parseXml(`<w:ins xmlns:w="${WML_NAMESPACE}" w:id="11" w:author="Ada" w:date="2026-03-01T09:00:00Z"><w:r><w:t xml:space="preserve">quickly </w:t></w:r></w:ins>`).root,
    );
    paragraph.element.appendChild(
      parseXml(`<w:del xmlns:w="${WML_NAMESPACE}" w:id="12" w:author="Ada"><w:r><w:delText xml:space="preserve">slowly </w:delText></w:r></w:del>`).root,
    );
    document.addParagraph("Neighbour paragraph.");
    const preview = await documentPreview(await document.save());
    const revisions = inlines(preview).filter((inline) => inline.type === "revision");
    expect(revisions).toEqual([
      { type: "revision", kind: "insert", author: "Ada", date: "2026-03-01T09:00:00Z", content: [{ type: "text", text: "quickly " }] },
      { type: "revision", kind: "delete", author: "Ada", content: [{ type: "text", text: "slowly " }] },
    ]);
  });

  it("reads Word's own review file: deletions in text and tables, its comment, notes, and what it can't draw", async () => {
    const preview = await documentPreview(await fixture("tracked-changes.docx"));
    const all = inlines(preview);
    const deleted = all.flatMap((inline) => (inline.type === "revision" && inline.kind === "delete" ? [inline.content.map((run) => (run.type === "text" ? run.text : "")).join("")] : []));
    expect(deleted).toEqual(expect.arrayContaining([" in the embed code for the video you want to add", "100", "200", "300"]));
    expect(preview.comments).toEqual([
      { id: "1", label: "1", author: "Eric White", initials: "EW", date: "2014-10-28T20:22:00Z", text: "This is a comment." },
    ]);
    const commented = all.find((inline) => inline.type === "comment");
    expect(commented).toMatchObject({ ids: ["1"] });
    expect(all.filter((inline) => inline.type === "comment_ref")).toEqual([{ type: "comment_ref", id: "1", label: "1" }]);
    // Word's highlighter survives as a wash behind the run.
    expect(all.some((inline) => inline.type === "text" && inline.style?.highlight === "yellow")).toBe(true);
    // Notes follow the text, after a rule.
    const footnotes = preview.ast.blocks.filter((block) => block.type === "footnote");
    expect(footnotes.map((block) => block.type === "footnote" && block.footnoteId)).toEqual(["1", "i"]);
    expect(preview.unshown).toEqual(expect.arrayContaining(["SmartArt", "embedded objects", "text boxes", "pictures in formats a browser can't draw"]));
    expect(preview.media).toHaveLength(1);
  });

  it("numbers footnotes and endnotes as Word does", async () => {
    const preview = await documentPreview(await fixture("footnotes-endnotes.docx"));
    expect(inlines(preview).filter((inline) => inline.type === "footnote_ref").map((inline) => inline.type === "footnote_ref" && inline.id)).toEqual(["1", "i", "2", "ii"]);
    const notes = preview.ast.blocks.slice(-4);
    expect(notes.map((block) => (block.type === "footnote" ? [block.footnoteId, block.content.map((run) => (run.type === "text" ? run.text : "")).join("")] : null))).toEqual([
      ["1", "This is the test footnote 1."],
      ["2", "This is the test footnote 2."],
      ["i", "This is the test end notes 1"],
      ["ii", "This is the test end notes 2"],
    ]);
    expect(preview.ast.blocks.at(-5)?.type).toBe("rule");
    expect(preview.comments).toEqual([]);
    expect(preview.unshown).toEqual([]);
  });

  it("carries the page's header and footer text", async () => {
    const preview = await documentPreview(await fixture("complex-structure.docx"));
    expect(preview.footer).toBe("\n\t1 \tMicrosoft Confidential\t");
    expect(preview.header).toBeUndefined();
    expect(structuredClone(preview)).toEqual(preview);
  });
});
