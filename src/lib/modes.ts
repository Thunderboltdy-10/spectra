import type { StudyMode } from "@/types";

export type ModeConfig = {
  key: StudyMode;
  label: string;
  icon: string;
  color: string;
  cssVar: string;
  description: string;
};

export const MODE_REGISTRY: Record<StudyMode, ModeConfig> = {
  auto: {
    key: "auto",
    label: "Auto",
    icon: "Sparkles",
    color: "#0ea5a3",
    cssVar: "var(--accent-cyan)",
    description: "AI automatically selects the best mode for your message",
  },
  tutor: {
    key: "tutor",
    label: "Learn",
    icon: "GraduationCap",
    color: "#3b82f6",
    cssVar: "var(--mode-tutor)",
    description: "Socratic method: guided discovery through targeted questioning",
  },
  marker: {
    key: "marker",
    label: "Review",
    icon: "ClipboardCheck",
    color: "#f59e0b",
    cssVar: "var(--mode-marker)",
    description: "Rubric-based formative feedback aligned to Bloom's taxonomy",
  },
  exam: {
    key: "exam",
    label: "Practice",
    icon: "Timer",
    color: "#ef4444",
    cssVar: "var(--mode-exam)",
    description: "Retrieval practice under timed constraints (testing effect)",
  },
  draft_coach: {
    key: "draft_coach",
    label: "Coach",
    icon: "PenLine",
    color: "#8b5cf6",
    cssVar: "var(--mode-draft_coach)",
    description: "Process-writing coaching with iterative revision cycles",
  },
  quiz: {
    key: "quiz",
    label: "Quiz",
    icon: "CircleHelp",
    color: "#10b981",
    cssVar: "var(--mode-quiz)",
    description: "Active recall checkpoints with feedback for retention",
  },
  flashcard: {
    key: "flashcard",
    label: "Flashcards",
    icon: "Layers",
    color: "#06b6d4",
    cssVar: "var(--mode-flashcard)",
    description: "Dual-coding flashcards (visual + verbal memory cues)",
  },
  research: {
    key: "research",
    label: "Research",
    icon: "Search",
    color: "#6366f1",
    cssVar: "var(--mode-research)",
    description: "Evidence synthesis with explicit source evaluation",
  },
  explain: {
    key: "explain",
    label: "Explain",
    icon: "Lightbulb",
    color: "#f97316",
    cssVar: "var(--mode-explain)",
    description: "Feynman technique: teach-to-learn explanations",
  },
  general: {
    key: "general",
    label: "Chat",
    icon: "MessageCircle",
    color: "#6b7280",
    cssVar: "var(--mode-general)",
    description: "Open dialogue for unstructured exploration",
  },
  image: {
    key: "image",
    label: "Image",
    icon: "ImagePlus",
    color: "#0f766e",
    cssVar: "var(--mode-image)",
    description: "Generate images from text prompts",
  },
};

export const ALL_MODES = Object.values(MODE_REGISTRY);

export const AVAILABLE_MODES = new Set<StudyMode>([
  "auto",
  "tutor",
  "quiz",
  "flashcard",
  "research",
  "general",
  "image",
]);

export const COMING_SOON_MODES = new Set<StudyMode>([
  "marker",
  "exam",
  "draft_coach",
  "explain",
]);

export function isModeAvailable(mode: StudyMode): boolean {
  return AVAILABLE_MODES.has(mode);
}

export function getModeConfig(mode: StudyMode): ModeConfig {
  return MODE_REGISTRY[mode];
}
