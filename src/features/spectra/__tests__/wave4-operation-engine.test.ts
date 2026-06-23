import { describe, expect, it } from "vitest";
import { parseSpectraStreamEvent } from "@/features/spectra/ai/stream-events";
import { evaluatePlanPolicy } from "@/features/spectra/operations/policy";
import { parseSpectraPlan } from "@/features/spectra/operations/schema";
import { validatePlanAgainstIntent } from "@/features/spectra/operations/validate-plan";

function deckOperation(title = "Respiration recall") {
  return {
    type: "artifact.create" as const,
    input: {
      blueprintKey: "flashcard_deck" as const,
      title,
      summary: "Core recall prompts.",
      content: {
        cards: Array.from({ length: 6 }, (_, index) => ({ id: `card-${index}`, front: `Question ${index}`, back: `Answer ${index}`, hint: `Cue ${index}`, sourceRefs: [], confidence: "unknown" as const })),
        settings: { shuffle: true, revealMode: "click" as const },
      },
      tags: ["biology"],
      workspaceId: null,
      placement: "context" as const,
    },
  };
}

function createIntent(count = 1) {
  return { mode: "create" as const, requestedArtifactTypes: ["flashcard_deck" as const], requestedVisibleArtifactCount: count, targetArtifactId: null, targetWorkspaceId: null };
}

const references = {
  artifactIds: new Set(["artifact-real"]),
  workspaceIds: new Set(["workspace-real"]),
  workspaceItems: new Map([["item-real", { artifactId: "artifact-real", workspaceId: "workspace-real" }]]),
  threadIds: new Set<string>(),
};

describe("Wave 4 controlled operation engine", () => {
  it("validates a six-card deck as one visible artifact without confirmation", () => {
    const intent = createIntent();
    const plan = parseSpectraPlan({ decision: "operate", intent, finalResponse: "Created a 6-card deck.", operations: [deckOperation()] });
    validatePlanAgainstIntent(plan, references);
    const policy = evaluatePlanPolicy(plan.operations, { intent });
    expect(policy.visibleObjectCreations).toBe(1);
    expect(policy.requiresConfirmation).toBe(false);
    expect(plan.operations[0]?.type === "artifact.create" && plan.operations[0].input.content.cards).toHaveLength(6);
  });

  it("requires confirmation for workspace creation and multiple visible artifacts", () => {
    const intent = { ...createIntent(2), mode: "mixed" as const };
    const plan = parseSpectraPlan({
      decision: "operate",
      intent,
      finalResponse: "Prepared the requested structure.",
      operations: [
        { type: "workspace.create", input: { title: "Biology revision", description: null } },
        deckOperation(),
        deckOperation("Second deck"),
      ],
    });
    const policy = evaluatePlanPolicy(plan.operations, { intent });
    expect(policy.requiresConfirmation).toBe(true);
    expect(policy.reasons.join(" ")).toMatch(/workspace/i);
    expect(policy.reasons.join(" ")).toMatch(/2 visible artifacts/i);
  });

  it("rejects malformed quiz content before execution", () => {
    expect(() => parseSpectraPlan({
      decision: "operate",
      intent: { mode: "create", requestedArtifactTypes: ["quiz"], requestedVisibleArtifactCount: 1, targetArtifactId: null, targetWorkspaceId: null },
      finalResponse: "Created.",
      operations: [{ type: "artifact.create", input: { blueprintKey: "quiz", title: "Broken", summary: null, content: { questions: [{ id: "q1", prompt: "Missing fields", type: "multiple_choice", options: [], correctAnswer: "", explanation: "", difficulty: "medium", sourceRefs: [] }], settings: { showAnswersImmediately: true, timed: false } }, tags: [], workspaceId: null, placement: "inbox" } }],
    })).toThrow(/questions|correctAnswer|options/);
  });

  it("rejects unrelated and synthetic placement removals before persistence", () => {
    const unrelated = parseSpectraPlan({
      decision: "operate",
      intent: createIntent(),
      finalResponse: "Created a deck.",
      operations: [deckOperation(), { type: "workspaceItem.hide", input: { workspaceItemId: "run:create_artifact:deck-1" } }],
    });
    expect(() => validatePlanAgainstIntent(unrelated, references)).toThrow(/unrelated/i);

    const synthetic = parseSpectraPlan({
      decision: "operate",
      intent: { mode: "remove_placement", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0, targetArtifactId: "artifact-real", targetWorkspaceId: "workspace-real" },
      finalResponse: "Removed placement.",
      operations: [{ type: "workspaceItem.hide", input: { workspaceItemId: "run:create_artifact:deck-1" } }],
    });
    expect(() => validatePlanAgainstIntent(synthetic, references)).toThrow(/Synthetic operation keys/i);
  });

  it("supports answer-only and clarification decisions without mutations", () => {
    const answer = parseSpectraPlan({ decision: "answer", intent: { mode: "answer", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0, targetArtifactId: "artifact-real", targetWorkspaceId: null }, finalResponse: "Improve the distractors and add explanations.", operations: [] });
    expect(answer.operations).toEqual([]);

    const large = parseSpectraPlan({ decision: "clarify", intent: { mode: "create", requestedArtifactTypes: ["flashcard_deck"], requestedVisibleArtifactCount: 25, targetArtifactId: null, targetWorkspaceId: null }, finalResponse: "That would create 25 visible decks. Which smaller batch should I start with?", operations: [] });
    expect(large.decision).toBe("clarify");
  });

  it("strictly parses operation-derived progress events", () => {
    expect(parseSpectraStreamEvent({ type: "status", runId: "run-1", message: "Validating 6 cards" })).toEqual({ type: "status", runId: "run-1", message: "Validating 6 cards" });
    expect(() => parseSpectraStreamEvent({ type: "status", runId: "run-1", message: "ok", privateReasoning: "hidden" })).toThrow();
  });
});
