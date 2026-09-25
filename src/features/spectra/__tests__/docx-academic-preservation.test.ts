import { describe, expect, it } from "vitest";
import { Document, WML_NAMESPACE } from "@ariadng/office/docx";
import { parseXml, serializeNode } from "@ariadng/office/xml";
import { strFromU8, unzipSync } from "fflate";
import { citationMappings, collectWordSources, upsertWordSource, writeCitationMapping } from "../lenses/docx-citations";
import { nativeNote, noteContent, storyText, wordElements, writeStoryContent } from "../lenses/docx-academic";
import { appendRevision, reviewRevision, supportedRevision, upsertNativeComment } from "../lenses/docx-academic-review";
import { docxLens, docxProjectionReadbackDigest, docxProjectionSemanticDigest } from "../lenses/docx-lens";
import { applyDocumentAcademicOperations } from "../commands/office/document-academic-operations";
import { docxProjectionFromContent } from "../lenses/document-projection";
import type { WordCitationInline } from "../lenses/docx-citation-schema";

const META = "urn:spectra:academic:v1";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const ref = { sourceId: "source:one", evidenceIds: [], passages: [] };
const citation: WordCitationInline = { kind: "citation", citationId: "one", text: "A citation", source: { tag: "Source", sourceType: "Book", title: "Title" }, sourceRef: ref };

function mapping(document: Document, name: string, body: string) {
  document.office.package.addPart(name, "application/xml", new TextEncoder().encode(`<m:academic xmlns:m="${META}" xmlns:v="urn:vendor" v:root="kept">${body}</m:academic>`));
  document.office.mainPart.relationships().add({ id: `rIdMapping${document.office.package.parts().length}`, type: `${REL}customXml`, target: `..${name}` });
}

describe("DOCX academic identity and native properties", () => {
  it.each(["0", "false", "off"])("materializes explicit %s note toggles as on without losing native property attributes", async (off) => {
    const document = Document.create(); document.addParagraph("Claim"); document.addParagraph("Neighbor");
    const empty = await docxLens.open(await document.save());
    const block = empty.projection.blocks[0]!;
    const bytes = await docxLens.mutate(empty.preservedCarry, { kind: "insert-note", noteType: "footnote", noteId: "1", content: [[{ text: "Evidence" }]], anchor: { regionId: block.id, expectedText: block.text, start: 0, end: 0 } });
    const native = await Document.open(bytes);
    const note = (await nativeNote(native, "footnote", "1"))!;
    const run = wordElements(note.note).find((node) => node.localName === "r" && node.find(WML_NAMESPACE, "t"))!;
    run.insertBefore(parseXml(`<w:rPr xmlns:w="${WML_NAMESPACE}" xmlns:v="urn:vendor"><w:b w:val="${off}" v:stamp="bold"/><w:i w:val="${off}" v:stamp="italic"/><w:u w:val="none" w:color="FF0000" w:themeColor="accent1" v:stamp="underline"/></w:rPr>`).root, run.children[0] ?? null);
    native.office.markDirty(note.partName);
    const base = await docxLens.open(await native.save());
    expect(base.projection.nativeBinding.wordNotes?.[0]?.readOnlyReason).toBeUndefined();
    expect(base.projection.nativeBinding.wordNotes?.[0]?.content).toEqual([[{ text: "Evidence" }]]);
    const desired = docxProjectionFromContent(applyDocumentAcademicOperations(base.projection, [{ kind: "edit-note", noteType: "footnote", noteId: "1", expectedText: "Evidence", content: [[{ text: "Evidence", bold: true, italic: true, underline: true }]] }]), base.projection).projection;
    const output = await docxLens.materialize({ carry: base.preservedCarry, projection: desired });
    const reopened = await docxLens.open(output);
    expect(reopened.projection.nativeBinding.wordNotes?.[0]?.content).toEqual([[{ text: "Evidence", bold: true, italic: true, underline: true }]]);
    expect(await docxProjectionReadbackDigest(reopened.projection, desired)).toBe(await docxProjectionSemanticDigest(desired));
    const xml = strFromU8(unzipSync(output)["word/footnotes.xml"]!);
    for (const value of ['w:b w:val="1"', 'w:i w:val="1"', 'w:u w:val="single"', 'w:color="FF0000"', 'w:themeColor="accent1"', 'v:stamp="bold"', 'v:stamp="italic"', 'v:stamp="underline"']) expect(xml).toContain(value);

    const textOnly = docxProjectionFromContent(applyDocumentAcademicOperations(base.projection, [{ kind: "edit-note", noteType: "footnote", noteId: "1", expectedText: "Evidence", content: [[{ text: "Changed evidence" }]] }]), base.projection).projection;
    const edited = await docxLens.materialize({ carry: base.preservedCarry, projection: textOnly });
    const editedXml = strFromU8(unzipSync(edited)["word/footnotes.xml"]!);
    expect(editedXml).toContain(`w:b w:val="${off}"`);
    expect(editedXml).toContain('w:u w:val="none"');
    expect(editedXml).toContain('w:color="FF0000"');
  });

  it("materializes off-to-on revision formatting while retaining underline color and native attributes", async () => {
    const document = Document.create();
    document.addParagraph("").element.appendChild(parseXml(`<w:ins xmlns:w="${WML_NAMESPACE}" xmlns:v="urn:vendor" w:id="8" w:author="Author"><w:r><w:rPr><w:b w:val="0" v:stamp="bold"/><w:i w:val="false"/><w:u w:val="none" w:color="FF0000"/></w:rPr><w:t>Reviewed</w:t></w:r></w:ins>`).root);
    document.addParagraph("Neighbor");
    const base = await docxLens.open(await document.save());
    expect(base.projection.blocks[0]?.attrs?.nativeReadOnly).toBeUndefined();
    const desired = { ...base.projection, blocks: base.projection.blocks.map((block) => ({ ...block, inlineContent: block.inlineContent?.map((inline) => inline.kind === "revision" ? { ...inline, content: [{ text: inline.text, bold: true, italic: true, underline: true }] } : inline) })) };
    const output = await docxLens.materialize({ carry: base.preservedCarry, projection: desired });
    const reopened = await docxLens.open(output);
    const revision = reopened.projection.blocks[0]?.inlineContent?.find((item) => item.kind === "revision");
    expect(revision).toMatchObject({ content: [{ text: "Reviewed", bold: true, italic: true, underline: true }] });
    expect(await docxProjectionReadbackDigest(reopened.projection, desired)).toBe(await docxProjectionSemanticDigest(desired));
    const xml = strFromU8(unzipSync(output)["word/document.xml"]!);
    expect(xml).toContain('w:color="FF0000"');
    expect(xml).toContain('v:stamp="bold"');
  });

  it("preserves source field and author extensions when known source values change", async () => {
    const document = Document.create(); document.addParagraph("Neighbor");
    const bib = "http://schemas.openxmlformats.org/officeDocument/2006/bibliography";
    document.office.package.addPart("/customXml/sources.xml", "application/xml", new TextEncoder().encode(`<x:Sources xmlns:x="${bib}" xmlns:v="urn:vendor"><x:Source v:stamp="source"><x:Tag>Source</x:Tag><x:SourceType>Book</x:SourceType><x:Title v:stamp="title">Title<v:opaque>keep</v:opaque></x:Title><x:Author><x:Author v:stamp="author"><x:NameList><x:Person v:stamp="person"><x:Last v:stamp="last">Old</x:Last><v:opaque>person extension</v:opaque></x:Person></x:NameList><v:opaque>author extension</v:opaque></x:Author></x:Author></x:Source></x:Sources>`));
    document.office.mainPart.relationships().add({ type: `${REL}customXml`, target: "../customXml/sources.xml" });
    const source = (await collectWordSources(document))[0]!;
    await upsertWordSource(document, { ...source, title: "New title", year: "2026", authors: [{ last: "New" }] });
    const output = strFromU8(unzipSync(await document.save())["customXml/sources.xml"]!);
    for (const kept of ['v:stamp="source"', 'v:stamp="title"', 'v:stamp="author"', 'v:stamp="person"', 'v:stamp="last"', "person extension", "author extension", "<v:opaque>keep</v:opaque>"]) expect(output).toContain(kept);
    expect((await collectWordSources(document))[0]).toMatchObject({ title: "New title", year: "2026", authors: [{ last: "New" }] });
  });
  it("updates a relocated mapping in place and retains relationships, unknown siblings, attributes and children", async () => {
    const document = Document.create(); document.addParagraph("Neighbor");
    mapping(document, "/customXml/item99.xml", `<v:opaque id="one">vendor text</v:opaque><m:citation id="one" v:stamp="kept">${JSON.stringify(ref)}<v:details>opaque child</v:details></m:citation><m:citation id="two">${JSON.stringify({ ...ref, sourceId: "source:two" })}</m:citation>`);
    const before = await document.save();
    expect((await citationMappings(document)).get("one")).toEqual(ref);
    await writeCitationMapping(document, { ...citation, sourceRef: { ...ref, sourceId: "source:changed" } });
    const bytes = await document.save();
    const entries = unzipSync(bytes);
    const xml = strFromU8(entries["customXml/item99.xml"]!);
    expect(entries["customXml/spectraAcademic.xml"]).toBeUndefined();
    expect(xml).toContain('v:stamp="kept"');
    expect(xml).toContain('<v:details>opaque child</v:details>');
    expect(xml).toContain('<v:opaque id="one">vendor text</v:opaque>');
    expect(entries["word/_rels/document.xml.rels"]).toEqual(unzipSync(before)["word/_rels/document.xml.rels"]);
    expect((await citationMappings(await Document.open(bytes))).get("one")?.sourceId).toBe("source:changed");
    const opened = await docxLens.open(bytes);
    expect(opened.fidelityMap.entries).toContainEqual(expect.objectContaining({ feature: "academic-content", class: "NATIVE", partName: "/customXml/item99.xml" }));
  });

  it("omits duplicate mapping identities on read and rejects only writes targeting them", async () => {
    const document = Document.create(); document.addParagraph("Still readable");
    mapping(document, "/customXml/first.xml", `<m:citation id="one">${JSON.stringify(ref)}</m:citation>`);
    mapping(document, "/customXml/second.xml", `<m:citation id="one">${JSON.stringify({ ...ref, sourceId: "wrong" })}</m:citation><m:citation id="two">${JSON.stringify(ref)}</m:citation>`);
    expect((await citationMappings(document)).has("one")).toBe(false);
    await expect(writeCitationMapping(document, citation)).rejects.toThrow(/AMBIGUOUS/);
    await expect(writeCitationMapping(document, { ...citation, sourceRef: undefined })).rejects.toThrow(/AMBIGUOUS/);
    await writeCitationMapping(document, { ...citation, citationId: "two", sourceRef: { ...ref, sourceId: "changed" } });
    expect((await citationMappings(document)).get("two")?.sourceId).toBe("changed");
    expect((await docxLens.open(await document.save())).projection.blocks[0]?.text).toBe("Still readable");
  });

  it("does not adopt an unrelated or unlinked part at the historic filename", async () => {
    const document = Document.create(); document.addParagraph("Neighbor");
    const original = new TextEncoder().encode('<vendor xmlns="urn:vendor">unchanged</vendor>');
    document.office.package.addPart("/customXml/spectraAcademic.xml", "application/xml", original);
    await writeCitationMapping(document, citation);
    const entries = unzipSync(await document.save());
    expect(entries["customXml/spectraAcademic.xml"]).toEqual(original);
    expect((await citationMappings(document)).get("one")).toEqual(ref);
  });

  it("carries an unrecognized mapping payload instead of deleting it when the projection has no source reference", async () => {
    const document = Document.create(); document.addParagraph("Neighbor");
    mapping(document, "/customXml/future.xml", '<m:citation id="one" v:version="future">{"futureFormat":true}<v:opaque>keep</v:opaque></m:citation>');
    const before = unzipSync(await document.save())["customXml/future.xml"];
    expect((await citationMappings(document)).has("one")).toBe(false);
    await writeCitationMapping(document, { ...citation, sourceRef: undefined });
    expect(unzipSync(await document.save())["customXml/future.xml"]).toEqual(before);
    await expect(writeCitationMapping(document, citation)).rejects.toThrow(/unmodeled payload/);
  });

  it("updates CDATA mapping text once while retaining its native representation and opaque child", async () => {
    const document = Document.create(); document.addParagraph("Neighbor");
    mapping(document, "/customXml/cdata.xml", `<m:citation id="one"><![CDATA[${JSON.stringify(ref)}]]><v:opaque>keep</v:opaque></m:citation>`);
    await writeCitationMapping(document, { ...citation, sourceRef: { ...ref, sourceId: "changed" } });
    const output = await document.save();
    const xml = strFromU8(unzipSync(output)["customXml/cdata.xml"]!);
    expect(xml).toContain('<![CDATA[{"sourceId":"changed"');
    expect(xml).toContain("<v:opaque>keep</v:opaque>");
    expect((await citationMappings(await Document.open(output))).get("one")?.sourceId).toBe("changed");
  });

  it("preserves rich native run boundaries through merged runs and text edits, and honors explicit underline removal", () => {
    const note = parseXml(`<w:footnote xmlns:w="${WML_NAMESPACE}" xmlns:v="urn:vendor" w:id="1"><w:p v:id="paragraph"><w:pPr><w:pStyle w:val="FootnoteText" v:style="kept"/></w:pPr><w:r v:id="marker"><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r v:id="red"><w:rPr><w:u w:val="single" w:color="FF0000"/></w:rPr><w:t v:text="kept">Red</w:t></w:r><w:r v:id="blue"><w:rPr><w:u w:val="single" w:color="0000FF"/></w:rPr><w:t> blue</w:t></w:r></w:p></w:footnote>`).root;
    expect(noteContent(note)).toBeDefined();
    writeStoryContent(note, [[{ text: "Red blue!", underline: true }]], "footnote");
    expect(storyText(note)).toBe("Red blue!");
    let xml = serializeNode(note);
    for (const kept of ['v:id="paragraph"', 'v:style="kept"', 'v:id="marker"', 'v:text="kept"', 'w:color="FF0000"', 'w:color="0000FF"']) expect(xml).toContain(kept);
    expect(wordElements(note).filter((node) => node.localName === "footnoteRef")).toHaveLength(1);
    writeStoryContent(note, [[{ text: "Red blue!", underline: false }]], "footnote");
    xml = serializeNode(note);
    expect(xml).not.toContain("<w:u");
    expect(xml).toContain('v:text="kept"');
  });

  it("retains classic comment run styles, marker and paragraph attributes during a text edit", async () => {
    const document = Document.create(); document.addParagraph("Neighbor");
    const xml = parseXml(`<w:comments xmlns:w="${WML_NAMESPACE}" xmlns:v="urn:vendor"><w:comment w:id="4" w:author="Author"><w:p v:stamp="keep"><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r><w:r><w:rPr><w:u w:val="single" w:color="FF0000"/></w:rPr><w:t>Original</w:t></w:r></w:p></w:comment></w:comments>`);
    const added = document._internal().addXmlPart("/word/comments.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml", `${REL}comments`, xml);
    document._internal().markDirty(added.pd);
    await upsertNativeComment(document, "4", { author: "Author", text: "Edited" });
    const output = strFromU8(unzipSync(await document.save())["word/comments.xml"]!);
    for (const kept of ["Edited", 'v:stamp="keep"', "CommentReference", "annotationRef", 'w:color="FF0000"']) expect(output).toContain(kept);
  });

  it("retains revision wrapper/run/text attributes on edit and deletion rejection", () => {
    const paragraph = parseXml(`<w:p xmlns:w="${WML_NAMESPACE}" xmlns:v="urn:vendor"><w:del w:id="8" w:author="Author" v:stamp="kept"><w:r v:run="kept"><w:rPr><w:u w:val="single" w:color="FF0000"/></w:rPr><w:delText v:text="kept">Original</w:delText></w:r></w:del></w:p>`).root;
    const retained = paragraph.elements()[0]!;
    const revision = supportedRevision(retained)!;
    appendRevision(paragraph, { ...revision, text: "Edited", content: [{ text: "Edited", underline: true }] }, retained);
    paragraph.removeChild(retained);
    const edited = paragraph.elements()[0]!;
    expect(serializeNode(edited)).toContain('v:stamp="kept"');
    reviewRevision(edited, "reject");
    const output = serializeNode(paragraph);
    for (const kept of ['v:run="kept"', 'v:text="kept"', 'w:color="FF0000"', "Edited"]) expect(output).toContain(kept);
    expect(output).not.toContain("delText");
  });
});
