import { describe, expect, it } from "vitest";
import { declaredSingleCreation } from "../operations/creation-intent";
import { parseSpectraPlan, type RequestIntent } from "../operations/schema";

function plan(types: RequestIntent["requestedArtifactTypes"], count: number, mode: RequestIntent["mode"] = "create") {
  const parsed = parseSpectraPlan({
    decision: mode === "answer" ? "answer" : "operate",
    intent: {
      mode,
      requestedArtifactTypes: types,
      requestedVisibleArtifactCount: count,
      targetArtifactId: null,
      targetWorkspaceId: null,
    },
    operations: mode === "answer" ? [] : [{ type: "artifact.create", input: {
      blueprintKey: "document", title: "Model-selected draft", summary: null,
      content: { blocks: [{ id: "p1", type: "paragraph", text: "An authored paragraph." }], outline: [] },
      tags: [], workspaceId: null, placement: "inbox",
    } }],
    choices: null,
    finalResponse: "Model-selected artifact contract.",
  });
  return { ...parsed, intent: { ...parsed.intent, mode, requestedArtifactTypes: types, requestedVisibleArtifactCount: count } };
}

describe("declared creation contract", () => {
  it("uses the model's presentation choice without a shorthand guess", () => {
    expect(declaredSingleCreation(plan(["presentation"], 1))).toEqual({
      blueprintKey: "presentation", label: "presentation",
    });
    expect(declaredSingleCreation(plan(["flashcard_deck"], 1))).toEqual({
      blueprintKey: "flashcard_deck", label: "flashcard deck",
    });
  });

  it("keeps multiple outputs outside single-creation reconciliation", () => {
    expect(declaredSingleCreation(plan(["document", "presentation"], 2))).toBeNull();
    expect(declaredSingleCreation(plan(["presentation"], 2))).toBeNull();
  });

  it("keeps answer and update intent outside creation reconciliation", () => {
    expect(declaredSingleCreation(plan([], 0, "answer"))).toBeNull();
    expect(declaredSingleCreation(plan(["presentation"], 1, "update"))).toBeNull();
  });

  it("retains a declared single creation beside an existing-object edit", () => {
    expect(declaredSingleCreation(plan(["document"], 1, "mixed"))?.blueprintKey).toBe("document");
  });
});
