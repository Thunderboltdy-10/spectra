import type { RequestClass, UserDirectives } from "@/lib/auto-settings";
import type { StudyMode } from "@/types";

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

export type ClarificationDecision = {
  reason: string;
  block: ClarificationBlock;
};

export type RecentContextSnapshot = {
  version: 1;
  kind: "clarification_pending";
  createdAt: number;
  requestClass: RequestClass;
  mode: StudyMode;
  retrieval: {
    citations: Array<{
      resourceId?: string;
      filename: string;
      page?: number;
      sourceType: "pack" | "personal";
      text: string;
      score?: number;
    }>;
    sourceBlock: string;
    diagnostics?: {
      scopesAttempted: string[];
      status:
        | "not_requested"
        | "no_sources_available"
        | "no_chunks"
        | "no_high_confidence_matches"
        | "retrieved"
        | "failed";
      reason: string;
      embeddingModel?: string;
    };
  };
  search: {
    text: string;
    urls: string[];
    sources: Array<{
      url: string;
      title: string;
      domain: string;
      snippet?: string;
    }>;
    provider: "searxng" | "model_fallback" | "disabled" | "error";
  };
  clarification: ClarificationBlock;
};

const FIVE_MINUTES_MS = 5 * 60 * 1000;

const RESEARCH_ACTION_RE = /\b(research|investigate|analy[sz]e|compare|evaluate|find sources|literature review|deep dive)\b/i;
const RECENCY_CONFLICT_RE = /\b(latest|current|today|yesterday|recent|up[- ]to[- ]date|news|this week|this month)\b/i;
const SEARCH_OPT_OUT_RE = /\b(don'?t search|do not search|without searching|no web search|no browsing|offline only)\b/i;

const REQUEST_CLASS_RANK: Record<RequestClass, number> = {
  T0: 0,
  T1: 1,
  T2: 2,
  T3: 3,
};

function requestClassAtLeast(requestClass: RequestClass, minimum: RequestClass) {
  return REQUEST_CLASS_RANK[requestClass] >= REQUEST_CLASS_RANK[minimum];
}

function tokenizeWords(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function hasConflictingDirectives(params: {
  message: string;
  userDirectives?: UserDirectives;
}) {
  const normalized = params.message.toLowerCase();
  const asksRecency = RECENCY_CONFLICT_RE.test(normalized);
  const searchOptOut = SEARCH_OPT_OUT_RE.test(normalized);
  const forcedModel = typeof params.userDirectives?.forcedModel === "string" && params.userDirectives.forcedModel.length > 0;
  const asksMultiAgent = Boolean(params.userDirectives?.forceMultiAgent);

  if (asksRecency && searchOptOut) {
    return {
      reason: "Request asks for recency while explicitly opting out of web search.",
      block: {
        context: "Before I proceed, I need one routing choice to avoid conflicting instructions.",
        questions: [
          {
            id: "search_policy",
            text: "Should I enable web search for up-to-date info, or stay offline and use model knowledge only?",
            type: "single_choice",
            options: [
              {
                id: "enable_search",
                label: "Enable web search",
                description: "Best for current facts, scores, and recent updates.",
              },
              {
                id: "stay_offline",
                label: "Stay offline",
                description: "Faster and cheaper, but less reliable for current events.",
              },
            ],
          },
        ],
      },
    } as ClarificationDecision;
  }

  if (forcedModel && asksMultiAgent) {
    return {
      reason: "User requested both a forced model and forced multi-agent collaboration.",
      block: {
        context: "I can honor one priority first.",
        questions: [
          {
            id: "routing_priority",
            text: "What should I prioritize for this run?",
            type: "single_choice",
            options: [
              {
                id: "fixed_model",
                label: "Keep fixed model",
                description: "Stay on your chosen model, even if orchestration options narrow.",
              },
              {
                id: "multi_agent",
                label: "Prioritize orchestration",
                description: "Allow specialist routing and model variation for better coverage.",
              },
            ],
          },
        ],
      },
    } as ClarificationDecision;
  }

  return null;
}

function lacksResearchSpecificity(message: string) {
  const normalized = message.toLowerCase().trim();
  const words = tokenizeWords(normalized);
  if (words.length <= 3) return true;

  const hasScopeAnchor = /\b(about|on|for|between|vs\.?|regarding|focused|focus|from|since|within|using|covering|level|grade|curriculum)\b/.test(normalized);
  const hasOutputConstraint = /\b(citations?|sources?|brief|outline|report|bullets?|summary|table|compare|timeline|pros|cons|step-by-step)\b/.test(normalized);
  const hasTemporalConstraint = /\b(20\d{2}|today|this week|this month|last \d+|last week|last month|past year|last year)\b/.test(normalized);

  if (RESEARCH_ACTION_RE.test(normalized) && !hasScopeAnchor && !hasOutputConstraint && !hasTemporalConstraint) {
    return true;
  }

  if (words.length <= 7 && !hasOutputConstraint && !hasTemporalConstraint) {
    return true;
  }

  return false;
}

function isVagueEnhancedRequest(message: string) {
  const normalized = message.toLowerCase().trim();
  const words = tokenizeWords(normalized);
  if (words.length === 0) return false;

  const genericLead = /^(help|do|make|write|explain|analy[sz]e|research|plan|tell me|teach me)\b/.test(normalized);
  const hasConcreteAnchor = /\b(about|on|for|with|using|because|between|specific|grade|curriculum|topic|question|problem|dataset|example)\b/.test(normalized);

  return words.length <= 5 || (genericLead && !hasConcreteAnchor && words.length <= 9);
}

export function needsClarification(params: {
  requestClass: RequestClass;
  mode: StudyMode;
  message: string;
  userDirectives?: UserDirectives;
  lastAssistantWasClarification?: boolean;
}): ClarificationDecision | null {
  if (params.lastAssistantWasClarification) return null;
  if (!requestClassAtLeast(params.requestClass, "T2")) return null;
  if (params.mode === "quiz" || params.mode === "flashcard") return null;

  const conflict = hasConflictingDirectives({
    message: params.message,
    userDirectives: params.userDirectives,
  });
  if (conflict) return conflict;

  if (params.mode === "research" && lacksResearchSpecificity(params.message)) {
    return {
      reason: "Research request is too broad for reliable source planning.",
      block: {
        context: "Before I start researching, I need a tighter scope.",
        questions: [
          {
            id: "research_scope",
            text: "What exact angle should I focus on?",
            type: "free_text",
          },
          {
            id: "depth",
            text: "How deep should I go?",
            type: "single_choice",
            options: [
              {
                id: "quick_brief",
                label: "Quick brief",
                description: "Fast overview with key points only.",
              },
              {
                id: "deep_dive",
                label: "Deep dive",
                description: "Detailed analysis with stronger evidence coverage.",
              },
            ],
          },
          {
            id: "source_preference",
            text: "Any source preference?",
            type: "single_choice",
            options: [
              {
                id: "academic",
                label: "Academic first",
                description: "Prioritize journals, institutions, and reports.",
              },
              {
                id: "balanced",
                label: "Balanced mix",
                description: "Mix academic and high-quality editorial sources.",
              },
            ],
          },
        ],
      },
    };
  }

  if (isVagueEnhancedRequest(params.message)) {
    return {
      reason: "Enhanced request lacks enough constraints to execute reliably.",
      block: {
        context: "Before I run a deeper workflow, I need two quick constraints.",
        questions: [
          {
            id: "target_outcome",
            text: "What outcome do you want from this response?",
            type: "free_text",
          },
          {
            id: "response_shape",
            text: "Preferred response format?",
            type: "single_choice",
            options: [
              {
                id: "concise",
                label: "Concise bullets",
                description: "Short, practical summary.",
              },
              {
                id: "step_by_step",
                label: "Step-by-step",
                description: "Structured walkthrough with clear sequence.",
              },
            ],
          },
        ],
      },
    };
  }

  return null;
}

export function formatClarificationAsText(block: ClarificationBlock) {
  const lines: string[] = [block.context.trim()];
  const questions = block.questions.slice(0, 3);

  questions.forEach((question, index) => {
    lines.push(`${index + 1}. ${question.text.trim()}`);
    if (Array.isArray(question.options) && question.options.length > 0) {
      const optionLabels = question.options
        .map((option) => option.label.trim())
        .filter(Boolean)
        .join(" / ");
      if (optionLabels) {
        lines.push(`   Options: ${optionLabels}`);
      }
    }
  });

  lines.push("Reply with your choices and I will continue immediately.");
  return lines.join("\n");
}

export function serializeRecentContext(snapshot: RecentContextSnapshot) {
  return JSON.stringify(snapshot);
}

export function parseRecentContext(params: {
  raw: unknown;
  savedAt: unknown;
  now?: number;
}) {
  if (typeof params.raw !== "string" || params.raw.trim().length === 0) return null;
  const savedAt = typeof params.savedAt === "number" ? params.savedAt : Number.NaN;
  if (!Number.isFinite(savedAt)) return null;

  const now = params.now ?? Date.now();
  if (now - savedAt > FIVE_MINUTES_MS) return null;

  try {
    const parsed = JSON.parse(params.raw) as Partial<RecentContextSnapshot>;
    if (parsed.version !== 1 || parsed.kind !== "clarification_pending") return null;
    if (!parsed.retrieval || !parsed.search || !parsed.clarification) return null;

    return parsed as RecentContextSnapshot;
  } catch {
    return null;
  }
}

function clampText(value: string, max: number) {
  return value.trim().slice(0, max);
}

export function buildRecentContextSnapshot(params: {
  requestClass: RequestClass;
  mode: StudyMode;
  retrieval: {
    citations: Array<{
      resourceId?: string;
      filename: string;
      page?: number;
      sourceType: "pack" | "personal";
      text: string;
      score?: number;
    }>;
    sourceBlock: string;
    diagnostics?: {
      scopesAttempted: string[];
      status:
        | "not_requested"
        | "no_sources_available"
        | "no_chunks"
        | "no_high_confidence_matches"
        | "retrieved"
        | "failed";
      reason: string;
      embeddingModel?: string;
    };
  };
  search: {
    text: string;
    urls: string[];
    sources: Array<{
      url: string;
      title: string;
      domain: string;
      snippet?: string;
    }>;
    provider: "searxng" | "model_fallback" | "disabled" | "error";
  };
  clarification: ClarificationBlock;
  now?: number;
}) {
  const now = params.now ?? Date.now();
  const limitedCitations = params.retrieval.citations.slice(0, 5).map((citation) => ({
    ...citation,
    text: clampText(citation.text, 320),
  }));
  const limitedSources = params.search.sources.slice(0, 6).map((source) => ({
    ...source,
    title: clampText(source.title, 140),
    domain: clampText(source.domain, 80),
    snippet: source.snippet ? clampText(source.snippet, 200) : undefined,
  }));

  return {
    version: 1,
    kind: "clarification_pending",
    createdAt: now,
    requestClass: params.requestClass,
    mode: params.mode,
    retrieval: {
      citations: limitedCitations,
      sourceBlock: clampText(params.retrieval.sourceBlock, 1500),
      diagnostics: params.retrieval.diagnostics
        ? {
            scopesAttempted: params.retrieval.diagnostics.scopesAttempted.slice(0, 4),
            status: params.retrieval.diagnostics.status,
            reason: clampText(params.retrieval.diagnostics.reason, 240),
            embeddingModel: params.retrieval.diagnostics.embeddingModel,
          }
        : undefined,
    },
    search: {
      text: clampText(params.search.text, 900),
      urls: params.search.urls.slice(0, 6),
      sources: limitedSources,
      provider: params.search.provider,
    },
    clarification: {
      context: clampText(params.clarification.context, 220),
      questions: params.clarification.questions.slice(0, 3),
    },
  } as RecentContextSnapshot;
}

export const RECENT_CONTEXT_TTL_MS = FIVE_MINUTES_MS;
