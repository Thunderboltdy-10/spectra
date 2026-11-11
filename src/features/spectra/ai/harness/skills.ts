import { SKILL_BUNDLE } from "../skills/bundle.generated";
import type { BundledSkill } from "../skills/types";
import { AUTHORING_FORMATS } from "./authoring/formats";
import { ToolInputError, type HarnessTool } from "./types";

/*
 * Skills are folders, src/features/spectra/ai/skills/<name>/SKILL.md, bundled at build time
 * (scripts/bundle-skills.mjs) so the server never reads the filesystem. The system prompt
 * carries only each skill's name and one line; load_skill returns the body, the type's
 * authoring format for artifact skills, and the names of the skill's resources.
 */

export type SkillIndexEntry = { name: string; description: string };

const SKILLS = new Map<string, BundledSkill>(SKILL_BUNDLE.map((skill) => [skill.name, skill]));

export const SKILL_INDEX: readonly SkillIndexEntry[] = SKILL_BUNDLE.map(({ name, description }) => ({ name, description }));

const SKILL_NAMES = SKILL_INDEX.map((entry) => entry.name);

export function skillIndexText() {
  return SKILL_INDEX.map((entry) => `- ${entry.name}: ${entry.description}`).join("\n");
}

function authoringFormat(name: string) {
  if (!(name in AUTHORING_FORMATS)) return "";
  const format = AUTHORING_FORMATS[name as keyof typeof AUTHORING_FORMATS];
  return [
    "## Authoring format",
    `Create (create_artifact content): ${format.create}`,
    `Edit (edit_artifact operations): ${format.edit}`,
    `Read parts with read_artifact: ${format.read}.`,
  ].join("\n");
}

function requireSkill(name: string) {
  const skill = SKILLS.get(name);
  if (!skill) throw new ToolInputError(`No skill is called "${name}". Skills: ${SKILL_NAMES.join(", ")}.`);
  return skill;
}

/** The skill's guide, its authoring format when it is an artifact type, and its resources. */
export function loadSkillText(name: string, resource?: string): string {
  const skill = requireSkill(name);
  if (resource) {
    const file = skill.resources.find((entry) => entry.path === resource);
    if (!file)
      throw new ToolInputError(
        skill.resources.length
          ? `The ${name} skill has no resource "${resource}". Resources: ${skill.resources.map((entry) => entry.path).join(", ")}.`
          : `The ${name} skill has no resources.`,
      );
    return `# ${name} / ${file.path}\n\n${file.content}`;
  }
  return [
    skill.body,
    authoringFormat(name),
    skill.resources.length
      ? `## Resources\nLoad one with load_skill {name: "${name}", resource}: ${skill.resources.map((entry) => entry.path).join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

type LoadSkillArgs = { name: string; resource?: string };

export function loadSkillTool(): HarnessTool<LoadSkillArgs> {
  return {
    name: "load_skill",
    description:
      "Load a skill: the craft guide for a kind of artifact, with the authoring format for artifact types. Load the matching skill before creating or substantially editing that kind of artifact, once per conversation. Pass resource to read one of the reference files the skill lists.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", enum: SKILL_NAMES },
        resource: { type: "string", description: "A reference file the skill lists, e.g. citation-styles.md." },
      },
      required: ["name"],
      additionalProperties: false,
    },
    effect: "read",
    label: (args) => `Loading the ${args.name} skill`,
    quiet: true,
    parse: (raw) => {
      if (typeof raw.name !== "string" || !SKILLS.has(raw.name))
        throw new ToolInputError(`name must be one of ${SKILL_NAMES.join(", ")}.`);
      if (raw.resource !== undefined && (typeof raw.resource !== "string" || !raw.resource.trim()))
        throw new ToolInputError("resource must be a file name the skill lists.");
      return { name: raw.name, ...(typeof raw.resource === "string" ? { resource: raw.resource.trim() } : {}) };
    },
    execute: async (args) => ({ ok: true, content: loadSkillText(args.name, args.resource) }),
  };
}
