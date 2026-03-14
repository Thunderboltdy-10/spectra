import type { StudyMode } from "@/types";

export type RuntimeSkill = {
  id: string;
  name: string;
  summary: string;
  guidance: string[];
  appliesToModes?: StudyMode[];
  trigger?: RegExp;
};

const SKILL_LIBRARY: RuntimeSkill[] = [
  {
    id: "concise-chat",
    name: "Concise Chat",
    summary: "Keep low-signal prompts short and natural.",
    guidance: [
      "For greetings, thanks, and quick confirmations, keep replies to one short line.",
      "Avoid heavy structure unless the user explicitly asks for it.",
    ],
    trigger: /\b(hi|hello|hey|thanks|thank you|ok|okay|cool|nice)\b/i,
  },
  {
    id: "deep-research",
    name: "Deep Research",
    summary: "Structure deep research with evidence and uncertainty handling.",
    guidance: [
      "Separate established facts, inferred conclusions, and open uncertainties.",
      "Use source-backed claims and highlight weak evidence explicitly.",
    ],
    appliesToModes: ["research"],
  },
  {
    id: "source-reliability",
    name: "Source Reliability",
    summary: "Prioritize reliable sources and show confidence.",
    guidance: [
      "Prefer institutional, academic, and primary sources when available.",
      "Call out when a claim depends on lower-confidence sources.",
    ],
    trigger: /\b(source|citation|evidence|reliab|trust|verify)\b/i,
  },
  {
    id: "doc-polish",
    name: "Document Polish",
    summary: "Produce publishable document structure and hierarchy.",
    guidance: [
      "Use clear section hierarchy and consistent heading style.",
      "Prefer strong information architecture over filler text.",
    ],
    appliesToModes: ["document"],
  },
  {
    id: "presentation-storyline",
    name: "Presentation Storyline",
    summary: "Create strong narrative flow across slides.",
    guidance: [
      "Each slide should advance one clear message.",
      "Keep bullets concrete and avoid dense paragraphs.",
    ],
    appliesToModes: ["document"],
    trigger: /\b(slides?|pptx|presentation|deck)\b/i,
  },
  {
    id: "web-artifact",
    name: "Web Artifact",
    summary: "Generate web-ready outputs for interactive explanations.",
    guidance: [
      "Prefer semantic HTML structure and responsive layout hints.",
      "Use concise copy and visual hierarchy for clarity.",
    ],
    appliesToModes: ["document"],
    trigger: /\b(html|website|web page|interactive|diagram)\b/i,
  },
  {
    id: "quiz-quality",
    name: "Quiz Quality",
    summary: "Ensure quiz questions are valid and difficulty-consistent.",
    guidance: [
      "Each question must have one clearly correct option.",
      "Match question difficulty to the requested level.",
    ],
    appliesToModes: ["quiz", "exam"],
  },
  {
    id: "flashcard-design",
    name: "Flashcard Design",
    summary: "Generate memory-oriented flashcards with compact answers.",
    guidance: [
      "Use one concept per card and avoid multi-part prompts.",
      "Prefer short, testable back-side answers.",
    ],
    appliesToModes: ["flashcard"],
  },
  {
    id: "socratic-tutor",
    name: "Socratic Tutor",
    summary: "Guide learning with targeted questions and checkpoints.",
    guidance: [
      "Lead with one next step and one probing question.",
      "Surface likely misconceptions early.",
    ],
    appliesToModes: ["tutor", "explain"],
  },
  {
    id: "code-review",
    name: "Code Review",
    summary: "Prioritize correctness, regressions, and testability.",
    guidance: [
      "Focus findings on concrete risks with severity ordering.",
      "Prefer reproducible checks over speculative advice.",
    ],
    trigger: /\b(code|typescript|javascript|bug|test|refactor|review)\b/i,
  },
  {
    id: "plan-execution",
    name: "Plan Execution",
    summary: "Turn broad asks into ordered, verifiable actions.",
    guidance: [
      "State assumptions and blockers explicitly.",
      "Deliver actionable steps with clear completion criteria.",
    ],
    trigger: /\b(plan|roadmap|strategy|step by step|break down)\b/i,
  },
];

export function selectRuntimeSkills(params: {
  message: string;
  mode: StudyMode;
  maxSkills?: number;
}): RuntimeSkill[] {
  const maxSkills = Math.max(1, Math.min(8, params.maxSkills ?? 5));
  const hits: RuntimeSkill[] = [];
  const modeMatches = SKILL_LIBRARY.filter((skill) => skill.appliesToModes?.includes(params.mode));
  const triggerMatches = SKILL_LIBRARY.filter((skill) => skill.trigger?.test(params.message));
  const ordered = [...modeMatches, ...triggerMatches];
  const seen = new Set<string>();

  for (const skill of ordered) {
    if (seen.has(skill.id)) continue;
    seen.add(skill.id);
    hits.push(skill);
    if (hits.length >= maxSkills) break;
  }

  if (hits.length === 0) {
    return [SKILL_LIBRARY[0], SKILL_LIBRARY[10]].filter((skill): skill is RuntimeSkill => Boolean(skill));
  }

  return hits;
}

export function formatRuntimeSkillBlock(skills: RuntimeSkill[]) {
  if (skills.length === 0) return "";
  return [
    "=== ACTIVE RUNTIME SKILLS ===",
    ...skills.map((skill, index) => {
      const lines = [`${index + 1}. ${skill.name} (${skill.id})`, `Summary: ${skill.summary}`];
      for (const item of skill.guidance) {
        lines.push(`- ${item}`);
      }
      return lines.join("\n");
    }),
    "=== END ACTIVE RUNTIME SKILLS ===",
  ].join("\n");
}
