import { describe, expect, it } from "vitest";
import {
  shouldAllowAgentDiscovery,
  shouldUseComplexReasoning,
} from "../ai/model-strategy";

describe("Spectra model strategy", () => {
  it("does not mistake normal quiz wording for a complex reasoning task", () => {
    expect(
      shouldUseComplexReasoning({
        prompt:
          "Create a quiz with four multiple-choice and two short-answer questions covering all three sections.",
        attachmentCount: 0,
        boundedSingleCreation: true,
      }),
    ).toBe(false);
  });

  it("reserves reasoning for genuinely broad multi-object work", () => {
    expect(
      shouldUseComplexReasoning({
        prompt:
          "Compare the evidence across several documents, then reorganize the workspace.",
        attachmentCount: 0,
        boundedSingleCreation: false,
      }),
    ).toBe(true);
  });

  it("uses retrieval for an unfocused edit but not an already focused edit", () => {
    expect(
      shouldAllowAgentDiscovery({
        prompt: "Update my respiration notes",
        hasFocusedArtifact: false,
      }),
    ).toBe(true);
    expect(
      shouldAllowAgentDiscovery({
        prompt: "Update this explanation",
        hasFocusedArtifact: true,
      }),
    ).toBe(false);
    expect(
      shouldAllowAgentDiscovery({
        prompt: "Create a quiz covering all three sections of this deck",
        hasFocusedArtifact: true,
      }),
    ).toBe(false);
  });
});
