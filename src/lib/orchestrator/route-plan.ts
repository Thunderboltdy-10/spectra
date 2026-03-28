import type {
  AgentContract,
  AiToolName,
  ArtifactFormat,
  AssignmentLevel,
  ContextWindowStrategy,
  ModeContract,
  RoutePlan,
  RetrievalScope,
  StudyMode,
  ThreadStrategy,
  ToolBundle,
  WorkstreamAssignment,
} from "@/types";

type BuildRoutePlanParams = {
  message: string;
  mode: StudyMode;
  selectedMode: StudyMode;
  hasAttachments: boolean;
  hasAgent: boolean;
  hasPack: boolean;
  hasPersonalResources: boolean;
  hasAgentResources: boolean;
  autoSearchEnabled: boolean;
  thinkingLevel: "low" | "medium" | "high";
  complexity: "simple" | "medium" | "complex";
  assignmentLevel?: AssignmentLevel;
  selectedAgent?: {
    _id: string;
    name: string;
    preferredModel?: string;
    preferredMode?: StudyMode;
  };
  workstreamContext?: {
    activeWorkstreamId?: string;
    focusSurface?: "workspace" | "panel" | "chat" | "none";
    activeWorkstream?: {
      _id: string;
      title: string;
      description?: string;
      subjectCode?: string;
      linkedAgentId?: string;
      lastActivityAt?: number;
      defaultMode?: StudyMode;
      defaultThinking?: "low" | "medium" | "high";
      artifactCount?: number;
      noteCount?: number;
      plannerItemCount?: number;
      threadCount?: number;
      recentArtifactTitles?: string[];
      recentNoteTitles?: string[];
      recentPlannerTitles?: string[];
    };
    candidates?: Array<{
      _id: string;
      title: string;
      description?: string;
      subjectCode?: string;
      linkedAgentId?: string;
      lastActivityAt?: number;
      defaultMode?: StudyMode;
    }>;
  };
  threadContext?: {
    currentChatId?: string;
    turnCount?: number;
    turnsSinceCompaction?: number;
    contextWindowUtilization?: number;
    lastMessageAt?: number;
    recentMessages?: Array<{ role: "user" | "assistant"; content: string }>;
    explicitlySameThread?: boolean;
  };
  schoolSoulVersion?: string;
};

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function tokenSet(value: string) {
  return new Set(
    compactText(value)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );
}

function lexicalSimilarity(left: string, right: string) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  return overlap / Math.max(a.size, b.size, 1);
}

function normalizeConfidence(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function estimateMessageTokens(value: string) {
  return Math.max(12, Math.ceil(compactText(value).length / 4));
}

function buildTokenBudgetTarget(params: {
  assignmentLevel: AssignmentLevel;
  complexity: BuildRoutePlanParams["complexity"];
  hasAttachments: boolean;
  shouldUseWebSearch: boolean;
  hasWorkstreamContext: boolean;
}) {
  const baseByLevel: Record<AssignmentLevel, number> = {
    L0: 600,
    L1: 1200,
    L2: 3000,
    L3: 6000,
    L4: 8000,
  };
  let total = baseByLevel[params.assignmentLevel];
  if (params.complexity === "complex") total += 450;
  if (params.hasAttachments) total += 350;
  if (params.shouldUseWebSearch) total += 500;
  if (params.hasWorkstreamContext && params.assignmentLevel === "L4") total += 350;
  total = Math.round(total);
  const systemPrompt = Math.round(total * (params.assignmentLevel === "L0" ? 0.45 : 0.28));
  const memory = Math.round(total * (params.assignmentLevel === "L4" ? 0.12 : params.assignmentLevel === "L2" || params.assignmentLevel === "L3" ? 0.08 : 0.04));
  const artifacts = Math.round(total * (params.assignmentLevel === "L4" ? 0.16 : 0.05));
  const search = Math.round(total * (params.shouldUseWebSearch ? 0.18 : 0.02));
  return {
    systemPrompt,
    memory,
    artifacts,
    search,
    total,
  };
}

function buildContextWindowStrategy(params: {
  assignmentLevel: AssignmentLevel;
  message: string;
  complexity: BuildRoutePlanParams["complexity"];
  hasAttachments: boolean;
  shouldUseWebSearch: boolean;
  workstreamAssignment: WorkstreamAssignment;
  threadContext?: BuildRoutePlanParams["threadContext"];
  tokenBudgetTarget: RoutePlan["tokenBudgetTarget"];
}): ContextWindowStrategy {
  const messageTokens = estimateMessageTokens(params.message);
  const historyTokens = Math.round((params.threadContext?.contextWindowUtilization ?? 0) * 48_000);
  const retrievalTokens = params.shouldUseWebSearch ? 900 : 0;
  const workstreamTokens = params.workstreamAssignment.status === "assigned" ? 1100 : 0;
  const attachmentTokens = params.hasAttachments ? 700 : 0;
  const estimatedInputTokens =
    messageTokens
    + historyTokens
    + retrievalTokens
    + workstreamTokens
    + attachmentTokens
    + params.tokenBudgetTarget.systemPrompt
    + params.tokenBudgetTarget.memory
    + params.tokenBudgetTarget.artifacts;
  const estimatedOutputTokens =
    params.assignmentLevel === "L0"
      ? 420
      : params.assignmentLevel === "L1"
        ? 750
        : params.assignmentLevel === "L2"
          ? 1300
          : params.assignmentLevel === "L3"
            ? 1900
            : 2200;
  const minimumContextTokens = estimatedInputTokens + estimatedOutputTokens + 4096;
  const desiredContextTokens = Math.max(
    minimumContextTokens,
    Math.round(minimumContextTokens * (params.assignmentLevel === "L4" ? 1.35 : params.assignmentLevel === "L3" ? 1.22 : 1.12)),
  );
  const contextWindowPressure = normalizeConfidence(
    Math.max(params.threadContext?.contextWindowUtilization ?? 0, estimatedInputTokens / Math.max(desiredContextTokens, 1)),
  );
  const compactionSuggested =
    contextWindowPressure >= 0.72
    || ((params.threadContext?.turnsSinceCompaction ?? 0) >= 15 && params.assignmentLevel !== "L0");
  const preferLargeContext =
    params.assignmentLevel === "L4"
    || params.assignmentLevel === "L3"
    || params.shouldUseWebSearch
    || params.hasAttachments
    || desiredContextTokens >= 64_000;
  const rationale = [
    `${params.assignmentLevel} assignment target`,
    contextWindowPressure >= 0.72 ? "conversation is approaching context pressure" : "context pressure remains manageable",
    preferLargeContext ? "prefer wide-context models for continuity" : "standard context is acceptable",
  ];
  return {
    estimatedInputTokens,
    estimatedOutputTokens,
    desiredContextTokens,
    minimumContextTokens,
    compactionSuggested,
    preferLargeContext,
    contextWindowPressure,
    rationale,
  };
}

function resolveWorkstreamAssignment(params: {
  message: string;
  selectedAgentId?: string;
  workstreamContext?: BuildRoutePlanParams["workstreamContext"];
}): WorkstreamAssignment {
  const active = params.workstreamContext?.activeWorkstream;
  if (active && params.workstreamContext?.activeWorkstreamId === active._id) {
    return {
      status: "assigned",
      workstreamId: active._id,
      title: active.title,
      confidence: 1,
      reason: "Explicit workstream context is already active for this chat.",
      signals: ["explicit_context"],
    };
  }

  const candidates = params.workstreamContext?.candidates ?? [];
  if (candidates.length === 0) {
    return {
      status: "none",
      confidence: 0,
      reason: "No candidate workstreams were available for assignment.",
      signals: ["no_candidates"],
    };
  }

  const scored = candidates
    .map((candidate) => {
      const lexicalScore = lexicalSimilarity(
        params.message,
        [
          candidate.title,
          candidate.description ?? "",
          candidate.subjectCode ?? "",
        ].join(" "),
      );
      const recencyHours = candidate.lastActivityAt
        ? Math.max(0, (Date.now() - candidate.lastActivityAt) / (60 * 60 * 1000))
        : 1_000;
      const recencyScore = recencyHours <= 6 ? 0.18 : recencyHours <= 48 ? 0.09 : 0;
      const agentScore =
        params.selectedAgentId && candidate.linkedAgentId === params.selectedAgentId
          ? 0.22
          : 0;
      const subjectCodeScore =
        candidate.subjectCode && lexicalSimilarity(params.message, candidate.subjectCode) > 0
          ? 0.12
          : 0;
      const totalScore = lexicalScore + recencyScore + agentScore + subjectCodeScore;
      const signals = [
        lexicalScore > 0 ? "topic_similarity" : "",
        recencyScore > 0 ? "recent_activity" : "",
        agentScore > 0 ? "linked_agent" : "",
        subjectCodeScore > 0 ? "subject_code" : "",
      ].filter(Boolean);
      return {
        candidate,
        score: totalScore,
        signals,
      };
    })
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  const runnerUp = scored[1];
  if (!top || top.score < 0.28) {
    const newCandidateSignal = /\b(project|essay|assignment|deadline|subject|topic|research question|proposal)\b/i.test(params.message);
    return {
      status: newCandidateSignal ? "new_candidate" : "none",
      confidence: normalizeConfidence(top?.score ?? 0),
      reason: newCandidateSignal
        ? "Prompt looks substantial but does not confidently match an existing workstream."
        : "Prompt does not confidently match an existing workstream.",
      signals: [newCandidateSignal ? "new_workstream_candidate" : "low_similarity"],
    };
  }

  const assigned = top.score >= 0.72 || (top.score >= 0.58 && (!runnerUp || top.score - runnerUp.score >= 0.16));
  return {
    status: assigned ? "assigned" : "suggested",
    workstreamId: top.candidate._id,
    title: top.candidate.title,
    confidence: normalizeConfidence(top.score),
    reason: assigned
      ? "Best workstream match from topic, recency, and linked-agent signals."
      : "A plausible workstream match was found, but confidence is not high enough to auto-lock without correction.",
    signals: top.signals,
    alternateWorkstreamId: runnerUp?.candidate._id,
    alternateTitle: runnerUp?.candidate.title,
    candidateIds: scored.slice(0, 3).map((row) => row.candidate._id),
  };
}

function decideThreadStrategy(params: {
  message: string;
  threadContext?: BuildRoutePlanParams["threadContext"];
  workstreamAssignment: WorkstreamAssignment;
}): ThreadStrategy {
  if (!params.threadContext?.currentChatId) {
    return {
      action: "new_chat",
      confidence: 1,
      reason: "There is no active thread yet.",
      contextWindowPressure: 0,
      topicContinuity: 0,
    };
  }

  const explicitFork = /\b(new question|different topic|separate thread|start fresh|new thread)\b/i.test(params.message);
  const explicitContinue = Boolean(params.threadContext.explicitlySameThread) && !explicitFork;
  const recentContext = (params.threadContext.recentMessages ?? [])
    .slice(-6)
    .map((entry) => entry.content)
    .join(" ");
  const topicContinuity = lexicalSimilarity(params.message, recentContext);
  const timeGapHours = params.threadContext.lastMessageAt
    ? Math.max(0, (Date.now() - params.threadContext.lastMessageAt) / (60 * 60 * 1000))
    : undefined;
  const contextWindowPressure = normalizeConfidence(params.threadContext.contextWindowUtilization ?? 0);
  const turnsSinceCompaction = params.threadContext.turnsSinceCompaction ?? 0;
  const continuityScore = [
    explicitContinue ? 0.42 : 0,
    topicContinuity >= 0.55 ? 0.28 : topicContinuity >= 0.42 ? 0.18 : 0,
    contextWindowPressure < 0.75 ? 0.12 : 0,
    turnsSinceCompaction < 15 ? 0.08 : 0,
    typeof timeGapHours !== "number" || timeGapHours < 12 ? 0.08 : 0,
  ].reduce((sum, value) => sum + value, 0);
  const forkScore = [
    explicitFork ? 0.52 : 0,
    contextWindowPressure >= 0.75 ? 0.28 : contextWindowPressure >= 0.68 ? 0.14 : 0,
    turnsSinceCompaction >= 15 ? 0.18 : turnsSinceCompaction >= 12 ? 0.08 : 0,
    typeof timeGapHours === "number" && timeGapHours >= 12 ? 0.16 : 0,
    topicContinuity < 0.3 ? 0.24 : topicContinuity < 0.42 ? 0.1 : 0,
  ].reduce((sum, value) => sum + value, 0);
  const shouldFork =
    !explicitContinue && (forkScore >= 0.46 || forkScore > continuityScore + 0.12);
  return {
    action: shouldFork ? "fork" : "continue",
    confidence: shouldFork
      ? normalizeConfidence(0.5 + (forkScore * 0.4))
      : normalizeConfidence(0.52 + (continuityScore * 0.38) + (topicContinuity * 0.14)),
    reason: shouldFork
      ? explicitFork
        ? "User explicitly requested a fresh topic/thread."
        : contextWindowPressure >= 0.75
          ? "Current thread is approaching context saturation."
          : turnsSinceCompaction >= 15
            ? "Thread has run long enough that a clean fork is safer than continuing."
            : typeof timeGapHours === "number" && timeGapHours >= 12
              ? "Long gap since the last turn suggests a fresh thread is cleaner."
              : "Topic continuity with the recent thread is too weak."
      : explicitContinue
        ? "User is explicitly continuing the active thread and continuity remains acceptable."
        : "Prompt remains aligned with the active thread.",
    contextWindowPressure,
    topicContinuity,
    timeGapHours,
    turnsSinceCompaction,
  };
}

function detectRequestedModelPhrase(message: string) {
  const match = message.match(
    /\b(?:use|switch to|try|run with|with)\s+(?:the\s+)?([a-z0-9][a-z0-9\s._:/-]{1,64}?)(?:\s+(?:model|for this|for now|please)\b|[.!?,]|$)/i,
  );
  return match?.[1]?.trim();
}

function detectOrchestrationIntent(message: string) {
  return /\b(use multiple models|multiple models|multi[- ]?agent|collaborat(?:e|ion)|different perspectives|multiple perspectives|specialists?)\b/i.test(
    message,
  );
}

function isExplicitSearchRequest(message: string) {
  return /\b(search (the )?web|look up online|find online|browse the web|web search|check online|verify online|use current sources|cite sources)\b/i.test(message);
}

function extractFirstUrl(message: string) {
  const match = message.match(/https?:\/\/[^\s)\]>"']+/i);
  const url = match?.[0]?.trim();
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function isExplicitReadUrlRequest(message: string) {
  return /\b(read|summari[sz]e|analy[sz]e|review|extract|use)\b.{0,24}\b(url|link|page|source|website|site)\b/i.test(message);
}

function isExplicitCrawlRequest(message: string) {
  return /\b(crawl|map|scan|explore)\b.{0,28}\b(site|website|domain|url|link)\b/i.test(message);
}

function isDeepResearchRequest(message: string) {
  return /\b(deep research|research this thoroughly|comprehensive research|exhaustive research|thorough investigation|literature review)\b/i.test(message);
}

function buildResearchSubqueries(message: string) {
  const cleaned = message
    .replace(/\b(research|investigate|analy[sz]e|compare|evaluate|deep dive|thoroughly)\b/gi, " ")
    .replace(/[?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  const parts = cleaned
    .split(/\b(?: and | vs\.?| versus |,|;| also | plus )\b/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 8);
  if (parts.length > 0) {
    return parts.slice(0, 3);
  }
  return [cleaned].slice(0, 3);
}

function isTimeSensitiveMessage(message: string) {
  const normalized = message.toLowerCase();
  if (/\b(current ratio|current account|electrical current|current flow)\b/i.test(normalized)) {
    return false;
  }

  if (
    /\b(latest|recent|breaking|up[- ]to[- ]date|today|yesterday|tomorrow|this week|this month|this year|as of now)\b/i.test(normalized)
  ) {
    return true;
  }

  if (/\b(news|weather|forecast|score|results|stock price|election|ceo|president)\b/i.test(normalized)) {
    return true;
  }

  return /\b20(2[5-9]|3\d)\b/.test(normalized) && /\b(latest|current|recent|new|policy|news|regulation|changes?)\b/i.test(normalized);
}

function isPersonalMessage(message: string) {
  return /\b(i|my|me|mine|remember|preference|prefer|goal|struggle|weakness|accessibility|for me)\b/i.test(message);
}

function isArtifactRequest(mode: StudyMode, message: string) {
  if (mode === "document") return true;
  return /\b(pdf|docx|pptx|slides|presentation|study guide|worksheet|handout|document)\b/i.test(message);
}

function detectRequestedArtifactFormats(message: string): ArtifactFormat[] {
  const normalized = message.toLowerCase();
  const formats: ArtifactFormat[] = [];

  if (/\b(docx|word doc|word document|microsoft word)\b/i.test(normalized)) {
    formats.push("docx");
  }
  if (/\bpdf\b/i.test(normalized)) {
    formats.push("pdf");
  }
  if (/\b(pptx|powerpoint|slides|slide deck|presentation deck)\b/i.test(normalized)) {
    formats.push("pptx");
  }
  if (/\b(html|web page|webpage|website|interactive page|landing page)\b/i.test(normalized)) {
    formats.push("html");
  }

  return Array.from(new Set(formats));
}

function shouldWriteMemoryFromMessage(message: string) {
  const normalized = message.toLowerCase().trim();
  if (!normalized) return false;
  if (normalized.length < 12 && /^(hi|hello|hey|thanks|ok|okay|cool|nice)[!?.\s]*$/.test(normalized)) {
    return false;
  }
  const preferenceSignals = [
    /\b(i prefer|please (?:keep|use)|from now on|always|never|don't (?:use|do)|do not (?:use|do))\b/i,
    /\bmy (?:goal|target|exam|deadline|timezone|language|name|grade|year|subject|difficulty|learning style)\b/i,
    /\b(i am|i'm)\b.{0,48}\b(student|teacher|in grade|years old|from|based in|studying)\b/i,
    /\b(i struggle with|i find .* hard|i'm weak at|i'm stuck on|i get confused by)\b/i,
    /\b(update (?:my )?(?:memory|profile)|remember (?:that|this) about me|save (?:this|that) preference)\b/i,
    /\b(i changed my (?:goal|preference|timezone|language|study plan|subject))\b/i,
    /\b(remember this|save this|note this)\b/i,
  ];
  return preferenceSignals.some((pattern) => pattern.test(normalized));
}

function buildModeContract(mode: StudyMode): ModeContract {
  if (mode === "quiz") {
    return {
      mode,
      pedagogy: "active_recall",
      outputFormat: "strict_quiz",
      responseDepth: "standard",
      escalationPolicy: "allow_tools",
      toolBundles: [],
      validator: "quiz",
      retryPolicy: "single_bounded_retry",
    };
  }
  if (mode === "flashcard") {
    return {
      mode,
      pedagogy: "compact_recall",
      outputFormat: "strict_flashcards",
      responseDepth: "standard",
      escalationPolicy: "allow_tools",
      toolBundles: [],
      validator: "flashcard",
      retryPolicy: "single_bounded_retry",
    };
  }
  if (mode === "research") {
    return {
      mode,
      pedagogy: "evidence_first",
      outputFormat: "claims_evidence_reliability",
      responseDepth: "deep",
      escalationPolicy: "allow_multi_step",
      toolBundles: [],
      validator: "research",
      retryPolicy: "single_bounded_retry",
    };
  }
  if (mode === "document") {
    return {
      mode,
      pedagogy: "deliverable_oriented",
      outputFormat: "artifact_ready",
      responseDepth: "deep",
      escalationPolicy: "allow_tools",
      toolBundles: ["artifact"],
      validator: "document",
      retryPolicy: "single_bounded_retry",
    };
  }
  return {
    mode,
    pedagogy: mode === "tutor" ? "guided_teaching" : "general_support",
    outputFormat: "conversational",
    responseDepth: mode === "tutor" ? "standard" : "concise",
    escalationPolicy: "allow_tools",
    toolBundles: [],
    validator: "leak_guard",
    retryPolicy: "none",
  };
}

function buildAgentContract(params: BuildRoutePlanParams): AgentContract | undefined {
  if (!params.selectedAgent) return undefined;
  const toolBundles: ToolBundle[] = ["retrieval"];
  const preferredCapabilities: AgentContract["preferredCapabilities"] = [];
  if (params.mode === "research") {
    toolBundles.push("search");
    preferredCapabilities.push("reasoning", "search");
  }
  return {
    id: params.selectedAgent._id,
    name: params.selectedAgent.name,
    scope: "focused",
    instructionStyle: "compact",
    resourceScopes: ["agent"],
    toolBundles,
    preferredCapabilities,
  };
}

function allowedAiToolsForAssignmentLevel(assignmentLevel: AssignmentLevel): AiToolName[] {
  if (assignmentLevel === "L0") return [];
  if (assignmentLevel === "L1") return ["recall_memory"];
  if (assignmentLevel === "L2") return ["recall_memory", "save_memory", "search_web"];
  if (assignmentLevel === "L3") {
    return [
      "recall_memory",
      "save_memory",
      "update_memory",
      "dismiss_memory",
      "create_note",
      "update_planner",
      "search_web",
      "switch_mode",
    ];
  }
  return [
    "recall_memory",
    "save_memory",
    "update_memory",
    "dismiss_memory",
    "get_workstream_context",
    "create_note",
    "update_planner",
    "fork_thread",
    "search_web",
    "switch_mode",
  ];
}

export function buildRoutePlan(params: BuildRoutePlanParams): RoutePlan {
  const assignmentLevel =
    params.assignmentLevel
    ?? (params.complexity === "complex" || params.mode === "research" ? "L2" : params.complexity === "simple" ? "L0" : "L1");
  const lowerMessage = params.message.toLowerCase();
  const modeContract = buildModeContract(params.mode);
  const agentContract = buildAgentContract(params);
  const timeSensitive = isTimeSensitiveMessage(params.message);
  const explicitSearchRequest = isExplicitSearchRequest(params.message);
  const requestedUrl = extractFirstUrl(params.message);
  const explicitReadUrlRequest = Boolean(requestedUrl && isExplicitReadUrlRequest(params.message));
  const explicitCrawlRequest = Boolean(requestedUrl && isExplicitCrawlRequest(params.message));
  const deepResearchRequest = isDeepResearchRequest(params.message);
  const evidenceHeavyResearchPrompt = /\b(citation|citations|source|sources|evidence|paper|papers|study|studies|journal|dataset|report|reports|statistics|statistical)\b/i.test(lowerMessage);
  const personalTask = isPersonalMessage(params.message);
  const artifactRequest = isArtifactRequest(params.mode, params.message);
  const requestedArtifactFormats = artifactRequest ? detectRequestedArtifactFormats(params.message) : [];
  const studyMode = params.mode === "quiz" || params.mode === "flashcard" || params.mode === "tutor";
  const multimodal = params.hasAttachments;
  const workstreamAssignment = resolveWorkstreamAssignment({
    message: params.message,
    selectedAgentId: params.selectedAgent?._id,
    workstreamContext: params.workstreamContext,
  });
  const threadStrategy = decideThreadStrategy({
    message: params.message,
    threadContext: params.threadContext,
    workstreamAssignment,
  });
  const shouldUseSchoolResources = params.hasPack || params.hasAgentResources || /upload|attached|file|notes|resource|chapter|pack/i.test(lowerMessage);
  const researchNeedsSearch =
    params.mode === "research"
    && (
      explicitSearchRequest
      || explicitReadUrlRequest
      || explicitCrawlRequest
      || deepResearchRequest
      || timeSensitive
      || evidenceHeavyResearchPrompt
      || params.complexity === "complex"
      || (params.autoSearchEnabled && params.complexity !== "simple")
    );
  const simpleFactSearch = (explicitSearchRequest || timeSensitive) && params.complexity === "simple";
  const shouldUseWebSearch =
    explicitReadUrlRequest
    || explicitCrawlRequest
    || deepResearchRequest
    || explicitSearchRequest
    || researchNeedsSearch
    || (params.autoSearchEnabled && timeSensitive);
  const searchPlan = (() => {
    if (!shouldUseWebSearch) {
      return {
        strategy: "none" as const,
        trigger: "none" as const,
      };
    }
    if (explicitCrawlRequest && requestedUrl) {
      return {
        strategy: "crawl" as const,
        trigger: "crawl_request" as const,
        query: params.message,
        targetUrl: requestedUrl,
        maxResults: 8,
        maxExtractResults: 0,
      };
    }
    if (explicitReadUrlRequest && requestedUrl) {
      return {
        strategy: "extract_url" as const,
        trigger: "read_url" as const,
        query: params.message,
        targetUrl: requestedUrl,
        maxResults: 1,
        maxExtractResults: 1,
      };
    }
    if (deepResearchRequest) {
      return {
        strategy: "research" as const,
        trigger: "deep_research" as const,
        query: params.message,
        maxResults: 8,
        maxExtractResults: 3,
      };
    }
    if (params.mode === "research") {
      return {
        strategy: "search_extract" as const,
        trigger: "research_mode" as const,
        query: params.message,
        maxResults: 8,
        maxExtractResults: params.complexity === "complex" ? 3 : 2,
        subqueries: buildResearchSubqueries(params.message),
      };
    }
    return {
      strategy: "search" as const,
      trigger: explicitSearchRequest ? "explicit_search" as const : "time_sensitive" as const,
      query: params.message,
      maxResults: simpleFactSearch ? 3 : 5,
      maxExtractResults: 1,
    };
  })();
  const tokenBudgetTarget = buildTokenBudgetTarget({
    assignmentLevel,
    complexity: params.complexity,
    hasAttachments: params.hasAttachments,
    shouldUseWebSearch,
    hasWorkstreamContext: workstreamAssignment.status === "assigned",
  });
  const contextWindowStrategy = buildContextWindowStrategy({
    assignmentLevel,
    message: params.message,
    complexity: params.complexity,
    hasAttachments: params.hasAttachments,
    shouldUseWebSearch,
    workstreamAssignment,
    threadContext: params.threadContext,
    tokenBudgetTarget,
  });
  const responseBudget =
    assignmentLevel === "L3" || assignmentLevel === "L4"
      ? "deep"
      : params.complexity === "complex" || artifactRequest
      ? "deep"
      : params.mode === "research"
        ? "normal"
        : params.complexity === "medium"
          ? "normal"
        : "simple";
  const allowedAiTools = allowedAiToolsForAssignmentLevel(assignmentLevel);
  const requestedOrchestration = detectOrchestrationIntent(params.message);
  const shouldUseMultiStep =
    (
      params.complexity === "complex"
      && (params.mode === "research" || (artifactRequest && requestedArtifactFormats.includes("pptx")) || (params.hasAgent && shouldUseSchoolResources))
    )
    || requestedOrchestration;
  const requestedModelPhrase = detectRequestedModelPhrase(params.message);

  const retrievalScopes: RetrievalScope[] = [
    ...(params.hasPack ? ["pack" as const] : []),
    ...(params.hasPersonalResources ? ["personal" as const] : []),
    ...(params.hasAgentResources || params.hasAgent ? ["agent" as const] : []),
  ];

  const allowedToolBundles = Array.from(
    new Set<ToolBundle>([
      ...(modeContract.toolBundles ?? []),
      ...(agentContract?.toolBundles ?? []),
      ...(multimodal ? (["vision"] as ToolBundle[]) : []),
      ...(shouldUseWebSearch ? (["search"] as ToolBundle[]) : []),
      ...(retrievalScopes.length > 0 ? (["retrieval"] as ToolBundle[]) : []),
      ...(artifactRequest ? (["artifact"] as ToolBundle[]) : []),
      ...(artifactRequest || params.mode === "research" ? (["skills"] as ToolBundle[]) : []),
      ...(personalTask || assignmentLevel === "L4" ? (["memory"] as ToolBundle[]) : []),
      ...(shouldUseMultiStep ? (["multi_agent"] as ToolBundle[]) : []),
    ]),
  ).filter((bundle) => bundle !== "none");

  const required = [
    ...(multimodal ? ["vision" as const] : []),
    ...(artifactRequest ? [] : []),
  ];
  const preferred = [
    ...(params.mode === "research" || shouldUseMultiStep || assignmentLevel === "L4" ? ["reasoning" as const] : []),
    ...(shouldUseWebSearch ? ["search" as const] : []),
    ...(artifactRequest ? ["reasoning" as const] : []),
  ];

  return {
    taskClass: assignmentLevel === "L4"
      ? "workstream_deep"
      : artifactRequest
      ? "artifact_generation"
      : params.mode === "research"
        ? "research"
        : multimodal
          ? "multimodal"
          : shouldUseSchoolResources
            ? "resource_grounded"
            : shouldUseWebSearch
              ? "current_info"
              : personalTask
                ? "personalized_help"
                : studyMode
                  ? "study_mode"
                  : "simple_question",
    assignmentLevel,
    timeSensitive,
    hasAttachments: params.hasAttachments,
    hasSelectedMode: params.selectedMode !== "auto",
    hasSelectedAgent: params.hasAgent,
    personalTask,
    shouldConsultMemory: personalTask || assignmentLevel === "L4",
    shouldWriteMemory: shouldWriteMemoryFromMessage(params.message) || assignmentLevel === "L4",
    shouldUseSchoolResources,
    shouldUseWebSearch,
    shouldUseMultiStep,
    allowedAiTools,
    responseBudget,
    tokenBudgetTarget,
    allowedToolBundles: allowedToolBundles.length > 0 ? allowedToolBundles : ["none"],
    retrievalScopes,
    memoryScopes:
      assignmentLevel === "L4"
        ? (["user_global", "workstream"] as const)
        : personalTask
          ? (["user_global"] as const)
          : (["none"] as const),
    workstreamAssignment,
    threadStrategy,
    contextWindowStrategy,
    candidateModelRequirements: {
      required,
      preferred,
    },
    requestedArtifactFormats,
    allowSubAgents: shouldUseMultiStep && (params.mode === "research" || params.complexity === "complex"),
    modeContract,
    agentContract,
    schoolSoulVersion: params.schoolSoulVersion,
    intentSignals: {
      requestedModelPhrase,
      requestedOrchestration,
    },
    searchPlan,
  };
}
