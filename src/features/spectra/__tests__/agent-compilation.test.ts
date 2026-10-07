import { describe, expect, it } from "vitest";
import {
  acceptCompiledSkill,
  applyCompiledRouting,
  createSkill,
  normalizeFoundryContent,
  pendingCompiledSkills,
} from "../agents/foundry";

describe("a Foundry compilation's drafted skills", () => {
  const approved = { ...createSkill({ id: "mark", name: "Mark", purpose: "Marks" }, 5), status: "verified" as const };

  it("wait until approved from this compilation, here or by Spectra, and a skill approved earlier is drafted anew", () => {
    const drafted = [createSkill({ id: "mark", name: "Mark v2", purpose: "Marks better" }, 10), createSkill({ id: "plan", name: "Plan", purpose: "Plans" }, 10)];
    expect(pendingCompiledSkills(drafted, [approved]).map((skill) => skill.id)).toEqual(["mark", "plan"]);
    const after = acceptCompiledSkill([approved], drafted[0]!);
    expect(after).toEqual([{ ...drafted[0], version: 2, supersedesVersion: 1, status: "verified" }]);
    expect(pendingCompiledSkills(drafted, after).map((skill) => skill.id)).toEqual(["plan"]);
    expect(acceptCompiledSkill(after, drafted[1]!).map((skill) => [skill.id, skill.version, skill.status])).toEqual([["mark", 2, "verified"], ["plan", 1, "verified"]]);
  });

  it("apply the compiled routing and notes only where the compiler wrote some", () => {
    const base = normalizeFoundryContent({});
    const content = { ...base, routing: { ...base.routing, description: "Kept", examples: ["Kept example"] } };
    const next = applyCompiledRouting(content, { routing: { description: "", examples: [], negativeExamples: ["Not essays"] }, releaseNotes: "" });
    expect(next.routing).toMatchObject({ description: "Kept", examples: ["Kept example"], negativeExamples: ["Not essays"] });
    expect(next.foundry.draftReleaseNotes).toBe(content.foundry.draftReleaseNotes);
  });
});
