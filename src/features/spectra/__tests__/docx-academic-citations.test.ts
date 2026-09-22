import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Document } from "@ariadng/office/docx";
import { unzipSync, strFromU8 } from "fflate";
import { docxLens } from "../lenses/docx-lens";
import { applyDocumentAcademicOperations } from "../commands/office/document-academic-operations";
import { docxProjectionFromContent } from "../lenses/document-projection";
import { documentYjsAdapter } from "../work/models/yjs/document-adapter";
import { createVerifiedSource, createEvidenceSpanAt } from "../sources/records/source-record";
import { verifyAcademicSourceHandles } from "../commands/office/document-academic-source-verification";
import { upsertWordSource } from "../lenses/docx-citations";
import { docxProjectionSemanticDigest } from "../lenses/docx-lens";
import type { DocumentAcademicOperation } from "../commands/office/document-academic-operations";

const source = { tag: "Research2026", sourceType: "Book" as const, title: "A supplied title", authors: [{ last: "Supplied Author" }], year: "2026" };

async function blank() {
  const document = Document.create(); document.addParagraph("An evidenced claim."); document.addParagraph("An independent neighbor.");
  return docxLens.open(await document.save());
}

async function shared(base: Awaited<ReturnType<typeof blank>>, operations: unknown) {
  const content = applyDocumentAcademicOperations(base.projection, operations);
  const desired = docxProjectionFromContent(content, base.projection);
  const output = await docxLens.materialize({ carry: base.preservedCarry, projection: desired.projection });
  return docxLens.open(output);
}

describe("Academic Word citation interoperability", () => {
  it("retains exact verified evidence handles and removes only the deleted citation mapping", async () => {
    const base = await blank(); const block = base.projection.blocks[0]!;
    const verified = createVerifiedSource({ title: "Fetched title", sourceType: "paper", authority: "primary", accessedAt: "2026-09-20T10:00:00Z", provider: "fixture", content: "exact supporting passage", url: "https://example.com/verified" });
    const span = createEvidenceSpanAt(verified, "exact supporting passage", 6, 16, 4);
    const content = { ...base.projection, sourceBundle: { sources: [verified], evidence: [span] } };
    const operation: DocumentAcademicOperation = { kind: "insert-word-citation", citationId: "verified-cite", source, sourceHandle: { sourceId: verified.id, evidenceIds: [span.id] }, anchor: { regionId: block.id, expectedText: block.text, start: 0, end: 0 } };
    expect(() => verifyAcademicSourceHandles(content, [operation])).not.toThrow();
    expect(() => verifyAcademicSourceHandles({ ...content, sourceBundle: { sources: [verified], evidence: [{ ...span, excerpt: "tampered passage" }] } }, [operation])).toThrow(/EVIDENCE/);
    const desired = docxProjectionFromContent(applyDocumentAcademicOperations(content, [operation]), base.projection).projection;
    const inserted = await docxLens.open(await docxLens.materialize({ carry: base.preservedCarry, projection: desired }));
    const cite = inserted.projection.blocks[0]!.inlineContent!.find((item) => item.kind === "citation")!;
    const { sourceId: _sourceId, ...passage } = span;
    expect(cite).toMatchObject({ source: { title: "Fetched title" }, sourceRef: { sourceId: verified.id, evidenceIds: [span.id], passages: [passage] } });
    const removed = await shared(inserted, [{ kind: "remove-word-citation", citationId: "verified-cite", expectedText: cite.text }]);
    expect(strFromU8(unzipSync(removed.preservedCarry.payload)["customXml/spectraAcademic.xml"]!)).not.toContain(span.id);
  });

  it("updates all uses of a source and generates bibliography semantics from used sources only", async () => {
    const document = Document.create(); document.addParagraph("First."); document.addParagraph("Second.");
    await upsertWordSource(document, { tag: "Unused", sourceType: "Misc", title: "Retained unused source" });
    const base = await docxLens.open(await document.save());
    const operations: DocumentAcademicOperation[] = base.projection.blocks.map((block, index) => ({ kind: "insert-word-citation", citationId: `cite-${index}`, source, pages: String(index + 1), anchor: { regionId: block.id, expectedText: block.text, start: 0, end: 0 } }));
    const inserted = await shared(base, [...operations, { kind: "regenerate-word-bibliography" }]);
    const first = inserted.projection.blocks[0]!.inlineContent!.find((item) => item.kind === "citation")!;
    const changes = [{ kind: "edit-word-citation", citationId: "cite-0", expectedText: first.text, source: { ...source, title: "New title" }, pages: "9" }];
    const desired = docxProjectionFromContent(applyDocumentAcademicOperations(inserted.projection, changes), inserted.projection).projection;
    const edited = await shared(inserted, changes);
    expect(await docxProjectionSemanticDigest(desired)).toBe(await docxProjectionSemanticDigest(edited.projection));
    const uses = edited.projection.blocks.flatMap((block) => block.inlineContent ?? []).filter((item) => item.kind === "citation");
    expect(uses.map((item) => item.source.title)).toEqual(["New title", "New title"]);
    expect(uses.map((item) => item.pages)).toEqual(["9", "2"]);
    const bibliography = edited.projection.blocks.flatMap((block) => block.inlineContent ?? []).find((item) => item.kind === "bibliography")!;
    expect(bibliography.sources.map((item) => item.tag)).toEqual([source.tag]);
    expect(edited.projection.nativeBinding.wordSources?.some((item) => item.tag === "Unused")).toBe(true);
  });
  it("imports the actual Word source, citation field and multi-paragraph bibliography without a no-op write", async () => {
    const payload = await readFile(join(process.cwd(), "fixtures/office/docx/bibliography-source.docx"));
    const opened = await docxLens.open(payload);
    const citation = opened.projection.blocks.flatMap((block) => block.inlineContent ?? []).find((item) => item.kind === "citation");
    expect(citation).toMatchObject({ source: { tag: "dd", title: "citation test book", year: "2008" }, text: "(Author1, 2008)" });
    expect(opened.projection.blocks.flatMap((block) => block.inlineContent ?? []).filter((item) => item.kind === "bibliography")).toHaveLength(1);
    const ydoc = documentYjsAdapter.createDocument(opened.projection);
    const update = docxProjectionFromContent(documentYjsAdapter.project(ydoc), opened.projection);
    expect(update.operations).toEqual([]);
    expect(await docxLens.materialize({ projection: update.projection, carry: opened.preservedCarry })).toEqual(payload);
    ydoc.destroy();
    if (citation?.kind !== "citation") throw new Error("Missing imported citation");
    const bibliography = opened.projection.blocks.find((block) => block.inlineContent?.some((item) => item.kind === "bibliography"))!;
    const operations = [{ kind: "edit-word-citation", citationId: citation.citationId, expectedText: citation.text, source: { ...citation.source, title: "Edited imported title" }, pages: "12" }, { kind: "regenerate-word-bibliography", regionId: bibliography.id, expectedText: bibliography.text }];
    const desired = docxProjectionFromContent(applyDocumentAcademicOperations(opened.projection, operations), opened.projection).projection;
    const edited = await shared(opened, operations);
    expect(await docxProjectionSemanticDigest(desired)).toBe(await docxProjectionSemanticDigest(edited.projection));
    expect(strFromU8(unzipSync(edited.preservedCarry.payload)["word/document.xml"]!)).toContain("\\l 2052");
  });

  it("inserts, edits and removes real citation fields and regenerates bibliography from used sources", async () => {
    const base = await blank(); const block = base.projection.blocks[0]!;
    const inserted = await shared(base, [{ kind: "insert-word-citation", citationId: "cite-1", source, pages: "12–14", anchor: { regionId: block.id, expectedText: block.text, start: block.text.length, end: block.text.length } }, { kind: "regenerate-word-bibliography" }]);
    const cite = inserted.projection.blocks[0]!.inlineContent?.find((item) => item.kind === "citation");
    expect(cite).toMatchObject({ citationId: "cite-1", source, pages: "12–14" });
    const packageParts = unzipSync(inserted.preservedCarry.payload);
    expect(strFromU8(packageParts["word/document.xml"]!)).toContain("CITATION");
    expect(Object.entries(packageParts).some(([path, bytes]) => path.startsWith("customXml/item") && strFromU8(bytes).includes("<b:Tag>Research2026</b:Tag>"))).toBe(true);
    const edited = await shared(inserted, [{ kind: "edit-word-citation", citationId: "cite-1", expectedText: cite!.text, source: { ...source, title: "Updated supplied title" }, pages: "15" }]);
    expect(edited.projection.nativeBinding.wordSources?.[0]?.title).toBe("Updated supplied title");
    const current = edited.projection.blocks[0]!.inlineContent!.find((item) => item.kind === "citation")!;
    const removed = await shared(edited, [{ kind: "remove-word-citation", citationId: "cite-1", expectedText: current.text }]);
    expect(removed.projection.blocks[0]!.text).toBe(block.text);
    const bibliography = removed.projection.blocks.find((block) => block.inlineContent?.some((item) => item.kind === "bibliography"))!;
    const regenerated = await shared(removed, [{ kind: "regenerate-word-bibliography", regionId: bibliography.id, expectedText: bibliography.text }]);
    expect(regenerated.projection.blocks.find((block) => block.id === bibliography.id)!.text).toBe("");
  });

  it("never treats supplied metadata or a URL as a verified source handle", async () => {
    const base = await blank(); const block = base.projection.blocks[0]!;
    expect(() => applyDocumentAcademicOperations(base.projection, [{ kind: "insert-word-citation", citationId: "citation", source, sourceHandle: { sourceId: "unfetched", evidenceIds: ["invented"] }, anchor: { regionId: block.id, expectedText: block.text, start: 0, end: 0 } }])).toThrow(/existing verified source/);
    const withoutDate = await shared(base, [{ kind: "insert-word-citation", citationId: "citation", source: { tag: "Unknown", sourceType: "Misc", title: "Only a title", url: "https://example.com/supplied" }, anchor: { regionId: block.id, expectedText: block.text, start: 0, end: 0 } }]);
    expect(withoutDate.projection.nativeBinding.wordSources?.[0]).not.toHaveProperty("year");
    expect(withoutDate.projection.nativeBinding.wordSources?.[0]).not.toHaveProperty("authors");
  });
});
