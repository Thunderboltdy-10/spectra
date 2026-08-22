import { describe, expect, it } from "vitest";
import {
  operationRequiresConfirmation,
  parseOperationInput,
} from "@/features/spectra/operations";
import { parseSpectraPlan } from "@/features/spectra/operations/schema";
import { validatePlanAgainstIntent } from "@/features/spectra/operations/validate-plan";

describe("Spectra operation policy", () => {
  it("allows safe direct artifact creation", () => {
    const operation = parseOperationInput({
      type: "artifact.create",
      input: { blueprintKey: "document" },
      affected: [],
    });

    expect(operationRequiresConfirmation(operation)).toBe(false);
  });

  it("requires confirmation for workspace creation", () => {
    const operation = parseOperationInput({
      type: "workspace.create",
      input: { title: "Physics" },
      affected: [],
    });

    expect(operationRequiresConfirmation(operation)).toBe(true);
  });

  it("treats a generated card set as one artifact", () => {
    const operation = parseOperationInput({
      type: "flashcardDeck.create",
      input: { cardCount: 30 },
      affected: [],
      bulkCount: 30,
    });

    expect(operationRequiresConfirmation(operation)).toBe(false);
  });

  it("normalizes conversational provider intent values to answer", () => {
    const plan = parseSpectraPlan({
      decision: "answer",
      intent: { mode: "respond", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0, targetArtifactId: null, targetWorkspaceId: null },
      conversationTitle: "Quick confirmation",
      conversationSummary: "A brief affirmative follow-up.",
      finalResponse: "Yes!",
      operations: [],
    });
    expect(plan.intent.mode).toBe("answer");
  });

  it("accepts bounded content patches for narrow canonical edits", () => {
    const plan = parseSpectraPlan({
      decision: "operate",
      intent: { mode: "update", requestedArtifactTypes: ["quiz"], requestedVisibleArtifactCount: 0, targetArtifactId: "quiz-1", targetWorkspaceId: null },
      conversationTitle: "Update quiz timing",
      conversationSummary: "A focused quiz patch.",
      choices: null,
      operations: [{
        type: "artifact.update",
        input: {
          artifactId: "quiz-1",
          blueprintKey: "quiz",
          title: null,
          summary: null,
          content: null,
          contentPatch: { changes: [{ path: "/questions/0/timeLimitSeconds", value: 72 }] },
          tags: null,
        },
      }],
      finalResponse: "Updated the quiz timing.",
    });
    expect(plan.operations[0]?.type).toBe("artifact.update");
    if (plan.operations[0]?.type === "artifact.update") expect(plan.operations[0].input.contentPatch?.changes[0]?.path).toBe("/questions/0/timeLimitSeconds");
  });

  it("accepts stable document block selectors while rejecting prototype paths", () => {
    expect(() => parseSpectraPlan({
      decision: "operate",
      intent: { mode: "update", requestedArtifactTypes: ["document"], requestedVisibleArtifactCount: 0, targetArtifactId: "doc-1", targetWorkspaceId: null },
      operations: [{
        type: "artifact.update",
        input: {
          artifactId: "doc-1",
          blueprintKey: "document",
          title: null,
          summary: null,
          content: null,
          contentPatch: { changes: [{ path: "/blocks/id:docx:paragraph:abc/text", value: "Updated" }] },
          tags: null,
        },
      }],
      finalResponse: "Updated the document.",
    })).not.toThrow();
    expect(() => parseSpectraPlan({
      decision: "operate",
      intent: { mode: "update", requestedArtifactTypes: ["document"], requestedVisibleArtifactCount: 0, targetArtifactId: "doc-1", targetWorkspaceId: null },
      operations: [{
        type: "artifact.update",
        input: {
          artifactId: "doc-1",
          blueprintKey: "document",
          title: null,
          summary: null,
          content: null,
          contentPatch: { changes: [{ path: "/blocks/__proto__/text", value: "Unsafe" }] },
          tags: null,
        },
      }],
      finalResponse: "Updated the document.",
    })).toThrow();
  });

  it("treats omitted unchanged update fields as null", () => {
    const plan = parseSpectraPlan({
      decision: "operate",
      intent: { mode: "update", requestedArtifactTypes: ["flashcard_deck"], requestedVisibleArtifactCount: 0, targetArtifactId: "deck-1", targetWorkspaceId: null },
      operations: [{
        type: "artifact.update",
        input: {
          artifactId: "deck-1",
          blueprintKey: "flashcard_deck",
          contentPatch: { changes: [{ path: "/cards/1/hint", value: "Matrix cue" }] },
        },
      }],
      finalResponse: "Updated the hint.",
    });
    expect(plan.operations[0]?.type).toBe("artifact.update");
    if (plan.operations[0]?.type === "artifact.update") {
      expect(plan.operations[0].input).toMatchObject({ title: null, summary: null, content: null, tags: null });
    }
  });

  it("allows a later operation to depend on an artifact created earlier in the same task graph", () => {
    const plan = parseSpectraPlan({
      decision: "operate",
      intent: { mode: "mixed", requestedArtifactTypes: ["document"], requestedVisibleArtifactCount: 1, targetArtifactId: null, targetWorkspaceId: "workspace-1" },
      operations: [
        { type: "artifact.create", input: { blueprintKey: "document", title: "Review", summary: null, content: { blocks: [{ id: "intro", type: "paragraph", text: "Review" }] }, tags: [], workspaceId: "workspace-1", placement: "context", pinned: false, exclusivePin: false } },
        { type: "artifact.link", input: { sourceArtifactId: "@created:0", targetArtifactId: "source-1", relationType: "generated_from", label: null, explanation: null, workspaceId: "workspace-1" } },
      ],
      finalResponse: "Created and linked the review.",
    });
    expect(() => validatePlanAgainstIntent(plan, { artifactIds: new Set(["source-1"]), workspaceIds: new Set(["workspace-1"]), placementNodes: new Map() })).not.toThrow();
  });
});
