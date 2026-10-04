import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLE_PATH, SKILLS_DIR, collectSkills, parseSkill, renderBundle } from "../../../../../../scripts/bundle-skills.mjs";
import { SKILL_BUNDLE } from "../../skills/bundle.generated";
import { AUTHORING_FORMATS } from "../authoring/formats";
import { buildSystemPrompt } from "../prompt";
import { SKILL_INDEX, loadSkillText, loadSkillTool, skillIndexText } from "../skills";

const context = { signal: new AbortController().signal, runId: "r", toolCallId: "t" };

describe("skills as folders", () => {
  it("bundles exactly what the skill folders hold", () => {
    const current = readFileSync(BUNDLE_PATH, "utf8").replace(/\r\n?/g, "\n");
    expect(current).toBe(renderBundle(collectSkills()));
  });

  it("has a craft skill for every artifact type plus design, frontend-design, teaching and research", () => {
    const names = SKILL_INDEX.map((entry) => entry.name);
    for (const type of Object.keys(AUTHORING_FORMATS)) expect(names).toContain(type);
    for (const name of ["spectra-design", "frontend-design", "teaching", "research"]) expect(names).toContain(name);
  });

  it("keeps each folder's front matter honest: name is the folder, one short description", () => {
    for (const skill of SKILL_BUNDLE) {
      const { fields } = parseSkill(readFileSync(join(SKILLS_DIR, skill.name, "SKILL.md"), "utf8"), skill.name);
      expect((fields as Record<string, string>).name).toBe(skill.name);
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skill.description.length).toBeLessThanOrEqual(160);
      expect(skill.description).not.toMatch(/\n/);
    }
  });

  it("rejects a SKILL.md without front matter", () => {
    expect(() => parseSkill("# No front matter", "x/SKILL.md")).toThrow(/front matter/);
  });

  it("records the frontend-design licence and attribution beside the skill, and never bundles them", () => {
    expect(existsSync(join(SKILLS_DIR, "frontend-design", "LICENSE.txt"))).toBe(true);
    expect(readFileSync(join(SKILLS_DIR, "frontend-design", "LICENSE.txt"), "utf8")).toMatch(/Apache License/);
    expect(readFileSync(join(SKILLS_DIR, "frontend-design", "NOTICE.md"), "utf8")).toMatch(/Anthropic/);
    const bundled = SKILL_BUNDLE.find((skill) => skill.name === "frontend-design")!;
    expect(bundled.resources.map((resource) => resource.path)).toEqual([]);
  });

  it("puts only names and descriptions in the system prompt", () => {
    const prompt = buildSystemPrompt({ timeZone: "UTC", now: Date.UTC(2026, 9, 4), permissions: "Ask first." });
    expect(prompt).toContain(skillIndexText());
    const research = SKILL_BUNDLE.find((skill) => skill.name === "research")!;
    expect(prompt).not.toContain(research.body.slice(0, 200));
  });
});

describe("load_skill", () => {
  it("returns the body, the authoring format for a type, and no resource list when there are none", async () => {
    const result = await loadSkillTool().execute({ name: "document" }, context);
    expect(result.content).toMatch(/^# /);
    expect(result.content).toMatch(/## Authoring format/);
    expect(result.content).not.toMatch(/## Resources/);
  });

  it("names a skill's resources and loads one on request", async () => {
    const tool = loadSkillTool();
    const body = await tool.execute({ name: "research" }, context);
    expect(body.content).toMatch(/## Resources[\s\S]*citation-styles\.md/);
    expect(body.content).not.toMatch(/## Authoring format/);
    const resource = await tool.execute(tool.parse!({ name: "research", resource: "citation-styles.md" }), context);
    expect(resource.content).toMatch(/# research \/ citation-styles\.md/);
    expect(resource.content).toMatch(/APA/);
  });

  it("refuses unknown skills and unknown resources with the valid names", () => {
    const tool = loadSkillTool();
    expect(() => tool.parse!({ name: "visualisation" })).toThrow(/name must be one of/);
    expect(() => loadSkillText("research", "nope.md")).toThrow(/Resources: citation-styles\.md/);
    expect(() => loadSkillText("document", "nope.md")).toThrow(/has no resources/);
  });
});
