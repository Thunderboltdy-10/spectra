import type { AgentContract, ArtifactFormat, ModeContract, RoutePlan, RetrievalScope, StudyMode, ToolBundle } from "@/types";

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
  selectedAgent?: {
    _id: string;
    name: string;
    preferredModel?: string;
    preferredMode?: StudyMode;
  };
  schoolSoulVersion?: string;
};

function isExplicitSearchRequest(message: string) {
  return /\b(search|look up|lookup|find online|browse|web search|use sources|cite sources|check online)\b/i.test(message);
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

  if (
    /\b(news|weather|forecast|score|results|stock price|price today|election|ceo|president|policy changes?|version)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }

  return /\b20(2[5-9]|3\d)\b/.test(normalized) && /\b(latest|current|recent|new|policy|news|update|changes?)\b/i.test(normalized);
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

  return Array.from(new Set(formats));
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

export function buildRoutePlan(params: BuildRoutePlanParams): RoutePlan {
  const lowerMessage = params.message.toLowerCase();
  const modeContract = buildModeContract(params.mode);
  const agentContract = buildAgentContract(params);
  const timeSensitive = isTimeSensitiveMessage(params.message);
  const explicitSearchRequest = isExplicitSearchRequest(params.message);
  const personalTask = isPersonalMessage(params.message);
  const artifactRequest = isArtifactRequest(params.mode, params.message);
  const requestedArtifactFormats = artifactRequest ? detectRequestedArtifactFormats(params.message) : [];
  const studyMode = params.mode === "quiz" || params.mode === "flashcard" || params.mode === "tutor";
  const multimodal = params.hasAttachments;
  const shouldUseSchoolResources = params.hasPack || params.hasAgentResources || /upload|attached|file|notes|resource|chapter|pack/i.test(lowerMessage);
  const researchNeedsSearch = params.mode === "research" && !shouldUseSchoolResources && params.complexity !== "simple";
  const shouldUseWebSearch =
    explicitSearchRequest
    || timeSensitive
    || (params.autoSearchEnabled && (timeSensitive || researchNeedsSearch))
    || researchNeedsSearch;
  const responseBudget =
    params.complexity === "complex" || artifactRequest
      ? "deep"
      : params.mode === "research"
        ? "normal"
      : params.complexity === "medium"
        ? "normal"
        : "simple";
  const shouldUseMultiStep =
    params.complexity === "complex"
    && (params.mode === "research" || (artifactRequest && requestedArtifactFormats.includes("pptx")) || (params.hasAgent && shouldUseSchoolResources));

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
      ...(personalTask ? (["memory"] as ToolBundle[]) : []),
      ...(shouldUseMultiStep ? (["multi_agent"] as ToolBundle[]) : []),
    ]),
  ).filter((bundle) => bundle !== "none");

  const required = [
    ...(multimodal ? ["vision" as const] : []),
    ...(artifactRequest ? [] : []),
  ];
  const preferred = [
    ...(params.mode === "research" || shouldUseMultiStep ? ["reasoning" as const] : []),
    ...(shouldUseWebSearch ? ["search" as const] : []),
    ...(artifactRequest ? ["reasoning" as const] : []),
  ];

  return {
    taskClass: artifactRequest
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
    timeSensitive,
    hasAttachments: params.hasAttachments,
    hasSelectedMode: params.selectedMode !== "auto",
    hasSelectedAgent: params.hasAgent,
    personalTask,
    shouldConsultMemory: personalTask,
    shouldWriteMemory: /\bremember\b/i.test(params.message) || /\bmy goal\b/i.test(lowerMessage),
    shouldUseSchoolResources,
    shouldUseWebSearch,
    shouldUseMultiStep,
    responseBudget,
    allowedToolBundles: allowedToolBundles.length > 0 ? allowedToolBundles : ["none"],
    retrievalScopes,
    memoryScopes: personalTask ? ["user_global"] : ["none"],
    candidateModelRequirements: {
      required,
      preferred,
    },
    requestedArtifactFormats,
    allowSubAgents: shouldUseMultiStep && (params.mode === "research" || params.complexity === "complex"),
    modeContract,
    agentContract,
    schoolSoulVersion: params.schoolSoulVersion,
  };
}
