import type { SkillMetadata, SkillWithBody } from "../contracts";

type SystemSkillDefinition = SkillMetadata & {
  load: () => Promise<{ body: string }>;
};

const definitions: readonly SystemSkillDefinition[] = [
  {
    id: "system:socratic-dialogue",
    name: "Socratic dialogue",
    purpose: "Guide a learner with adaptive questions and concise checkpoints.",
    triggerTerms: ["socratic", "quiz me", "guide me", "help me reason"],
    version: 1,
    source: "system",
    load: () => import("./socratic-dialogue"),
  },
  {
    id: "system:spaced-repetition",
    name: "Spaced repetition",
    purpose: "Build focused flashcards and a practical review sequence.",
    triggerTerms: [
      "spaced repetition",
      "flashcard",
      "active recall",
      "review plan",
    ],
    version: 1,
    source: "system",
    load: () => import("./spaced-repetition"),
  },
  {
    id: "system:diagram-guidance",
    name: "Diagram guidance",
    purpose: "Create readable Mermaid or SVG diagrams with editable structure.",
    triggerTerms: ["diagram", "flowchart", "mermaid", "svg", "concept map"],
    version: 1,
    source: "system",
    load: () => import("./diagram-guidance"),
  },
  {
    id: "system:latex-formatting",
    name: "LaTeX formatting",
    purpose: "Format mathematical reasoning with consistent, valid notation.",
    triggerTerms: ["latex", "equation", "derivation", "math formatting"],
    version: 1,
    source: "system",
    load: () => import("./latex-formatting"),
  },
];

export const SYSTEM_SKILL_METADATA: readonly SkillMetadata[] = definitions.map(
  ({ load: _load, ...metadata }) => metadata,
);

export async function readSystemSkill(
  id: string,
): Promise<SkillWithBody | null> {
  const definition = definitions.find((candidate) => candidate.id === id);
  if (!definition) return null;
  const loaded = await definition.load();
  const { load: _load, ...metadata } = definition;
  return { ...metadata, body: loaded.body };
}
