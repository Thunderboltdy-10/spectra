/**
 * Shared Convex validators derived from the canonical study mode list.
 * This MUST stay in sync with src/lib/contracts/studyModes.ts.
 * The list is duplicated here because Convex functions cannot import from src/.
 */
import { v } from "convex/values";

export const STUDY_MODES = [
  "auto",
  "tutor",
  "marker",
  "exam",
  "draft_coach",
  "quiz",
  "flashcard",
  "research",
  "explain",
  "document",
  "general",
  "image",
] as const;

export type StudyMode = (typeof STUDY_MODES)[number];

/** Convex v.union validator for StudyMode */
export const vStudyMode = v.union(
  v.literal("auto"),
  v.literal("tutor"),
  v.literal("marker"),
  v.literal("exam"),
  v.literal("draft_coach"),
  v.literal("quiz"),
  v.literal("flashcard"),
  v.literal("research"),
  v.literal("explain"),
  v.literal("document"),
  v.literal("general"),
  v.literal("image"),
);

/** Convex v.union validator for ThinkingLevel */
export const vThinkingLevel = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
);

/** Convex v.union validator for RouterMode */
export const vRouterMode = v.union(
  v.literal("auto"),
  v.literal("manual"),
  v.literal("openrouter_auto"),
);

/** Convex v.union validator for Strictness */
export const vStrictness = v.union(
  v.literal("hard"),
  v.literal("medium"),
  v.literal("soft"),
);

/** Convex v.union validator for Role */
export const vRole = v.union(
  v.literal("student"),
  v.literal("teacher"),
  v.literal("admin"),
);

/** Convex v.union validator for resource scope */
export const vScope = v.union(
  v.literal("pack"),
  v.literal("personal"),
  v.literal("agent"),
);

/** Convex v.union validator for citation sourceType */
export const vSourceType = v.union(
  v.literal("pack"),
  v.literal("personal"),
  v.literal("agent"),
  v.literal("general"),
  v.literal("search"),
);

/** Citation validator object */
export const vCitation = v.object({
  filename: v.string(),
  page: v.optional(v.number()),
  sourceType: vSourceType,
  url: v.optional(v.string()),
  title: v.optional(v.string()),
  domain: v.optional(v.string()),
  resourceId: v.optional(v.id("resources")),
  snippet: v.optional(v.string()),
  relevanceScore: v.optional(v.number()),
  inlinePositions: v.optional(v.array(v.number())),
  reliabilityScore: v.optional(v.number()),
  reliabilityLabel: v.optional(v.union(v.literal("high"), v.literal("medium"), v.literal("low"))),
  reliabilityReason: v.optional(v.string()),
  publishedDate: v.optional(v.string()),
  favicon: v.optional(v.string()),
});

/** Route trace JSON blob validator */
export const vRouteTrace = v.optional(v.any());

/** Convex v.union validator for feedback category */
export const vFeedbackCategory = v.union(
  v.literal("bug"),
  v.literal("confusing"),
  v.literal("feature"),
  v.literal("safety"),
);

/** Convex v.union validator for feedback status */
export const vFeedbackStatus = v.union(
  v.literal("new"),
  v.literal("in_progress"),
  v.literal("shipped"),
);

/** Safely coerce to StudyMode, defaulting to "general" */
export function safeStudyMode(value: string): StudyMode {
  const set = new Set<string>(STUDY_MODES);
  if (set.has(value)) return value as StudyMode;
  console.warn(`[Convex] Invalid study mode "${value}", defaulting to "general"`);
  return "general";
}
