import { describe, expect, it } from "vitest";
import { normalizeExplicitMutationPlanIntent } from "@/app/api/spectra/run/loop/plan";
import { parseModelOperation, parseSpectraPlan } from "../operations/schema";
import { validatePlanAgainstIntent } from "../operations/validate-plan";

const guideId = "wx76vwa1ttg0p5vccm7m3h8ry98f1718";
const deckId = "wx71ayyqjky5hqv5sr200mp9s58f1fj7";

describe("explicit multi-target update intent", () => {
  it("clears the singular target hint and validates updates to both exact ids", () => {
    const operations = [
      parseModelOperation({
        type: "artifact.update",
        input: {
          artifactId: guideId,
          blueprintKey: "document",
          title: null,
          summary: null,
          content: null,
          contentPatch: { changes: [{ path: "/blocks/0/text", value: "Updated guide" }] },
          tags: null,
        },
      }),
      parseModelOperation({
        type: "artifact.update",
        input: {
          artifactId: deckId,
          blueprintKey: "presentation",
          title: null,
          summary: null,
          content: null,
          contentPatch: { changes: [{ path: "/slides/0/title", value: "Updated deck" }] },
          tags: null,
        },
      }),
    ];
    const plan = parseSpectraPlan({
      decision: "operate",
      intent: {
        mode: "create",
        requestedArtifactTypes: ["document"],
        requestedVisibleArtifactCount: 1,
        targetArtifactId: guideId,
        targetWorkspaceId: null,
        obligations: [
          { id: "guide", description: "Update the guide", operationIndexes: [0] },
          { id: "deck", description: "Update the deck", operationIndexes: [1] },
        ],
      },
      operations,
      finalResponse: "Updated both artifacts.",
    });
    const artifactBlueprints = new Map([
      [guideId, "document"],
      [deckId, "presentation"],
    ] as const);
    const normalized = normalizeExplicitMutationPlanIntent(
      plan,
      [guideId, deckId],
      artifactBlueprints,
    );

    expect(normalized.intent).toMatchObject({
      mode: "update",
      requestedArtifactTypes: ["document", "presentation"],
      requestedVisibleArtifactCount: 0,
      targetArtifactId: null,
      targetWorkspaceId: null,
    });
    expect(() =>
      validatePlanAgainstIntent(normalized, {
        artifactIds: new Set([guideId, deckId]),
        workspaceIds: new Set(),
        placementNodes: new Map(),
        artifactBlueprints,
      }),
    ).not.toThrow();
  });

  it("retains the exact target hint for a single explicit update", () => {
    const operation = parseModelOperation({
      type: "artifact.update",
      input: {
        artifactId: guideId,
        blueprintKey: "document",
        title: null,
        summary: null,
        content: null,
        contentPatch: { changes: [{ path: "/blocks/0/text", value: "Updated guide" }] },
        tags: null,
      },
    });
    const plan = parseSpectraPlan({
      decision: "operate",
      intent: {
        mode: "answer",
        requestedArtifactTypes: [],
        requestedVisibleArtifactCount: 0,
        targetArtifactId: null,
        targetWorkspaceId: "workspace-unrelated",
      },
      operations: [operation],
      finalResponse: "Updated the guide.",
    });
    const normalized = normalizeExplicitMutationPlanIntent(
      plan,
      [guideId],
      new Map([[guideId, "document"]]),
    );
    expect(normalized.intent).toMatchObject({
      mode: "update",
      requestedArtifactTypes: ["document"],
      targetArtifactId: guideId,
      targetWorkspaceId: null,
    });
  });
});
