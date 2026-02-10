/**
 * All types re-exported from contracts (single source of truth)
 * and domain-specific frontend types.
 */
export type {
  StudyMode,
  ThinkingLevel,
  RouterMode,
  Strictness,
  Role,
} from "@/lib/contracts/studyModes";

export {
  STUDY_MODES,
  THINKING_LEVELS,
  ROUTER_MODES,
  STRICTNESS_LEVELS,
  ROLES,
  isValidStudyMode,
  safeStudyMode,
} from "@/lib/contracts/studyModes";

export type Citation = {
  filename: string;
  page?: number;
  sourceType: "pack" | "personal" | "general" | "search";
  url?: string;
  resourceId?: string;
};

export type Agent = {
  _id: string;
  name: string;
  description: string;
  systemPrompt: string;
  avatarEmoji: string;
  category: string;
  preferredModel?: string;
  preferredMode?: import("@/lib/contracts/studyModes").StudyMode;
  visibility: "public" | "private";
  usageCount: number;
  creatorUserId: string;
  orgId: string;
  guidelinesSummary?: string;
  guidelinesTopicMap?: string[];
  resourceCount?: number;
  createdAt: number;
  updatedAt: number;
};

export type ChatMessage = {
  _id: string;
  role: "user" | "assistant" | "system";
  content: string;
  enhancedContent?: string;
  mode: import("@/lib/contracts/studyModes").StudyMode;
  citations: Citation[];
  modelRequested?: string;
  modelUsed?: string;
  whyThisResponse?: string;
  usageIn?: number;
  usageOut?: number;
  verificationPassed?: boolean;
  createdAt: number;
};

export type SpendingTier = "normal" | "cheap_only" | "free_only";

export type ModelRouteInput = {
  mode: import("@/lib/contracts/studyModes").StudyMode;
  thinkingLevel: import("@/lib/contracts/studyModes").ThinkingLevel;
  hasAttachments: boolean;
  attachmentTypes: string[];
  messageLength: number;
  teacherStrictness: import("@/lib/contracts/studyModes").Strictness;
  routerMode: import("@/lib/contracts/studyModes").RouterMode;
  manualModel?: string;
  studentSeemsStuck: boolean;
  spendingTier: SpendingTier;
  needsSearch: boolean;
  promptCategory?: "code" | "math_science" | "creative" | "research" | "general";
};

export type ModelRouteOutput = {
  primaryModel: string;
  fallbackModels: string[];
  verificationModel?: string;
  reason: string;
  autoEnhanced: boolean;
  searchEnabled: boolean;
};

export type PackGuidelines = {
  summary: string;
  topicMap: string[];
  rubricHints: string[];
  misconceptions: string[];
};
