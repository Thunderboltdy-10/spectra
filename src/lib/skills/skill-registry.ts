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
  priority?: number;
  audience?: Array<"student" | "teacher" | "admin" | "general">;
  preferredAssignmentLevels?: Array<"L0" | "L1" | "L2" | "L3" | "L4">;
  requiredToolBundles?: Array<"skills" | "search" | "retrieval" | "memory" | "artifact" | "multi_agent">;
  sourcePath?: string;
};

const SKILLS_DIR = path.join(process.cwd(), "public", "skills");
const ONLINE_SKILLS_DIR = path.join(SKILLS_DIR, "online");
const ONLINE_MANIFEST_PATH = path.join(ONLINE_SKILLS_DIR, "manifest.json");

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

function parseCategory(value: unknown): SkillCategory {
  if (value === "visualization" || value === "code" || value === "flashcard" || value === "research" || value === "writing" || value === "math") {
    return value;
  }
  return "research";
}

function parseStudyModes(value: unknown): StudyMode[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const modes = value.filter((entry): entry is StudyMode => typeof entry === "string") as StudyMode[];
  return modes.length > 0 ? modes : undefined;
}

function parseToolBundles(value: unknown): RegisteredSkill["requiredToolBundles"] {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set(["skills", "search", "retrieval", "memory", "artifact", "multi_agent"]);
  const bundles = value.filter((entry): entry is "skills" | "search" | "retrieval" | "memory" | "artifact" | "multi_agent" => typeof entry === "string" && allowed.has(entry));
  return bundles.length > 0 ? bundles : undefined;
}

function parseAssignmentLevels(value: unknown): RegisteredSkill["preferredAssignmentLevels"] {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set(["L0", "L1", "L2", "L3", "L4"]);
  const levels = value.filter((entry): entry is "L0" | "L1" | "L2" | "L3" | "L4" => typeof entry === "string" && allowed.has(entry));
  return levels.length > 0 ? levels : undefined;
}

function parseAudience(value: unknown): RegisteredSkill["audience"] {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set(["student", "teacher", "admin", "general"]);
  const audience = value.filter((entry): entry is "student" | "teacher" | "admin" | "general" => typeof entry === "string" && allowed.has(entry));
  return audience.length > 0 ? audience : undefined;
}

function compileTrigger(value: unknown): RegExp | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return new RegExp(value, "i");
  } catch {
    return undefined;
  }
}

function loadDownloadedOnlineSkills(): RegisteredSkill[] {
  try {
    if (!fs.existsSync(ONLINE_MANIFEST_PATH)) return [];
    const raw = fs.readFileSync(ONLINE_MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw) as {
      skills?: Array<{
        id?: unknown;
        name?: unknown;
        category?: unknown;
        summary?: unknown;
        guidance?: unknown;
        prompt?: unknown;
        appliesToModes?: unknown;
        trigger?: unknown;
        priority?: unknown;
        audience?: unknown;
        preferredAssignmentLevels?: unknown;
        requiredToolBundles?: unknown;
        localPath?: unknown;
        sourceUrl?: unknown;
      }>;
    };
    const records = Array.isArray(parsed.skills) ? parsed.skills : [];

    return records.flatMap((record) => {
      const id = typeof record.id === "string" ? record.id.trim() : "";
      if (!id) return [];
      const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : id;
      const category = parseCategory(record.category);
      const summary = typeof record.summary === "string" && record.summary.trim()
        ? record.summary.trim()
        : "Online skill";
      const localPath = typeof record.localPath === "string" ? record.localPath.trim() : "";
      const absolutePath = localPath
        ? path.join(SKILLS_DIR, localPath.replace(/^\/?public\/skills\//, ""))
        : path.join(ONLINE_SKILLS_DIR, `${id}.md`);
      const markdown = (() => {
        try {
          if (!fs.existsSync(absolutePath)) return undefined;
          const text = fs.readFileSync(absolutePath, "utf8").trim();
          return text.length > 0 ? text : undefined;
        } catch {
          return undefined;
        }
      })();
      const guidance = Array.isArray(record.guidance)
        ? (record.guidance as unknown[])
            .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
            .slice(0, 8)
        : markdownToGuidance(markdown);
      const sourcePath = localPath || `/public/skills/online/${id}.md`;

      return [{
        id,
        name,
        category,
        summary,
        guidance,
        prompt: typeof record.prompt === "string" ? record.prompt : markdown,
        appliesToModes: parseStudyModes(record.appliesToModes),
        trigger: compileTrigger(record.trigger),
        priority: typeof record.priority === "number" && Number.isFinite(record.priority) ? record.priority : 3,
        audience: parseAudience(record.audience),
        preferredAssignmentLevels: parseAssignmentLevels(record.preferredAssignmentLevels),
        requiredToolBundles: parseToolBundles(record.requiredToolBundles),
        sourcePath,
      } satisfies RegisteredSkill];
    });
  } catch {
    return [];
  }
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
    priority: 1,
    preferredAssignmentLevels: ["L0", "L1"],
    audience: ["general"],
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
    priority: 5,
    preferredAssignmentLevels: ["L2", "L3", "L4"],
    audience: ["student", "teacher", "general"],
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
    priority: 4,
    preferredAssignmentLevels: ["L1", "L2", "L3", "L4"],
    audience: ["student", "teacher", "general"],
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
    priority: 3,
    preferredAssignmentLevels: ["L1", "L2", "L3", "L4"],
    audience: ["student", "teacher", "general"],
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
    priority: 4,
    preferredAssignmentLevels: ["L1", "L2", "L3"],
    audience: ["student", "teacher", "general"],
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
    priority: 4,
    preferredAssignmentLevels: ["L2", "L3", "L4"],
    audience: ["teacher", "general"],
  },
];

const DOWNLOADED_ONLINE_SKILLS = loadDownloadedOnlineSkills();

const SKILL_LIBRARY: RegisteredSkill[] = Array.from(
  new Map(
    [...BUILTIN_SKILLS, ...COMMUNITY_SKILLS, ...DOWNLOADED_ONLINE_SKILLS]
      .map((skill) => [skill.id, {
        ...skill,
        guidance: skill.guidance.length > 0
          ? skill.guidance
          : ["Follow best practices for this skill category and keep output actionable."],
        prompt: skill.prompt,
      } satisfies RegisteredSkill]),
  ).values(),
);

export function listRegisteredSkills() {
  return SKILL_LIBRARY.slice();
}

export function resolveSkillsForContext(params: {
  message: string;
  mode: StudyMode;
  allowedToolBundles?: string[];
  assignmentLevel?: "L0" | "L1" | "L2" | "L3" | "L4";
  hasAgent?: boolean;
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

  const assignmentLevel = params.assignmentLevel ?? "L1";
  const scoreSkill = (skill: RegisteredSkill) => {
    let score = skill.priority ?? 0;
    if (skill.appliesToModes?.includes(params.mode) && (skill.id !== "spectra-visual-skill" || hasVisualIntent)) score += 4;
    if (skill.trigger?.test(params.message)) score += 3;
    if (skill.preferredAssignmentLevels?.includes(assignmentLevel)) score += 2;
    if (params.hasAgent && skill.category === "research") score += 1;
    return score;
  };

  const ordered = filtered
    .map((skill) => ({ skill, score: scoreSkill(skill) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || (b.skill.priority ?? 0) - (a.skill.priority ?? 0) || a.skill.name.localeCompare(b.skill.name))
    .map((entry) => entry.skill);

  const seen = new Set<string>();
  const selected: RegisteredSkill[] = [];

  for (const skill of ordered) {
    if (seen.has(skill.id)) continue;
    seen.add(skill.id);
    selected.push(skill);
    if (selected.length >= maxSkills) break;
  }

  if (selected.length > 0) return selected;

  const fallback = filtered
    .filter((skill) => skill.id === "concise-chat" || skill.id === "community-socratic-dialogue")
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  if (fallback.length > 0) return fallback.slice(0, maxSkills);
  return filtered
    .slice()
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name))
    .slice(0, maxSkills);
}
