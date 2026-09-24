import { describe, expect, it } from "vitest";
import { buildAgentOrientation } from "@/app/api/spectra/run/loop/plan";
import { buildAttachmentEvidence } from "../ai/attachment-evidence";
import { prepareContentEvidence } from "../ai/source-evidence-content";

describe("S10 independent review: clarification and citation continuation", () => {
  it("keeps the authoritative unresolved goal and selected answer in the model orientation", () => {
    const activeGoal = {
      request: "Revise the chemistry guide and make a separate practice deck",
      question: "Which guide should I change?", selectedChoice: "Guía — Química",
      intent: { mode: "mixed", requestedArtifactTypes: ["flashcard_deck"], targetArtifactId: "chemistry-guide" },
      rule: "Earlier requests in the thread are historical and must not be revived.",
    };
    const orientation = buildAgentOrientation({ activeGoal,
      conversation: [{ role: "user", content: "Previously create a biology timetable." }],
    }, "Guía — Química");
    expect(orientation).toHaveProperty("activeGoal", activeGoal);
  });

  it("updates a generated native citation when a follow-up replaces the passage from the same source", () => {
    const first = "Shade reduces direct solar exposure.";
    const second = "The small observational sample does not establish causation.";
    const bundle = buildAttachmentEvidence([{ id: "cooling-source", name: "Campus cooling.pdf", mimeType: "application/pdf",
      size: 200, handling: "pdf", extractedText: `${first}\n\n${second}`,
      sourceMap: [
        { kind: "page", label: "Page 2", startOffset: 0, endOffset: first.length },
        { kind: "page", label: "Page 7", startOffset: first.length + 2, endOffset: first.length + 2 + second.length },
      ],
    }])!;
    const originalSpan = bundle.evidence.find((span) => span.page === 2)!;
    const correctedSpan = bundle.evidence.find((span) => span.page === 7)!;
    const original = prepareContentEvidence("document", { blocks: [{ id: "claim", type: "paragraph", text: first,
      sourceRefs: [originalSpan.id] }] }, bundle) as { blocks: Array<Record<string, unknown>> };
    const edited = { ...original, blocks: original.blocks.map((block) => ({ ...block, text: second, sourceRefs: [correctedSpan.id] })) };
    const updated = prepareContentEvidence("document", edited, bundle) as typeof original;
    const inlines = updated.blocks[0]!.inlineContent as Array<Record<string, unknown>>;
    const citation = inlines.find((inline) => inline.kind === "citation");
    expect(citation).toMatchObject({ pages: "7", sourceRef: { evidenceIds: [correctedSpan.id] } });
  });
});
