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
  snippet?: string;
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
  routeTrace?: RouteTrace;
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
  needsRag?: boolean;
  promptEnhanced?: boolean;
  promptCategory?: "code" | "math_science" | "creative" | "research" | "general";
};

export type RouteTraceCandidate = {
  modelId: string;
  allowed: boolean;
  score?: number;
  reason?: string;
  scoreBreakdown?: string[];
  eliminatedBecause?: string;
};

export type RouteTraceFallback = {
  fromModel: string;
  toModel: string;
  error: string;
  attemptIndex: number;
};

export type RouteTrace = {
  inputs: {
    routerMode: import("@/lib/contracts/studyModes").RouterMode;
    manualModel?: string;
    mode: import("@/lib/contracts/studyModes").StudyMode;
    thinkingLevel: import("@/lib/contracts/studyModes").ThinkingLevel;
    complexPrompt: boolean;
    promptCategory: string;
    needsSearch: boolean;
    needsRag: boolean;
    needsVision: boolean;
    spendingTier: SpendingTier;
    hasAttachments: boolean;
    attachmentTypes: string[];
    promptEnhanced: boolean;
    messageLength: number;
  };
  candidates: RouteTraceCandidate[];
  selected: {
    modelId: string;
    reason: string;
  };
  toolchain: string[];
  fallbacks: RouteTraceFallback[];
  routingDurationMs: number;
  totalDurationMs?: number;
};

export type ModelRouteOutput = {
  primaryModel: string;
  fallbackModels: string[];
  verificationModel?: string;
  reason: string;
  autoEnhanced: boolean;
  searchEnabled: boolean;
};

export type ModelRouteResult = ModelRouteOutput & { trace: RouteTrace };

export type PackGuidelines = {
  summary: string;
  topicMap: string[];
  rubricHints: string[];
  misconceptions: string[];
};
