import { convexAction, convexQuery } from "@/lib/convex-server";
import { MODEL_CONFIG, ROUTER_FALLBACKS } from "@/lib/model-config";
import { openRouterChatCompletion, openRouterEmbedding } from "@/lib/openrouter";
import { withTimeout } from "@/lib/orchestrator/history";

export type RetrievedCitation = {
  resourceId?: string;
  filename: string;
  page?: number;
  sourceType: "pack" | "personal";
  text: string;
  score?: number;
};

export type RetrievalResult = {
  citations: RetrievedCitation[];
  sourceBlock: string;
};

export type ReliabilityScore = {
  source: string;
  sourceType: "rag" | "web";
  score: number;
  confidence: "high" | "medium" | "low";
  reason: string;
};

function extractUrls(text: string) {
  const matches = text.match(/https?:\/\/[^\s)\]]+/g) ?? [];
  return [...new Set(matches)].slice(0, 6);
}

function normalizeHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function scoreWebSource(url: string): ReliabilityScore {
  const host = normalizeHost(url);
  if (!host) {
    return {
      source: url,
      sourceType: "web",
      score: 0.35,
      confidence: "low",
      reason: "Unparseable URL host.",
    };
  }

  if (/\.(gov|edu)$/.test(host) || host.includes("who.int")) {
    return {
      source: url,
      sourceType: "web",
      score: 0.9,
      confidence: "high",
      reason: "Institutional or academic domain.",
    };
  }
  if (/(nature|science|cell|nejm|lancet|arxiv|ieee|acm)\./.test(host)) {
    return {
      source: url,
      sourceType: "web",
      score: 0.86,
      confidence: "high",
      reason: "Research or peer-reviewed source domain.",
    };
  }
  if (/(reuters|bbc|apnews|ft|economist|nytimes|wsj)\./.test(host)) {
    return {
      source: url,
      sourceType: "web",
      score: 0.74,
      confidence: "medium",
      reason: "Established editorial news source.",
    };
  }
  if (/(reddit|x\.com|twitter|tiktok|instagram|facebook|youtube)\./.test(host)) {
    return {
      source: url,
      sourceType: "web",
      score: 0.28,
      confidence: "low",
      reason: "Social platform; requires strong corroboration.",
    };
  }
  return {
    source: url,
    sourceType: "web",
    score: 0.55,
    confidence: "medium",
    reason: "Unknown editorial controls; cross-check recommended.",
  };
}

export function buildResearchEvidenceBlock(params: {
  citations: RetrievedCitation[];
  searchUrls: string[];
}) {
  const ragScores: ReliabilityScore[] = params.citations.slice(0, 4).map((citation) => ({
    source: citation.filename,
    sourceType: "rag",
    score: 0.82,
    confidence: "high",
    reason: "Retrieved from classroom resources.",
  }));
  const webScores = params.searchUrls.slice(0, 6).map(scoreWebSource);
  const combined = [...ragScores, ...webScores].sort((a, b) => b.score - a.score);

  if (combined.length === 0) return "";

  const matrixLines = combined
    .slice(0, 8)
    .map(
      (item, index) =>
        `${index + 1}. [${item.sourceType.toUpperCase()}] ${item.source} | score ${item.score.toFixed(2)} | ${item.reason}`,
    );

  const hasRag = ragScores.length > 0;
  const hasWeb = webScores.length > 0;
  const crossRefNote =
    hasRag && hasWeb
      ? "Cross-reference required: prioritize claims confirmed by both retrieved classroom context and web sources."
      : hasRag
        ? "Cross-reference scope is internal: rely on retrieved classroom context."
        : "Cross-reference scope is web-only: clearly mark uncertain claims.";

  return [
    "=== RESEARCH EVIDENCE MATRIX (internal) ===",
    ...matrixLines,
    crossRefNote,
    "=== END EVIDENCE MATRIX ===",
  ].join("\n");
}

export async function maybeSearchWeb(message: string, thinkingLevel: "low" | "medium" | "high") {
  const searchModel = thinkingLevel === "high" ? MODEL_CONFIG.searchDeep : MODEL_CONFIG.searchFast;
  const completion = await withTimeout(
    openRouterChatCompletion({
      model: searchModel,
      fallbackModels: ROUTER_FALLBACKS[searchModel] ?? [MODEL_CONFIG.searchFast, MODEL_CONFIG.tutorFast],
      messages: [
        {
          role: "system",
          content:
            "Provide a concise up-to-date briefing with explicit source URLs for key claims. Keep under 180 words.",
        },
        {
          role: "user",
          content: message,
        },
      ],
      temperature: 0.2,
    }),
    8000,
  );

  const text = completion?.choices?.[0]?.message?.content?.trim() ?? "";
  return {
    text,
    urls: extractUrls(text),
  };
}

export async function runRagRetrieval(params: {
  actorClerkId: string;
  usePersonalResources: boolean;
  selectedAgentId?: string;
  message: string;
  logger?: { info: (message: string, context?: Record<string, unknown>) => void; warn: (message: string) => void };
}): Promise<RetrievalResult> {
  let retrieval: RetrievalResult = {
    citations: [],
    sourceBlock: "No retrieved sources.",
  };

  try {
    const [personalResources, agentResources] = await Promise.all([
      params.usePersonalResources
        ? (convexQuery("resources:listPersonalResources", {
            actorClerkId: params.actorClerkId,
          }) as Promise<Array<unknown>>)
        : Promise.resolve([]),
      params.selectedAgentId
        ? (convexQuery("resources:listAgentResources", {
            actorClerkId: params.actorClerkId,
            agentId: params.selectedAgentId,
          }) as Promise<Array<unknown>>)
        : Promise.resolve([]),
    ]);

    const hasRetrievalSources = personalResources.length > 0 || agentResources.length > 0;
    if (hasRetrievalSources) {
      const queryEmbedding = await openRouterEmbedding(params.message, MODEL_CONFIG.embedding);
      retrieval = (await convexAction("rag:retrieve", {
        actorClerkId: params.actorClerkId,
        agentId: params.selectedAgentId,
        includePersonal: params.usePersonalResources,
        embedding: queryEmbedding,
        topK: 8,
      })) as RetrievalResult;
      params.logger?.info("RAG retrieval complete", {
        sourceCount: retrieval.citations.length,
      });
    }
  } catch {
    retrieval = {
      citations: [],
      sourceBlock: "Retrieval unavailable. Continue with general instructional support.",
    };
    params.logger?.warn("RAG retrieval failed; using fallback source block");
  }

  return retrieval;
}
