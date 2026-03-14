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
  title?: string;
  domain?: string;
  resourceId?: string;
  snippet?: string;
};

export type Agent = {
  _id: string;
  name: string;
  description: string;
  systemPrompt: string;
  avatarEmoji: string;
  avatarIcon?: string;
  category: string;
  preferredModel?: string;
  preferredMode?: import("@/lib/contracts/studyModes").StudyMode;
  visibility: "public" | "private" | "shared";
  usageCount: number;
  creatorUserId: string;
  orgId: string;
  guidelinesSummary?: string;
  guidelinesTopicMap?: string[];
  resourceCount?: number;
  collaborators?: string[];
  createdAt: number;
  updatedAt: number;
};

export type ChatMessage = {
  _id: string;
  role: "user" | "assistant" | "system";
  content: string;
  enhancedContent?: string;
  thinkingContent?: string;
  attachments?: string[];
  attachmentResourceIds?: string[];
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

export type SpendingTier = "normal" | "expensive_blocked" | "cheap_only" | "free_only";

export type ToolBundle =
  | "none"
  | "memory"
  | "retrieval"
  | "search"
  | "artifact"
  | "skills"
  | "vision"
  | "multi_agent";

export type ArtifactFormat = "docx" | "pdf" | "pptx" | "html";

export type MemoryScope = "user_global" | "project" | "chat" | "none";
export type RetrievalScope = "pack" | "personal" | "agent" | "org";

export type ModeContract = {
  mode: import("@/lib/contracts/studyModes").StudyMode;
  pedagogy: string;
  outputFormat: string;
  responseDepth: "concise" | "standard" | "deep";
  escalationPolicy: "stay_simple" | "allow_tools" | "allow_multi_step";
  toolBundles: ToolBundle[];
  validator: "none" | "quiz" | "flashcard" | "research" | "document" | "leak_guard";
  retryPolicy: "none" | "single_bounded_retry";
};

export type AgentContract = {
  id?: string;
  name?: string;
  scope: "general" | "focused";
  instructionStyle: "compact" | "full";
  resourceScopes: RetrievalScope[];
  toolBundles: ToolBundle[];
  preferredCapabilities: Array<"vision" | "reasoning" | "code" | "search" | "image_generation">;
};

export type RoutePlan = {
  taskClass:
    | "simple_question"
    | "personalized_help"
    | "resource_grounded"
    | "current_info"
    | "artifact_generation"
    | "research"
    | "study_mode"
    | "multimodal";
  timeSensitive: boolean;
  hasAttachments: boolean;
  hasSelectedMode: boolean;
  hasSelectedAgent: boolean;
  personalTask: boolean;
  shouldConsultMemory: boolean;
  shouldWriteMemory: boolean;
  shouldUseSchoolResources: boolean;
  shouldUseWebSearch: boolean;
  shouldUseMultiStep: boolean;
  responseBudget: "simple" | "normal" | "deep";
  allowedToolBundles: ToolBundle[];
  retrievalScopes: RetrievalScope[];
  memoryScopes: MemoryScope[];
  candidateModelRequirements: {
    required: Array<"vision" | "reasoning" | "code" | "search" | "image_generation">;
    preferred: Array<"vision" | "reasoning" | "code" | "search" | "image_generation">;
  };
  requestedArtifactFormats: ArtifactFormat[];
  allowSubAgents: boolean;
  modeContract: ModeContract;
  agentContract?: AgentContract;
  schoolSoulVersion?: string;
};

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
  promptCategory?:
    | "code"
    | "math_science"
    | "creative"
    | "research"
    | "general"
    | "debate"
    | "comparison"
    | "synthesis"
    | "practical_application";
  questionType?: "what" | "why" | "how" | "evaluate" | "compare" | "other";
  isMultipart?: boolean;
  conversationLength?: number;
  previousModelUsed?: string;
  agentPreferredModel?: string;
  agentTopModels?: Array<{ modelId: string; score: number }>;
  modelCatalog?: Array<{
    modelId: string;
    name?: string;
    provider?: string;
    description?: string;
    contextLength?: number;
    inputCostPerM?: number;
    outputCostPerM?: number;
    tags?: string[];
    isFree?: boolean;
    costRating?: "low" | "medium" | "high";
    speedRating?: "low" | "medium" | "high";
    reasoningRating?: "low" | "medium" | "high";
    multimodalRating?: "none" | "basic" | "strong";
    capabilities?: {
      reasoning?: number;
      creative?: number;
      code?: number;
      vision?: number;
      speed?: number;
    };
  }>;
  modelRuntimeStats?: Record<string, { successCount: number; failureCount: number; avgLatencyMs?: number }>;
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
    questionType?: string;
    isMultipart?: boolean;
    needsSearch: boolean;
    needsRag: boolean;
    needsVision: boolean;
    needsTabular?: boolean;
    spendingTier: SpendingTier;
    hasAttachments: boolean;
    attachmentTypes: string[];
    promptEnhanced: boolean;
    messageLength: number;
    conversationLength?: number;
    previousModelUsed?: string;
    agentPreferredModel?: string;
  };
  candidates: RouteTraceCandidate[];
  selected: {
    modelId: string;
    reason: string;
  };
  routePlan?: RoutePlan;
  toolchain: string[];
  fallbacks: RouteTraceFallback[];
  routingDurationMs: number;
  totalDurationMs?: number;
  collaborators?: Array<{ role: string; model: string; tokensUsed: number; durationMs: number }>;
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
