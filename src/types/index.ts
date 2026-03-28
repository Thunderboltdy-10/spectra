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
  sourceType: "pack" | "personal" | "agent" | "general" | "search";
  url?: string;
  title?: string;
  domain?: string;
  resourceId?: string;
  snippet?: string;
  relevanceScore?: number;
  inlinePositions?: number[];
  reliabilityScore?: number;
  reliabilityLabel?: "high" | "medium" | "low";
  reliabilityReason?: string;
  publishedDate?: string;
  favicon?: string;
};

export type ClarificationOption = {
  id: string;
  label: string;
  description?: string;
};

export type ClarificationQuestion = {
  id: string;
  text: string;
  type: "free_text" | "single_choice" | "multi_choice" | "confirmation";
  options?: ClarificationOption[];
};

export type ClarificationBlock = {
  context: string;
  questions: ClarificationQuestion[];
};

export type Agent = {
  _id: string;
  name: string;
  description: string;
  subjectArea?: string;
  gradeLevel?: string;
  systemPrompt: string;
  avatarEmoji: string;
  avatarIcon?: string;
  category: string;
  preferredModel?: string;
  preferredMode?: import("@/lib/contracts/studyModes").StudyMode;
  allowedTools?: string[];
  modelAllowlist?: string[];
  modelDenylist?: string[];
  accessLevel?: "private" | "class" | "school";
  moderationStatus?: "approved" | "pending";
  isStudentCreated?: boolean;
  visibility: "public" | "private" | "shared";
  usageCount: number;
  lastUsedAt?: number;
  creatorUserId: string;
  orgId: string;
  guidelinesSummary?: string;
  guidelinesTopicMap?: string[];
  guidelinesRubricHints?: string[];
  guidelinesMisconceptions?: string[];
  guidelinesVocabulary?: string[];
  guidelinesExamStructure?: string[];
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

export type AssignmentLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export type MemoryScope = "user_global" | "workstream" | "project" | "chat" | "none";
export type RetrievalScope = "pack" | "personal" | "agent" | "org";

export type WorkstreamAssignment = {
  status: "none" | "assigned" | "suggested" | "new_candidate";
  workstreamId?: string;
  title?: string;
  confidence: number;
  reason: string;
  signals: string[];
  alternateWorkstreamId?: string;
  alternateTitle?: string;
  candidateIds?: string[];
};

export type ThreadStrategy = {
  action: "continue" | "fork" | "new_chat";
  confidence: number;
  reason: string;
  contextWindowPressure: number;
  topicContinuity: number;
  timeGapHours?: number;
  turnsSinceCompaction?: number;
};

export type ContextWindowStrategy = {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  desiredContextTokens: number;
  minimumContextTokens: number;
  compactionSuggested: boolean;
  preferLargeContext: boolean;
  contextWindowPressure: number;
  rationale: string[];
};

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
    | "multimodal"
    | "workstream_deep";
  assignmentLevel: AssignmentLevel;
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
  tokenBudgetTarget: {
    systemPrompt: number;
    memory: number;
    artifacts: number;
    search: number;
    total: number;
  };
  allowedToolBundles: ToolBundle[];
  retrievalScopes: RetrievalScope[];
  memoryScopes: MemoryScope[];
  workstreamAssignment: WorkstreamAssignment;
  threadStrategy: ThreadStrategy;
  contextWindowStrategy: ContextWindowStrategy;
  candidateModelRequirements: {
    required: Array<"vision" | "reasoning" | "code" | "search" | "image_generation">;
    preferred: Array<"vision" | "reasoning" | "code" | "search" | "image_generation">;
  };
  requestedArtifactFormats: ArtifactFormat[];
  allowSubAgents: boolean;
  modeContract: ModeContract;
  agentContract?: AgentContract;
  schoolSoulVersion?: string;
  intentSignals?: {
    requestedModelPhrase?: string;
    requestedOrchestration?: boolean;
  };
  searchPlan?: {
    strategy: "none" | "search" | "search_extract" | "extract_url" | "crawl" | "research";
    trigger:
      | "none"
      | "time_sensitive"
      | "explicit_search"
      | "research_mode"
      | "deep_research"
      | "read_url"
      | "crawl_request";
    query?: string;
    targetUrl?: string;
    maxResults?: number;
    maxExtractResults?: number;
    subqueries?: string[];
  };
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

export type RouteTracePhaseStatus = "planned" | "running" | "completed" | "skipped" | "failed";

export type RouteTracePhase = {
  id: string;
  label: string;
  status: RouteTracePhaseStatus;
  detail?: string;
  thinkingLevel?: import("@/lib/contracts/studyModes").ThinkingLevel;
  model?: string;
  startedAt?: number;
  finishedAt?: number;
};

export type RouteTraceSubcall = {
  id: string;
  phaseId: string;
  label: string;
  endpoint: "chat.completions" | "embeddings";
  status: "ok" | "error";
  modelRequested?: string;
  modelUsed?: string;
  provider?: string;
  lane?: "stable" | "fresh" | "challenger";
  inputTokens?: number;
  outputTokens?: number;
  costCents?: number;
  durationMs?: number;
  reason?: string;
  startedAt?: number;
  finishedAt?: number;
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
    assignmentLevel?: AssignmentLevel;
    requestClass?: "T0" | "T1" | "T2" | "T3";
    classificationReason?: string;
    previousModelUsed?: string;
    agentPreferredModel?: string;
    detectedIntents?: string[];
    workstreamId?: string;
  };
  candidates: RouteTraceCandidate[];
  selected: {
    modelId: string;
    reason: string;
  };
  routePlan?: RoutePlan;
  phasePlan?: RouteTracePhase[];
  subcalls?: RouteTraceSubcall[];
  toolchain: string[];
  fallbacks: RouteTraceFallback[];
  routingDurationMs: number;
  assignmentLevel?: AssignmentLevel;
  requestClass?: "T0" | "T1" | "T2" | "T3";
  classificationReason?: string;
  stepsExecuted?: string[];
  stepsSkipped?: Array<{ step: string; reason: string }>;
  searchStatus?: "real_search" | "model_knowledge" | "skipped" | "error";
  searchTrace?: {
    provider?: "tavily" | "model_fallback" | "disabled" | "error";
    strategy?: "none" | "search" | "search_extract" | "extract_url" | "crawl" | "research";
    triggeredBy?:
      | "none"
      | "time_sensitive"
      | "explicit_search"
      | "research_mode"
      | "deep_research"
      | "read_url"
      | "crawl_request";
    fallbackReason?: string;
    costCredits?: number;
    operations?: Array<{
      tool: "search" | "extract" | "crawl" | "research" | "model_fallback";
      status: "completed" | "failed" | "skipped";
      query?: string;
      targetUrl?: string;
      resultCount?: number;
      selectedUrls?: string[];
      durationMs?: number;
      costCredits?: number;
      reason?: string;
    }>;
  };
  costBudgetUsd?: number;
  totalDurationMs?: number;
  totalCostCents?: number;
  modeSuggestions?: Array<{
    mode: import("@/lib/contracts/studyModes").StudyMode;
    label: string;
    prompt: string;
  }>;
  clarificationBlock?: ClarificationBlock;
  collaborators?: Array<{ role: string; model: string; tokensUsed: number; durationMs: number }>;
  inputTokenBreakdown?: {
    systemPrompt: number;
    history: number;
    memory: number;
    sources: number;
  };
  usageBudgetRemaining?: number;
  workstreamAssignment?: WorkstreamAssignment;
  threadStrategy?: ThreadStrategy;
  contextWindowStrategy?: ContextWindowStrategy;
  usedMemory?: Array<{
    key: string;
    text: string;
    category: "identity" | "academic" | "preference" | "topic" | "artifact" | "correction";
  }>;
  relatedMemory?: Array<{
    id: string;
    source: "personal" | "workstream";
    key: string;
    text: string;
    category: string;
    confidence: number;
    freshness: number;
    reason: "low_confidence" | "low_freshness" | "not_in_top_matches";
  }>;
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
