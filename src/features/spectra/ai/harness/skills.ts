import { loadArtifactSkill } from "../../artifacts/registry";
import { artifactDesignGuidance } from "../../artifacts/skills/artifact-design";
import { visualisationDesignGuide } from "../../artifacts/skills/visualisation-design";
import type { ArtifactSkill } from "../../artifacts/types";
import { AUTHORING_FORMATS } from "./authoring/formats";
import { ToolInputError, type HarnessTool } from "./types";

/*
 * Skills are the per-type craft guides in src/features/spectra/artifacts/skills.
 * The system prompt carries only an index (name and one line); load_skill
 * returns the whole guide with the type's authoring format.
 */

export type SkillIndexEntry = { name: string; description: string };

export const SKILL_INDEX: SkillIndexEntry[] = [
  { name: "document", description: "Notes, essays, guides, reports and handouts in Markdown." },
  { name: "presentation", description: "Slide decks: narrative, layouts, charts, speaker notes." },
  { name: "sheets", description: "Workbooks: tables, formulas, formatting and charts." },
  { name: "whiteboard", description: "Diagrams, cycles, mind maps and flows as nodes and connectors." },
  { name: "flashcard_deck", description: "Active-recall cards, including cloze cards." },
  { name: "quiz", description: "Practice questions with checked answers and explanations." },
  { name: "planner_task", description: "One task with a due date, priority and subtasks." },
  { name: "code", description: "Code projects and runnable browser, React or Python visualisations." },
  { name: "agent", description: "Custom agents: purpose, instructions, tone and routing." },
  { name: "design", description: "Visual design judgement for any artifact: hierarchy, density, review." },
  { name: "visualisation", description: "Interactive educational visualisations and simulations in code." },
];

export function skillIndexText() {
  return SKILL_INDEX.map((entry) => `- ${entry.name}: ${entry.description}`).join("\n");
}

function section(title: string, lines: readonly string[]) {
  return lines.length ? [`## ${title}`, ...lines.map((line) => `- ${line}`)].join("\n") : "";
}

function renderTypeSkill(name: keyof typeof AUTHORING_FORMATS, skill: ArtifactSkill) {
  const format = AUTHORING_FORMATS[name];
  return [
    `# ${name} skill`,
    skill.purpose,
    `## Authoring format\nCreate (create_artifact content): ${format.create}\nEdit (edit_artifact operations): ${format.edit}\nRead parts with read_artifact: ${format.read}.\nThe authoring format above is what the tools take; where the guidance below names internal fields, express the same intent in this format.`,
    section("When it fits", skill.createWhen),
    section("Craft", skill.operations),
    section("Keep intact", skill.preservationRules),
    section("Check before finishing", skill.validation),
    ...(skill.specialistGuides?.length
      ? [section("Specialist guidance", skill.specialistGuides.flatMap((guide) => [`${guide.trigger}`, ...guide.instructions]))]
      : []),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function loadSkillText(name: string): Promise<string> {
  if (name === "design") return [`# design skill`, ...artifactDesignGuidance.map((line) => `- ${line}`)].join("\n");
  if (name === "visualisation")
    return [`# visualisation skill`, visualisationDesignGuide.trigger, ...visualisationDesignGuide.instructions.map((line) => `- ${line}`)].join("\n");
  if (!(name in AUTHORING_FORMATS)) throw new ToolInputError(`No skill is called "${name}". Skills: ${SKILL_INDEX.map((entry) => entry.name).join(", ")}.`);
  const skill = await loadArtifactSkill(name);
  return renderTypeSkill(name as keyof typeof AUTHORING_FORMATS, skill);
}

export function loadSkillTool(): HarnessTool<{ name: string }> {
  return {
    name: "load_skill",
    description:
      "Load a skill: the full craft guide and authoring format for a kind of work. Load the matching skill before creating or substantially editing that kind of work, once per run.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", enum: SKILL_INDEX.map((entry) => entry.name) } },
      required: ["name"],
      additionalProperties: false,
    },
    effect: "read",
    label: () => "Getting ready",
    parse: (raw) => {
      if (typeof raw.name !== "string" || !SKILL_INDEX.some((entry) => entry.name === raw.name))
        throw new ToolInputError(`name must be one of ${SKILL_INDEX.map((entry) => entry.name).join(", ")}.`);
      return { name: raw.name };
    },
    execute: async (args) => ({ ok: true, content: await loadSkillText(args.name), doneLabel: "Got ready" }),
  };
}
