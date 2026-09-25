import { describe, expect, it } from "vitest";
import { buildAttachmentEvidence } from "../ai/attachment-evidence";
import { prepareContentEvidence, prepareContentPatchEvidence } from "../ai/source-evidence-content";
import { prepareOperationForQuality } from "@/app/api/spectra/run/loop/plan";
import { parseModelOperation } from "../operations/schema";
import { documentContentToProseMirrorJson, documentBlocksFromJson } from "../lenses/document-projection";
import { normalizePresentationContent, producePresentationContent } from "../presentation/model";
import { exportDocxCopy } from "../lenses/docx-adapter";
import { docxLens } from "../lenses/docx-lens";

const bundle = buildAttachmentEvidence([{ id: "source", name: "Cooling study.pdf", mimeType: "application/pdf", size: 150,
  handling: "pdf", extractedText: "An unrelated introduction.\n\nInsulation slows the temperature decrease.",
  sourceMap: [{ kind: "page", label: "Page 1", startOffset: 0, endOffset: 25 }, { kind: "page", label: "Page 3", startOffset: 27, endOffset: 68 }],
}])!;
const span = bundle.evidence.find((entry) => entry.page === 3)!;
const document = { blocks: [{ id: "claim", type: "paragraph", text: "The insulated cup cools more slowly.", sourceRefs: [span.id] }], outline: [] };

describe("server-owned artifact evidence", () => {
  it("materializes the exact selected page as an editable native Word citation", async () => {
    const content = prepareContentEvidence("document", document, bundle);
    const parsed = parseModelOperation({ type: "artifact.create", input: { blueprintKey: "document", title: "Cooling", summary: null, content, tags: [], placement: "inbox", workspaceId: null } });
    expect(parsed.type).toBe("artifact.create");
    const json = documentContentToProseMirrorJson(content as Record<string, unknown>);
    const cited = documentBlocksFromJson(json)[0]!.inlineContent!.find((entry) => entry.kind === "citation");
    expect(cited).toMatchObject({ kind: "citation", pages: "3", source: { title: "Cooling study.pdf" }, sourceRef: { evidenceIds: [span.id], passages: [{ id: span.id, page: 3, excerpt: span.excerpt }] } });
    const native = await exportDocxCopy(json);
    const reopened = await docxLens.open(native.bytes);
    expect(reopened.projection.blocks.flatMap((block) => block.inlineContent ?? []).filter((entry) => entry.kind === "citation")).toMatchObject([{ source: { title: "Cooling study.pdf" }, pages: "3", sourceRef: { sourceId: span.sourceId, evidenceIds: [span.id], passages: [{ id: span.id, page: 3, excerpt: span.excerpt }] } }]);
  });

  it("does not select the first passage when only a source is named", () => {
    const result = prepareContentEvidence("document", { blocks: [{ ...document.blocks[0], sourceRefs: [bundle.sources[0]!.id] }] }, bundle) as typeof document;
    expect(result.blocks[0]).not.toHaveProperty("inlineContent");
  });

  it("rejects invented handles and tampered evidence instead of verifying model claims", () => {
    expect(() => prepareContentEvidence("document", { blocks: [{ ...document.blocks[0], sourceRefs: ["evidence:invented"] }] }, bundle)).toThrow("NOT_ISSUED");
    expect(() => prepareContentEvidence("document", { ...document, sources: [{ id: "invented", verified: true }] }, bundle)).toThrow("NOT_ISSUED");
    expect(() => prepareContentEvidence("document", document, { ...bundle, evidence: bundle.evidence.map((entry) => entry.id === span.id ? { ...entry, excerpt: "A changed claim" } : entry) })).toThrow("CITATION_EVIDENCE_MISMATCH");
  });

  it("does not duplicate citations when content is normalized or staged again", () => {
    const input = { blocks: [...document.blocks, { id: "table", type: "table", text: "Minutes | Temperature\n0 | 80\n20 | 37", sourceRefs: [span.id] }] };
    const first = prepareContentEvidence("document", input, bundle);
    expect(prepareContentEvidence("document", first, bundle)).toEqual(first);
  });

  it("refreshes the selected passage and plain claim in the native export, including table attribution", async () => {
    const first = prepareContentEvidence("document", { blocks: [...document.blocks,
      { id: "table", type: "table", text: "Minutes | Temperature\n0 | 80", sourceRefs: [span.id] }],
    }, bundle) as { blocks: Array<Record<string, unknown>> };
    const replacement = bundle.evidence[0]!;
    const changed = { ...first, blocks: first.blocks.map((block) => block.id === "claim" || block.id === "table"
      ? { ...block, ...(block.id === "claim" ? { text: "Revised introduction." } : {}), sourceRefs: [replacement.id] } : block) };
    const updated = prepareContentEvidence("document", changed, bundle) as typeof first;
    expect(prepareContentEvidence("document", updated, bundle)).toEqual(updated);
    const native = await exportDocxCopy(documentContentToProseMirrorJson(updated));
    const reopened = await docxLens.open(native.bytes);
    const citations = reopened.projection.blocks.flatMap((block) => block.inlineContent ?? []).filter((entry) => entry.kind === "citation");
    expect(citations).toHaveLength(2);
    expect(citations.every((entry) => entry.sourceRef?.evidenceIds.join() === replacement.id && entry.pages === "1")).toBe(true);
    expect(reopened.projection.blocks[0]!.text).toContain("Revised introduction.");
    expect(reopened.projection.blocks[0]!.text).not.toContain("insulated cup");
  });

  it("preserves slide evidence through normalization and collaborative updates", () => {
    const sourceRefs = [span.id];
    const deck = normalizePresentationContent(prepareContentEvidence("presentation", { theme: { id: "plain" }, slides: [{ id: "s1", title: "Cooling", sourceRefs, objects: [] }] }, bundle));
    expect(deck.slides[0]).toMatchObject({ sourceRefs, citations: [{ label: "Cooling study.pdf, p. 3", sourceRefs }] });
    const edited = producePresentationContent(deck, (draft) => { draft.slides[0]!.sourceRefs = [bundle.evidence[0]!.id]; });
    expect(edited.slides[0]!.sourceRefs).toEqual([bundle.evidence[0]!.id]);
  });

  it("materializes verified native citations in whole-slide-array patches", () => {
    const slide = { id: "s1", title: "Cooling", sourceRefs: [span.id], objects: [] };
    const patch = prepareContentPatchEvidence("presentation", {
      changes: [{ path: "/slides", value: [slide] }],
    }, bundle) as { changes: Array<{ path: string; value: unknown }> };
    const value = patch.changes[0]!.value as Array<Record<string, unknown>>;
    expect(value[0]).toMatchObject({
      id: "s1",
      sourceRefs: [span.id],
      citations: [{ label: "Cooling study.pdf, p. 3", sourceRefs: [span.id] }],
    });
  });

  it("routes presentation artifact updates through citation preparation", () => {
    const operation = prepareOperationForQuality({
      type: "artifact.update",
      input: {
        artifactId: "presentation-1",
        blueprintKey: "presentation",
        title: null,
        summary: null,
        content: null,
        contentPatch: {
          changes: [{
            path: "/slides",
            value: [{ id: "s1", title: "Cooling", sourceRefs: [span.id], objects: [] }],
          }],
        },
        tags: null,
      },
    }, bundle);
    expect(operation.type).toBe("artifact.update");
    if (operation.type !== "artifact.update") throw new Error("Expected an artifact update.");
    const patchedSlides = operation.input.contentPatch?.changes[0]?.value as Array<Record<string, unknown>>;
    expect(patchedSlides[0]).toMatchObject({
      citations: [{ label: "Cooling study.pdf, p. 3", sourceRefs: [span.id] }],
    });
  });

  it("refreshes citation metadata when a patch changes only slide sourceRefs", () => {
    const replacement = bundle.evidence[0]!;
    const patch = prepareContentPatchEvidence("presentation", {
      changes: [{ path: "/slides/0/sourceRefs", value: [replacement.id] }],
    }, bundle) as { changes: Array<{ path: string; value: unknown }> };
    expect(patch.changes).toEqual([
      { path: "/slides/0/sourceRefs", value: [replacement.id] },
      {
        path: "/slides/0/citations",
        value: expect.arrayContaining([
          expect.objectContaining({ label: "Cooling study.pdf, p. 1", sourceRefs: [replacement.id] }),
        ]),
      },
    ]);
  });

  it("replaces authored citation labels with metadata generated from verified evidence", () => {
    const patch = prepareContentPatchEvidence("presentation", {
      changes: [{
        path: "/slides/0/citations",
        value: [{ id: "made-up", label: "Wrong source", sourceRefs: [span.id] }],
      }],
    }, bundle) as { changes: Array<{ path: string; value: unknown }> };
    const citations = patch.changes[0]!.value as Array<Record<string, unknown>>;
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({
      label: "Cooling study.pdf, p. 3",
      sourceRefs: [span.id],
    });
    expect(citations[0]!.id).not.toBe("made-up");
  });

  it("rejects invented evidence in presentation content patches", () => {
    expect(() => prepareContentPatchEvidence("presentation", {
      changes: [{ path: "/slides", value: [{ id: "s1", sourceRefs: ["evidence:invented"] }] }],
    }, bundle)).toThrow("NOT_ISSUED");
  });
});
