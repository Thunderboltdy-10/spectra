import { describe, expect, it, vi } from "vitest";
import type {
  SkillMetadata,
  SkillWithBody,
} from "@/features/spectra/skills/contracts";
import {
  SKILL_CONTEXT_LIMITS,
  boundedSkillMetadataLines,
  buildLazySkillContext,
  selectTriggeredSkills,
} from "@/features/spectra/skills/lazy-context";

const skills: SkillMetadata[] = [
  {
    id: "self:flashcards",
    name: "My flashcards",
    purpose: "Use the learner's preferred recall-card structure.",
    triggerTerms: ["flashcard", "active recall"],
    version: 2,
    source: "self",
    updatedAt: 20,
  },
  {
    id: "system:socratic-dialogue",
    name: "Socratic dialogue",
    purpose: "Guide the learner through one adaptive question at a time.",
    triggerTerms: ["socratic", "guide me"],
    version: 1,
    source: "system",
  },
  {
    id: "system:diagram-guidance",
    name: "Diagram guidance",
    purpose: "Create readable diagrams with editable structure.",
    triggerTerms: ["diagram", "concept map"],
    version: 1,
    source: "system",
  },
];

function withBody(skill: SkillMetadata, body: string): SkillWithBody {
  return { ...skill, body };
}

describe("lazy account skill context", () => {
  it("loads no bodies for an unrelated prompt", async () => {
    const readBody = vi.fn<(id: string) => Promise<SkillWithBody | null>>();
    const result = await buildLazySkillContext({
      prompt: "Summarize the attached history chapter in three paragraphs.",
      metadata: skills,
      readBody,
    });

    expect(readBody).not.toHaveBeenCalled();
    expect(result.manifest.activeSkillIds).toEqual([]);
    expect(result.manifest.activeBodyCharacters).toBe(0);
    expect(result.manifest.estimatedActiveBodyTokens).toBe(0);
    expect(result.section).not.toContain("<active_skill");
  });

  it("loads only the matching procedure and keeps unrelated bodies lazy", async () => {
    const byId = new Map(
      skills.map((skill) => [
        skill.id,
        withBody(skill, `# ${skill.name}\n\nFollow the matched procedure.`),
      ]),
    );
    const readBody = vi.fn(async (id: string) => byId.get(id) ?? null);
    const result = await buildLazySkillContext({
      prompt: "Make active recall flashcards from these biology notes.",
      metadata: skills,
      readBody,
    });

    expect(readBody).toHaveBeenCalledTimes(1);
    expect(readBody).toHaveBeenCalledWith("self:flashcards");
    expect(result.manifest.activeSkillIds).toEqual(["self:flashcards"]);
    expect(result.section).toContain('<active_skill id="self:flashcards"');
    expect(result.section).not.toContain(
      '<active_skill id="system:socratic-dialogue"',
    );
  });

  it("enforces the metadata, body, and active-skill budgets", async () => {
    const denseMetadata = Array.from({ length: 80 }, (_, index) => ({
      id: `self:dense-${index}`,
      name: `Dense procedure ${index}`,
      purpose: "A deliberately long bounded purpose for metadata accounting.",
      triggerTerms: ["diagram"],
      version: 1,
      source: "self" as const,
      updatedAt: index,
    }));
    const metadataLines = boundedSkillMetadataLines(denseMetadata);
    expect(metadataLines.join("\n").length).toBeLessThanOrEqual(
      SKILL_CONTEXT_LIMITS.metadataCharacters,
    );

    const bodies = new Map<string, string>([
      ["self:dense-0", "a".repeat(3_000)],
      ["self:dense-1", "b".repeat(1_800)],
    ]);
    const result = await buildLazySkillContext({
      prompt: "Create a diagram.",
      metadata: denseMetadata,
      readBody: async (id) => {
        const skill = denseMetadata.find((candidate) => candidate.id === id);
        const body = bodies.get(id);
        return skill && body ? withBody(skill, body) : null;
      },
    });

    expect(result.manifest.activeSkillIds.length).toBeLessThanOrEqual(
      SKILL_CONTEXT_LIMITS.activeSkills,
    );
    expect(result.manifest.activeSkillIds).toEqual(["self:dense-0"]);
    expect(result.manifest.activeBodyCharacters).toBe(3_000);
    expect(result.manifest.estimatedActiveBodyTokens).toBe(750);
    expect(result.manifest.activeBodyCharacters).toBeLessThanOrEqual(
      SKILL_CONTEXT_LIMITS.activeBodyCharacters,
    );
    expect(
      selectTriggeredSkills("Create a diagram.", denseMetadata),
    ).toHaveLength(SKILL_CONTEXT_LIMITS.activeSkills);
  });
});
