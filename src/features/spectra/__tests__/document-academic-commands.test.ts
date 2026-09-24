import { describe, expect, it } from "vitest";
import { Document } from "@ariadng/office/docx";
import { docxLens, docxProjectionReadbackDigest, docxProjectionSemanticDigest } from "../lenses/docx-lens";
import { applyDocumentAcademicOperations, documentAcademicEffectsLanded, documentAcademicOperationsLanded, type DocumentAcademicOperation } from "../commands/office/document-academic-operations";
import { documentYjsAdapter, workTransactionOrigin, type WorkActorIdentity } from "../work/models/yjs";
import { docxProjectionFromContent } from "../lenses/document-projection";
import { editNoteText } from "../editor/note-text-edit";
import { parseModelOperation } from "../operations/schema";
import { evaluatePlanPolicy } from "../operations/policy";
import { authoredSemanticValue } from "../../../../shared/document-projection.mjs";
import { exportDocxCopy } from "../lenses/docx-adapter";
import { documentContentToProseMirrorJson } from "../lenses/document-projection";

const actor: WorkActorIdentity = { clientId: "academic-human", kind: "human", accountId: "fixture", name: "Fixture" };

describe("Academic canonical commands", () => {
  it("creates a bibliography without reusing an ordinary cloud paragraph identity", () => {
    const original = { id: "bibliography", type: "paragraph", text: "A paragraph whose identity must survive." };
    const desired = applyDocumentAcademicOperations({ blocks: [original] }, [{ kind: "regenerate-word-bibliography" }]);
    expect(desired.blocks[0]).toEqual(original);
    expect(desired.blocks).toHaveLength(2);
    expect(new Set(desired.blocks.map((block) => block.id)).size).toBe(2);
    const ydoc = documentYjsAdapter.createDocument(desired);
    expect(documentYjsAdapter.project(ydoc).blocks).toHaveLength(2);
    ydoc.destroy();
  });

  it("commits a combined edit plus bibliography, preserves its neighbor, and undoes the complete operation", async () => {
    const document = Document.create(); document.addParagraph("A supported claim."); document.addParagraph("Untouched neighbor.");
    const base = await docxLens.open(await document.save());
    const block = base.projection.blocks[0]!;
    const anchor = { regionId: block.id, expectedText: block.text, start: 1, end: 1 };
    const operations: DocumentAcademicOperation[] = [
      { kind: "insert-note", noteId: "15", noteType: "footnote", anchor, content: [[{ text: "Rich source", bold: true }]] },
      { kind: "add-word-comment", commentId: "21", anchor: { ...anchor, start: 2, end: 11 }, comment: { author: "Fixture", text: "Check this wording." } },
      { kind: "insert-word-citation", citationId: "cite-1", anchor: { ...anchor, start: block.text.length, end: block.text.length }, source: { tag: "Known", sourceType: "Misc", title: "Supplied title" } },
      { kind: "regenerate-word-bibliography" },
    ];
    const ydoc = documentYjsAdapter.createDocument(base.projection);
    const fragment = documentYjsAdapter.bind(ydoc, null, actor).sharedTypes[0] as { get: (index: number) => unknown };
    const neighbor = fragment.get(1);
    const undo = documentYjsAdapter.createUndoManager(ydoc, actor);
    const desired = applyDocumentAcademicOperations(documentYjsAdapter.project(ydoc), operations);
    documentYjsAdapter.applyProjection(ydoc, desired, workTransactionOrigin(actor, "local_human"));
    const canonical = documentYjsAdapter.project(ydoc);
    expect(documentAcademicOperationsLanded(canonical, operations)).toBe(true);
    expect(documentAcademicEffectsLanded(base.projection, desired, canonical)).toBe(true);
    expect(documentAcademicEffectsLanded(base.projection, desired, base.projection)).toBe(false);
    expect(fragment.get(1)).toBe(neighbor);
    const projected = docxProjectionFromContent(canonical, base.projection).projection;
    const native = await docxLens.open(await docxLens.materialize({ carry: base.preservedCarry, projection: projected }));
    // Existing paragraphs keep their exact authored semantics. Newly inserted
    // paragraphs may expose inherited Word defaults absent from canonical data.
    expect(authoredSemanticValue(projected.blocks.slice(0, 2))).toEqual(authoredSemanticValue(native.projection.blocks.slice(0, 2)));
    expect(await docxProjectionSemanticDigest(projected)).toBe(await docxProjectionReadbackDigest(native.projection, projected));
    const lostNote = structuredClone(native.projection);
    lostNote.blocks[0]!.inlineContent = lostNote.blocks[0]!.inlineContent!.filter((item) => item.kind !== "noteRef");
    expect(await docxProjectionReadbackDigest(lostNote, projected)).not.toBe(await docxProjectionSemanticDigest(projected));
    const lostFormatting = structuredClone(native.projection);
    const note = lostFormatting.blocks[0]!.inlineContent!.find((item) => item.kind === "noteRef");
    if (note?.kind === "noteRef") note.content = [[{ text: "Rich source" }]];
    expect(await docxProjectionReadbackDigest(lostFormatting, projected)).not.toBe(await docxProjectionSemanticDigest(projected));
    undo.undo();
    expect(docxProjectionFromContent(documentYjsAdapter.project(ydoc), base.projection).operations).toEqual([]);
    undo.redo();
    expect(documentAcademicOperationsLanded(documentYjsAdapter.project(ydoc), operations)).toBe(true);
    undo.destroy(); ydoc.destroy();
  });

  it("exports unmounted academic commands through the same native field and note writers", async () => {
    const source = { blocks: [{ id: "p", type: "paragraph", text: "A claim." }] };
    const anchor = { regionId: "p", expectedText: "A claim.", start: 0, end: 1 };
    const desired = applyDocumentAcademicOperations(source, [
      { kind: "insert-note", noteType: "endnote", noteId: "46", anchor, content: [[{ text: "Native endnote" }]] },
      { kind: "add-word-comment", commentId: "47", anchor, comment: { author: "Fixture", text: "Native annotation" } },
      { kind: "insert-word-citation", citationId: "c48", anchor: { ...anchor, start: 8, end: 8 }, source: { tag: "S49", sourceType: "Misc", title: "Supplied title" } },
      { kind: "regenerate-word-bibliography" },
    ]);
    const copy = await exportDocxCopy(documentContentToProseMirrorJson(desired));
    expect(copy.conversion.notes.some((note) => note.level === "unsupported")).toBe(false);
    const opened = await docxLens.open(copy.bytes);
    expect(opened.projection.nativeBinding.wordNotes).toMatchObject([{ id: "46", text: "Native endnote" }]);
    expect(opened.projection.nativeBinding.wordComments).toMatchObject([{ id: "47", author: "Fixture", text: "Native annotation" }]);
    expect(opened.projection.nativeBinding.wordSources).toMatchObject([{ tag: "S49", title: "Supplied title" }]);
  });

  it("retains note formatting through edits and Unicode paragraph boundaries", () => {
    expect(editNoteText("Bold plain", "Bold bright plain", [[{ text: "Bold", bold: true }, { text: " plain" }]])).toEqual([[{ text: "Bold", bold: true }, { text: " bright plain" }]]);
    expect(editNoteText("α 😀", "α 😀\nnext", [[{ text: "α 😀", italic: true }]])).toEqual([[{ text: "α 😀", italic: true }], [{ text: "next", italic: true }]]);
  });

  it("routes typed document operations through the existing AI schema and fences bulk review", () => {
    const input = { artifactId: "fixture", blueprintKey: "document", title: null, summary: null, content: null, tags: null, documentOperations: [{ kind: "review-revision", regionId: "p", revisionId: "1", revisionKind: "ins", expectedText: "new", decision: "accept" }] };
    const single = parseModelOperation({ type: "artifact.update", input });
    expect(evaluatePlanPolicy([single]).requiresConfirmation).toBe(false);
    const bulk = parseModelOperation({ type: "artifact.update", input: { ...input, documentOperations: [...input.documentOperations, { ...input.documentOperations[0], revisionId: "2" }] } });
    expect(evaluatePlanPolicy([bulk]).requiresConfirmation).toBe(true);
    expect(evaluatePlanPolicy([single, single]).requiresConfirmation).toBe(true);
    expect(() => parseModelOperation({ type: "artifact.update", input: { ...input, blueprintKey: "sheets" } })).toThrow(/document target/);
    expect(() => parseModelOperation({ type: "artifact.update", input: { ...input, contentPatch: { changes: [{ path: "/title", value: "bypass" }] } } })).toThrow(/cannot be combined/);
  });
});
