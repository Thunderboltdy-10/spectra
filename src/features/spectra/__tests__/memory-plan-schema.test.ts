import { describe, expect, it } from "vitest";
import { systemPrompt } from "@/app/api/spectra/run/loop/plan";
import { parseSpectraPlan } from "@/features/spectra/operations/schema";

function answerPlan(memoryProposals: unknown[] = []) {
  return {
    decision: "answer",
    intent: {
      mode: "answer",
      requestedArtifactTypes: [],
      requestedVisibleArtifactCount: 0,
      targetArtifactId: null,
      targetWorkspaceId: null,
    },
    progressUpdates: [],
    operations: [],
    presentedArtifactIds: [],
    memoryProposals,
    finalResponse: "I will use the corrected workflow.",
  };
}

const validProposal = {
  claimType: "correction",
  proposition: "Use the corrected uncertainty values in later lab summaries.",
  reason: "The user corrected the values in this turn.",
};

describe("model memory proposal schema", () => {
  it("accepts only the three bounded durable proposal categories", () => {
    const plan = parseSpectraPlan(
      answerPlan([
        validProposal,
        {
          ...validProposal,
          claimType: "recurring_workflow",
          proposition:
            "Check the source table before drafting each conclusion.",
        },
        {
          ...validProposal,
          claimType: "mistake_avoidance",
          proposition:
            "Do not round intermediate calculations before the final result.",
        },
      ]),
    );
    expect(plan.memoryProposals).toHaveLength(3);
    expect(parseSpectraPlan(answerPlan()).memoryProposals).toEqual([]);
  });

  it("rejects proposal count, size, and type violations", () => {
    expect(() =>
      parseSpectraPlan(
        answerPlan(Array.from({ length: 4 }, () => validProposal)),
      ),
    ).toThrow();
    expect(() =>
      parseSpectraPlan(
        answerPlan([{ ...validProposal, proposition: "x".repeat(601) }]),
      ),
    ).toThrow();
    expect(() =>
      parseSpectraPlan(
        answerPlan([{ ...validProposal, reason: "x".repeat(241) }]),
      ),
    ).toThrow();
    expect(() =>
      parseSpectraPlan(
        answerPlan([{ ...validProposal, claimType: "declared_fact" }]),
      ),
    ).toThrow();
  });

  it("keeps capture hidden from progress and the final answer", () => {
    const prompt = systemPrompt("workspace");
    expect(prompt).toContain("memoryProposals is a hidden maintenance channel");
    expect(prompt).toContain(
      "Never mention memory maintenance in progressUpdates or finalResponse",
    );
    expect(prompt).toContain("one-off requests");
    expect(prompt).toContain("credentials");
  });
});
