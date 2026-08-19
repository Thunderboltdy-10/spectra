import { describe, expect, it } from "vitest";
import { parseSpectraStreamEvent } from "@/features/spectra/ai/stream-events";
import { createRunItem } from "@/features/spectra/actions/protocol/run-item";
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
        cards: Array.from({ length: 6 }, (_, index) => ({
          id: `card-${index}`,
          front: `Question ${index}`,
          back: `Answer ${index}`,
          hint: `Cue ${index}`,
          sourceRefs: [],
          confidence: "unknown" as const,
        })),
        settings: { shuffle: true, revealMode: "click" as const },
      },
      tags: ["biology"],
      workspaceId: null,
      placement: "context" as const,
    },
  };
}

function createIntent(count = 1) {
  return {
    mode: "create" as const,
    requestedArtifactTypes: ["flashcard_deck" as const],
    requestedVisibleArtifactCount: count,
    targetArtifactId: null,
    targetWorkspaceId: null,
  };
}

const references = {
  artifactIds: new Set(["artifact-real"]),
  workspaceIds: new Set(["workspace-real"]),
  placementNodes: new Map([
    [
      "item-real",
      { artifactId: "artifact-real", workspaceId: "workspace-real" },
    ],
  ]),
  threadIds: new Set<string>(),
};

describe("Wave 4 controlled operation engine", () => {
  it("validates a six-card deck as one visible artifact without confirmation", () => {
    const intent = createIntent();
    const plan = parseSpectraPlan({
      decision: "operate",
      intent,
      finalResponse: "Created a 6-card deck.",
      operations: [deckOperation()],
    });
    validatePlanAgainstIntent(plan, references);
    const policy = evaluatePlanPolicy(plan.operations, { intent });
    expect(policy.visibleObjectCreations).toBe(1);
    expect(policy.requiresConfirmation).toBe(false);
    const operation = plan.operations[0];
    expect(
      operation?.type === "artifact.create" &&
        operation.input.blueprintKey === "flashcard_deck"
        ? operation.input.content.cards
        : [],
    ).toHaveLength(6);
  });

  it("allows one typed create when the model reports an inconsistent zero visible count", () => {
    const intent = createIntent(0);
    const plan = parseSpectraPlan({
      decision: "operate",
      intent,
      finalResponse: "Created one deck.",
      operations: [deckOperation()],
    });
    expect(() => validatePlanAgainstIntent(plan, references)).not.toThrow();
  });

  it("allows one repeated requested type when the model counted artifact types instead of objects", () => {
    const intent = { ...createIntent(1), mode: "mixed" as const };
    const plan = parseSpectraPlan({
      decision: "operate",
      intent,
      finalResponse: "Created two requested decks.",
      operations: [deckOperation(), deckOperation("Second requested deck")],
    });
    expect(() => validatePlanAgainstIntent(plan, references)).not.toThrow();
  });

  it("requires confirmation for workspace creation and multiple visible artifacts", () => {
    const intent = { ...createIntent(2), mode: "mixed" as const };
    const plan = parseSpectraPlan({
      decision: "operate",
      intent,
      finalResponse: "Prepared the requested structure.",
      operations: [
        {
          type: "workspace.create",
          input: { title: "Biology revision", description: null },
        },
        deckOperation(),
        deckOperation("Second deck"),
      ],
    });
    const policy = evaluatePlanPolicy(plan.operations, { intent });
    expect(policy.requiresConfirmation).toBe(true);
    expect(policy.reasons.join(" ")).toMatch(/workspace/i);
    expect(policy.reasons.join(" ")).toMatch(/2 visible artifacts/i);
  });

  it("accepts an owned archive request but always requires confirmation", () => {
    const intent = {
      mode: "archive" as const,
      requestedArtifactTypes: [] as Array<
        "document" | "flashcard_deck" | "quiz" | "planner_task"
      >,
      requestedVisibleArtifactCount: 0,
      targetArtifactId: "artifact-real",
      targetWorkspaceId: "workspace-real",
    };
    const plan = parseSpectraPlan({
      decision: "operate",
      intent,
      finalResponse: "Archive the selected artifact after confirmation.",
      operations: [
        { type: "artifact.archive", input: { artifactId: "artifact-real" } },
      ],
    });
    expect(() => validatePlanAgainstIntent(plan, references)).not.toThrow();
    const policy = evaluatePlanPolicy(plan.operations, { intent });
    expect(policy.requiresConfirmation).toBe(true);
    expect(policy.reasons.join(" ")).toMatch(/archive/i);
  });

  it("rejects malformed quiz content before execution", () => {
    expect(() =>
      parseSpectraPlan({
        decision: "operate",
        intent: {
          mode: "create",
          requestedArtifactTypes: ["quiz"],
          requestedVisibleArtifactCount: 1,
          targetArtifactId: null,
          targetWorkspaceId: null,
        },
        finalResponse: "Created.",
        operations: [
          {
            type: "artifact.create",
            input: {
              blueprintKey: "quiz",
              title: "Broken",
              summary: null,
              content: {
                questions: [
                  {
                    id: "q1",
                    prompt: "Missing fields",
                    type: "multiple_choice",
                    options: [],
                    correctAnswer: "",
                    explanation: "",
                    difficulty: "medium",
                    sourceRefs: [],
                  },
                ],
                settings: { showAnswersImmediately: true, timed: false },
              },
              tags: [],
              workspaceId: null,
              placement: "inbox",
            },
          },
        ],
      }),
    ).toThrow(/questions|correctAnswer|options/);
  });

  it("does not require confirmation for a simple code sketch with empty dependency defaults", () => {
    const intent = {
      mode: "create" as const,
      requestedArtifactTypes: ["code" as const],
      requestedVisibleArtifactCount: 1,
      targetArtifactId: null,
      targetWorkspaceId: null,
    };
    const plan = parseSpectraPlan({
      decision: "operate",
      intent,
      finalResponse: "Created a tiny carbon cycle sketch.",
      operations: [
        {
          type: "artifact.create",
          input: {
            blueprintKey: "code",
            title: "Tiny Carbon Cycle Sketch",
            summary: "A compact SVG diagram of the carbon cycle.",
            content: {
              runtime: "browser",
              entryFileId: "file-1",
              files: [
                {
                  id: "file-1",
                  path: "index.html",
                  language: "html",
                  source:
                    "<main><svg viewBox='0 0 320 240'><circle cx='160' cy='120' r='40'/></svg></main>",
                },
              ],
              visualisation: { enabled: true },
              dependencies: {},
              networkPolicy: { mode: "none" },
              assets: [],
              parameters: [],
            },
            tags: ["biology"],
            workspaceId: null,
            placement: "context",
          },
        },
      ],
    });
    const policy = evaluatePlanPolicy(plan.operations, { intent });
    expect(policy.requiresConfirmation).toBe(false);
  });

  it("requires confirmation when a code create declares curated dependencies", () => {
    const intent = {
      mode: "create" as const,
      requestedArtifactTypes: ["code" as const],
      requestedVisibleArtifactCount: 1,
      targetArtifactId: null,
      targetWorkspaceId: null,
    };
    const plan = parseSpectraPlan({
      decision: "operate",
      intent,
      finalResponse: "Created a React chart.",
      operations: [
        {
          type: "artifact.create",
          input: {
            blueprintKey: "code",
            title: "Km Vmax Chart",
            summary: "Interactive chart.",
            content: {
              runtime: "react",
              entryFileId: "file-1",
              files: [
                {
                  id: "file-1",
                  path: "App.tsx",
                  language: "tsx",
                  source: "export default function App(){ return null }",
                },
              ],
              visualisation: { enabled: true },
              dependencies: { recharts: "2.15.4" },
              networkPolicy: { mode: "none" },
              assets: [],
              parameters: [],
            },
            tags: [],
            workspaceId: null,
            placement: "context",
          },
        },
      ],
    });
    const policy = evaluatePlanPolicy(plan.operations, { intent });
    expect(policy.requiresConfirmation).toBe(true);
    expect(policy.reasons.join(" ")).toMatch(/dependency/i);
  });

  it("rejects unrelated and synthetic placement removals before persistence", () => {
    const unrelated = parseSpectraPlan({
      decision: "operate",
      intent: createIntent(),
      finalResponse: "Created a deck.",
      operations: [
        deckOperation(),
        {
          type: "workspaceItem.hide",
          input: { nodeId: "run:create_artifact:deck-1" },
        },
      ],
    });
    expect(() => validatePlanAgainstIntent(unrelated, references)).toThrow(
      /unrelated/i,
    );

    const synthetic = parseSpectraPlan({
      decision: "operate",
      intent: {
        mode: "remove_placement",
        requestedArtifactTypes: [],
        requestedVisibleArtifactCount: 0,
        targetArtifactId: "artifact-real",
        targetWorkspaceId: "workspace-real",
      },
      finalResponse: "Removed placement.",
      operations: [
        {
          type: "workspaceItem.hide",
          input: { nodeId: "run:create_artifact:deck-1" },
        },
      ],
    });
    expect(() => validatePlanAgainstIntent(synthetic, references)).toThrow(
      /Synthetic operation keys/i,
    );
  });

  it("supports answer-only and clarification decisions without mutations", () => {
    const answer = parseSpectraPlan({
      decision: "answer",
      intent: {
        mode: "answer",
        requestedArtifactTypes: [],
        requestedVisibleArtifactCount: 0,
        targetArtifactId: "artifact-real",
        targetWorkspaceId: null,
      },
      finalResponse: "Improve the distractors and add explanations.",
      operations: [],
    });
    expect(answer.operations).toEqual([]);

    const large = parseSpectraPlan({
      decision: "clarify",
      intent: {
        mode: "create",
        requestedArtifactTypes: ["flashcard_deck"],
        requestedVisibleArtifactCount: 25,
        targetArtifactId: null,
        targetWorkspaceId: null,
      },
      finalResponse:
        "That would create 25 visible decks. Which smaller batch should I start with?",
      operations: [],
    });
    expect(large.decision).toBe("clarify");
  });

  it("strictly parses operation-derived progress events", () => {
    expect(
      parseSpectraStreamEvent({
        type: "status",
        runId: "run-1",
        message: "Validating 6 cards",
      }),
    ).toEqual({
      type: "status",
      runId: "run-1",
      message: "Validating 6 cards",
    });
    expect(
      parseSpectraStreamEvent({
        type: "text_replace",
        runId: "run-1",
        content: "",
      }),
    ).toEqual({ type: "text_replace", runId: "run-1", content: "" });
    expect(() =>
      parseSpectraStreamEvent({
        type: "status",
        runId: "run-1",
        message: "ok",
        privateReasoning: "hidden",
      }),
    ).toThrow();
  });

  it("accepts the intentional V2 envelope without weakening legacy event validation", () => {
    const runItem = createRunItem(
      "run-1",
      0,
      { type: "progress", summary: "Validating 6 cards" },
      1_723_456_789,
    );
    expect(
      parseSpectraStreamEvent({
        type: "progress",
        runId: "run-1",
        title: "Validating 6 cards",
        activity: "verify",
        protocolVersion: 2,
        runItem,
      }),
    ).toEqual({
      type: "progress",
      runId: "run-1",
      title: "Validating 6 cards",
      activity: "verify",
    });

    expect(() =>
      parseSpectraStreamEvent({
        type: "status",
        runId: "run-1",
        message: "Working",
        privateReasoning: "hidden",
        protocolVersion: 2,
        runItem,
      }),
    ).toThrow();
    expect(() =>
      parseSpectraStreamEvent({
        type: "status",
        runId: "another-run",
        message: "Working",
        protocolVersion: 2,
        runItem,
      }),
    ).toThrow(/does not match/);
  });
});
