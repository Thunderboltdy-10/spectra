import { describe, expect, it } from "vitest";
import {
  explicitMutationArtifactIdsFromPrompt,
  explicitlyExcludedArtifactIdsFromPrompt,
  isExplicitExistingArtifactUpdateOnly,
} from "./target-scope";

describe("explicit mutation scope", () => {
  it("keeps explicit update targets and exclusions even when it says make the deck", () => {
    const prompt = [
      "Continue in this same conversation. Do not create a new chat.",
      "Update only guide wx76vwa1ttg0p5vccm7m3h8ry98f1718 and deck wx71ayyqjky5hqv5sr200mp9s58f1fj7 in place.",
      "Preserve the saved guide and make the deck exactly six narrative slides.",
      "Do not touch wx720bv08ajerqem8dtgkqxqsd8f0jat.",
    ].join(" ");

    expect(isExplicitExistingArtifactUpdateOnly(prompt)).toBe(true);
    expect(explicitMutationArtifactIdsFromPrompt(prompt)).toEqual([
      "wx76vwa1ttg0p5vccm7m3h8ry98f1718",
      "wx71ayyqjky5hqv5sr200mp9s58f1fj7",
    ]);
    expect(explicitlyExcludedArtifactIdsFromPrompt(prompt)).toEqual([
      "wx720bv08ajerqem8dtgkqxqsd8f0jat",
    ]);
  });

  it("preserves a separately requested new artifact beside an existing-object edit", () => {
    const prompt =
      "Update only wx76vwa1ttg0p5vccm7m3h8ry98f1718 in place, then create a new presentation about climate patterns.";

    expect(isExplicitExistingArtifactUpdateOnly(prompt)).toBe(false);
  });
});
