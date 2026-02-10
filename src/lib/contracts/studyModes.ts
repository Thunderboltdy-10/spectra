/**
 * SINGLE SOURCE OF TRUTH for study modes.
 * Every validator, type, and UI reference MUST derive from this file.
 * Adding a mode here automatically makes it available everywhere.
 */

export const STUDY_MODES = [
  "tutor",
  "marker",
  "exam",
  "draft_coach",
  "quiz",
  "flashcard",
  "research",
  "explain",
  "general",
] as const;

export type StudyMode = (typeof STUDY_MODES)[number];

const STUDY_MODE_SET = new Set<string>(STUDY_MODES);

/** Runtime guard: returns true if value is a valid StudyMode */
export function isValidStudyMode(value: unknown): value is StudyMode {
  return typeof value === "string" && STUDY_MODE_SET.has(value);
}

/**
 * Safely coerce an unknown value to StudyMode.
 * Returns fallback ("general") if invalid and logs a warning.
 */
export function safeStudyMode(value: unknown, context?: string): StudyMode {
  if (isValidStudyMode(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    console.warn(
      `[StudyMode] Invalid mode "${value}" coerced to "general"${context ? ` (context: ${context})` : ""}`,
    );
  }
  return "general";
}

export const THINKING_LEVELS = ["low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const ROUTER_MODES = ["auto", "manual", "openrouter_auto"] as const;
export type RouterMode = (typeof ROUTER_MODES)[number];

export const STRICTNESS_LEVELS = ["hard", "medium", "soft"] as const;
export type Strictness = (typeof STRICTNESS_LEVELS)[number];

export const ROLES = ["student", "teacher", "admin"] as const;
export type Role = (typeof ROLES)[number];
