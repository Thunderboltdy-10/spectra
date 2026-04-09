import fs from "node:fs";
import path from "node:path";
import type { StudyMode } from "@/types";

export type SkillCategory = "visualization" | "code" | "flashcard" | "research" | "writing" | "math";

export type RegisteredSkill = {
  id: string;
  name: string;
  category: SkillCategory;
  summary: string;
  guidance: string[];
  prompt?: string;
  appliesToModes?: StudyMode[];
  trigger?: RegExp;
  requiredToolBundles?: Array<"skills" | "search" | "retrieval" | "memory" | "artifact" | "multi_agent">;
  sourcePath?: string;
};

const SKILLS_DIR = path.join(process.cwd(), "public", "skills");

function readSkillMarkdown(relativeName: string) {
  const absolutePath = path.join(SKILLS_DIR, relativeName);
  try {
    if (!fs.existsSync(absolutePath)) return undefined;
    const raw = fs.readFileSync(absolutePath, "utf8").trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

function markdownToGuidance(markdown?: string) {
  if (!markdown) return [];
  return markdown
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .slice(0, 8);
}

const COMMUNITY_SKILLS: RegisteredSkill[] = [
  {
    id: "spectra-visual-skill",
    name: "Spectra Visual Skill",
    category: "visualization",
    summary: "Produce Spectra-native SVG and sandboxed interactive visuals that dual-render to thread and workspace.",
    guidance: markdownToGuidance(readSkillMarkdown("spectra-visual-skill.md")),
    prompt: readSkillMarkdown("spectra-visual-skill.md"),
    appliesToModes: ["document", "research", "explain", "general", "tutor"],
    trigger: /\b(diagram|chart|visual|visualize|timeline|concept map|mind map|svg|flowchart|schematic|infographic|interactive|simulation|render)\b/i,
    requiredToolBundles: ["skills", "artifact"],
    sourcePath: "/public/skills/spectra-visual-skill.md",
  },
  {
    id: "community-mermaid-diagrams",
    name: "Mermaid Diagram Generation",
    category: "visualization",
    summary: "Generate readable Mermaid diagrams for processes, systems, and timelines.",
    guidance: markdownToGuidance(readSkillMarkdown("mermaid-diagrams.md")),
    appliesToModes: ["research", "explain", "document", "general", "tutor"],
    trigger: /\b(diagram|flowchart|workflow|timeline|architecture|mermaid)\b/i,
    requiredToolBundles: ["skills"],
    sourcePath: "/public/skills/mermaid-diagrams.md",
  },
  {
    id: "community-latex-math-formatting",
    name: "LaTeX Math Formatting",
    category: "math",
    summary: "Present math using clean LaTeX with step clarity.",
    guidance: markdownToGuidance(readSkillMarkdown("latex-math-formatting.md")),
    appliesToModes: ["tutor", "explain", "exam", "quiz", "flashcard"],
    trigger: /\b(integral|derivative|equation|proof|matrix|latex|math)\b/i,
    requiredToolBundles: ["skills"],
    sourcePath: "/public/skills/latex-math-formatting.md",
  },
  {
    id: "community-interactive-svg",
    name: "Interactive SVG Creation",
    category: "visualization",
    summary: "Create SVG artifacts that are structured, responsive, and educational.",
    guidance: markdownToGuidance(readSkillMarkdown("interactive-svg.md")),
    appliesToModes: ["document", "research", "explain", "general"],
    trigger: /\b(svg|vector|chart|plot|visualize)\b/i,
    requiredToolBundles: ["skills", "artifact"],
    sourcePath: "/public/skills/interactive-svg.md",
  },
  {
    id: "community-spaced-repetition",
    name: "Spaced Repetition Optimization",
    category: "flashcard",
    summary: "Optimize recall scheduling and card quality for long-term retention.",
    guidance: markdownToGuidance(readSkillMarkdown("spaced-repetition-optimizer.md")),
    appliesToModes: ["flashcard", "quiz", "exam", "tutor"],
    trigger: /\b(flashcard|revision|recall|memory|spaced repetition|anki)\b/i,
    requiredToolBundles: ["skills", "memory"],
    sourcePath: "/public/skills/spaced-repetition-optimizer.md",
  },
  {
    id: "community-socratic-dialogue",
    name: "Socratic Dialogue Patterns",
    category: "writing",
    summary: "Use targeted probing questions without sounding formulaic.",
    guidance: markdownToGuidance(readSkillMarkdown("socratic-dialogue.md")),
    appliesToModes: ["tutor", "explain", "general"],
    trigger: /\b(help me understand|guide me|socratic|why|how)\b/i,
    requiredToolBundles: ["skills"],
    sourcePath: "/public/skills/socratic-dialogue.md",
  },
];

const BUILTIN_SKILLS: RegisteredSkill[] = [
  {
    id: "concise-chat",
    name: "Concise Chat",
    category: "writing",
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
    category: "research",
    summary: "Structure deep research with evidence and uncertainty handling.",
    guidance: [
      "Separate established facts, inferred conclusions, and open uncertainties.",
      "Use source-backed claims and highlight weak evidence explicitly.",
    ],
    appliesToModes: ["research"],
    requiredToolBundles: ["search"],
  },
  {
    id: "source-reliability",
    name: "Source Reliability",
    category: "research",
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
    category: "writing",
    summary: "Produce publishable document structure and hierarchy.",
    guidance: [
      "Use clear section hierarchy and consistent heading style.",
      "Prefer strong information architecture over filler text.",
    ],
    appliesToModes: ["document"],
  },
  {
    id: "quiz-quality",
    name: "Quiz Quality",
    category: "flashcard",
    summary: "Ensure quiz questions are valid and difficulty-consistent.",
    guidance: [
      "Each question must have one clearly correct option.",
      "Match question difficulty to the requested level.",
    ],
    appliesToModes: ["quiz", "exam"],
  },
  {
    id: "code-review",
    name: "Code Review",
    category: "code",
    summary: "Prioritize correctness, regressions, and testability.",
    guidance: [
      "Focus findings on concrete risks with severity ordering.",
      "Prefer reproducible checks over speculative advice.",
    ],
    trigger: /\b(code|typescript|javascript|bug|test|refactor|review)\b/i,
  },
];

const SKILL_LIBRARY: RegisteredSkill[] = [...BUILTIN_SKILLS, ...COMMUNITY_SKILLS].map((skill) => ({
  ...skill,
  guidance: skill.guidance.length > 0
    ? skill.guidance
    : ["Follow best practices for this skill category and keep output actionable."],
  prompt: skill.prompt,
}));

export function listRegisteredSkills() {
  return SKILL_LIBRARY.slice();
}

export function resolveSkillsForContext(params: {
  message: string;
  mode: StudyMode;
  allowedToolBundles?: string[];
  maxSkills?: number;
}) {
  const maxSkills = Math.max(1, Math.min(10, params.maxSkills ?? 5));
  const bundles = new Set(params.allowedToolBundles ?? []);
  const normalizedMessage = params.message.trim();
  const hasVisualIntent = /\b(diagram|chart|visual|visualize|timeline|concept map|mind map|svg|flowchart|schematic|infographic|interactive|simulation|render)\b/i.test(normalizedMessage);
  const filtered = SKILL_LIBRARY.filter((skill) => {
    if (!skill.requiredToolBundles || skill.requiredToolBundles.length === 0) return true;
    return skill.requiredToolBundles.every((bundle) => bundles.has(bundle));
  });

  const modeMatches = filtered.filter((skill) =>
    skill.appliesToModes?.includes(params.mode)
    && (skill.id !== "spectra-visual-skill" || hasVisualIntent)
  );
  const triggerMatches = filtered.filter((skill) => skill.trigger?.test(params.message));
  const ordered = [...modeMatches, ...triggerMatches];
  const seen = new Set<string>();
  const selected: RegisteredSkill[] = [];

  for (const skill of ordered) {
    if (seen.has(skill.id)) continue;
    seen.add(skill.id);
    selected.push(skill);
    if (selected.length >= maxSkills) break;
  }

  if (selected.length > 0) return selected;

  const fallback = filtered.filter((skill) => skill.id === "concise-chat" || skill.id === "community-socratic-dialogue");
  if (fallback.length > 0) return fallback.slice(0, maxSkills);
  return filtered.slice(0, maxSkills);
}
