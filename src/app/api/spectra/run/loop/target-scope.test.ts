import { describe, expect, it } from "vitest";
import {
  explicitMutationArtifactIdsFromPrompt,
  explicitMutationScopeViolation,
  explicitlyExcludedArtifactIdsFromPrompt,
  isExplicitExistingArtifactUpdateOnly,
} from "./target-scope";

const guideId = "wx76vwa1ttg0p5vccm7m3h8ry98f1718";
const deckId = "wx71ayyqjky5hqv5sr200mp9s58f1fj7";
const excludedId = "wx720bv08ajerqem8dtgkqxqsd8f0jat";

describe("explicit update scope", () => {
  it("extracts positive exact targets and keeps an excluded id out of scope", () => {
    const prompt = `Update only guide ${guideId} and deck ${deckId} in place. Make the deck exactly six slides. Do not touch ${excludedId}. Do not create a new chat.`;

    expect(isExplicitExistingArtifactUpdateOnly(prompt)).toBe(true);
    expect(explicitMutationArtifactIdsFromPrompt(prompt)).toEqual([guideId, deckId]);
    expect(explicitlyExcludedArtifactIdsFromPrompt(prompt)).toEqual([excludedId]);
  });

  it("extracts a short artifact list following an explicit update-only heading", () => {
    const prompt = `Update only these two already-owned artifacts in place:\n- Guide: ${guideId}\n- Presentation: ${deckId}\nNever touch ${excludedId}.`;

    expect(isExplicitExistingArtifactUpdateOnly(prompt)).toBe(true);
    expect(explicitMutationArtifactIdsFromPrompt(prompt)).toEqual([guideId, deckId]);
    expect(explicitlyExcludedArtifactIdsFromPrompt(prompt)).toEqual([excludedId]);
  });

  it("keeps a separately requested new artifact out of update-only scope", () => {
    expect(
      isExplicitExistingArtifactUpdateOnly(
        `Update only ${guideId} in place, then create a new presentation.`,
      ),
    ).toBe(false);
  });

  it("allows only artifact updates to verified exact targets", () => {
    expect(
      explicitMutationScopeViolation(
        { type: "artifact.update", input: { artifactId: guideId } },
        [guideId, deckId],
      ),
    ).toBeNull();
    expect(
      explicitMutationScopeViolation(
        { type: "artifact.update", input: { artifactId: excludedId } },
        [guideId, deckId],
      ),
    ).toMatch(/exact named artifacts/i);
    expect(
      explicitMutationScopeViolation(
        { type: "artifact.create", input: { blueprintKey: "document" } },
        [guideId, deckId],
      ),
    ).toMatch(/existing artifacts only/i);
  });
});
