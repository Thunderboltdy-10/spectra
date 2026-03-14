import { convexAction, convexQuery } from "@/lib/convex-server";
import { MODEL_CONFIG } from "@/lib/model-config";
import { getLiveCatalogSnapshot } from "@/lib/openrouter-catalog-cache";
import { openRouterChatCompletion, openRouterEmbedding } from "@/lib/openrouter";
import { withTimeout } from "@/lib/orchestrator/history";
import { pickModelAndFallbacks, type CatalogModelEntry, type ModelRuntimeStat } from "@/lib/model-selection";
import { searxngSearch } from "@/lib/search/searxng";
import { recordOpenRouterUsage } from "@/lib/usage-tracking";

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
  };
};

export type ReliabilityScore = {
  source: string;
  sourceType: "rag" | "web";
  score: number;
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type WebSearchSource = {
  url: string;
  title: string;
  domain: string;
  snippet?: string;
};

const MAX_WEB_SOURCES = 6;
export const MAX_RAG_SOURCES = 5;
const URL_VALIDATION_TIMEOUT_MS = 3500;
const TITLE_PARSE_TIMEOUT_MS = 2000;

function parseHttpUrl(raw: string) {
  const sanitized = raw.trim().replace(/[),.;]+$/, "");
  try {
    const parsed = new URL(sanitized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
}

function extractUrls(text: string) {
  const matches = text.match(/https?:\/\/[^\s)\]>"']+/g) ?? [];
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const parsed = parseHttpUrl(match);
    if (!parsed) continue;
    const normalized = parsed.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
    if (urls.length >= MAX_WEB_SOURCES) break;
  }

  return urls;
}

function normalizeHost(url: string) {
  const parsed = parseHttpUrl(url);
  return parsed ? parsed.hostname.toLowerCase().replace(/^www\./, "") : "";
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

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function extractHtmlTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return "";
  return decodeHtmlEntities(match[1]).replace(/\s+/g, " ").trim();
}

async function resolveWebSearchSource(url: string, snippet?: string): Promise<WebSearchSource | null> {
  const parsed = parseHttpUrl(url);
  if (!parsed) return null;

  const response = await withTimeout(
    fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
        "User-Agent": "Mozilla/5.0 (compatible; AI-School-Research/1.0)",
      },
    }),
    URL_VALIDATION_TIMEOUT_MS,
  );

  if (!response) return null;
  const acceptableStatus = response.ok || response.status === 401 || response.status === 403 || response.status === 405;
  if (!acceptableStatus) return null;

  const finalParsed = parseHttpUrl(response.url || parsed.toString());
  if (!finalParsed) return null;
  const domain = finalParsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!domain) return null;

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  let title = domain;
  if (contentType.includes("text/html")) {
    const body = await withTimeout(response.text(), TITLE_PARSE_TIMEOUT_MS);
    const extracted = body ? extractHtmlTitle(body) : "";
    if (extracted) {
      title = extracted.slice(0, 140);
    }
  }

  return {
    url: finalParsed.toString(),
    title,
    domain,
    snippet: snippet?.trim() ? snippet.trim().slice(0, 280) : undefined,
  };
}

async function resolveWebSearchSources(
  urls: string[],
  snippetByUrl?: Map<string, string>,
) {
  const resolved = await Promise.all(
    urls.map((url) => resolveWebSearchSource(url, snippetByUrl?.get(url))),
  );
  return resolved.filter((item): item is WebSearchSource => Boolean(item)).slice(0, MAX_WEB_SOURCES);
}

function normalizeSourceFilename(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function limitRagRetrievalSources(result: RetrievalResult): RetrievalResult {
  if (!result.citations.length) return result;

  const ranked = [...result.citations].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const selected: RetrievedCitation[] = [];
  const seenFiles = new Set<string>();

  for (const citation of ranked) {
    const filename = citation.filename?.trim() || "unknown-source";
    const key = normalizeSourceFilename(filename);
    if (seenFiles.has(key)) continue;
    seenFiles.add(key);
    selected.push({
      ...citation,
      filename,
    });
    if (seenFiles.size >= MAX_RAG_SOURCES) break;
  }

  if (selected.length === 0) {
    return {
      citations: [],
      sourceBlock: "No high-confidence retrieved sources.",
    };
  }

  return {
    citations: selected,
    sourceBlock: selected
      .map((citation, index) => {
        const scoreLabel = typeof citation.score === "number" ? ` (score ${citation.score.toFixed(3)})` : "";
        return `[${index + 1}] ${citation.filename}${citation.page ? ` p.${citation.page}` : ""}${scoreLabel}\n${citation.text}`;
      })
      .join("\n\n"),
  };
}

export function buildResearchEvidenceBlock(params: {
  citations: RetrievedCitation[];
  searchSources: WebSearchSource[];
}) {
  const ragScores: ReliabilityScore[] = params.citations.slice(0, 4).map((citation) => ({
    source: citation.filename,
    sourceType: "rag",
    score: 0.82,
    confidence: "high",
    reason: "Retrieved from classroom resources.",
  }));
  const webScores = params.searchSources.slice(0, 6).map((source) => {
    const scored = scoreWebSource(source.url);
    return {
      ...scored,
      source: `${source.title} (${source.domain})`,
    };
  });
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

export async function maybeSearchWeb(
  message: string,
  thinkingLevel: "low" | "medium" | "high",
  options?: {
    actorClerkId?: string;
    chatId?: string;
    modelCatalog?: CatalogModelEntry[];
    spendingTier?: "normal" | "expensive_blocked" | "cheap_only" | "free_only";
    modelRuntimeStats?: Record<string, ModelRuntimeStat>;
    searxngEnabled?: boolean;
  },
) {
  const searxngResults = options?.searxngEnabled === false
    ? []
    : await searxngSearch(message, {
      limit: thinkingLevel === "high" ? 8 : 6,
      language: "en",
    }).catch(() => []);
  if (searxngResults.length > 0) {
    const snippetByUrl = new Map(
      searxngResults
        .filter((result) => result.url)
        .map((result) => [result.url, result.content?.trim() ?? ""]),
    );
    const sources = await resolveWebSearchSources(
      searxngResults.map((result) => result.url),
      snippetByUrl,
    );
    const sourceByUrl = new Map(sources.map((source) => [source.url, source]));
    const text = searxngResults
      .map((result, index) => {
        const resolved = sourceByUrl.get(result.url);
        return `${index + 1}. ${resolved?.title || result.title}\n${resolved?.snippet || result.content || ""}\n${resolved?.url || result.url}`;
      })
      .join("\n\n")
      .trim();

    return {
      text,
      urls: sources.map((source) => source.url),
      sources,
      provider: "searxng" as const,
    };
  }

  const liveCatalog = options?.modelCatalog?.length
    ? options.modelCatalog
    : (await getLiveCatalogSnapshot()).models;
  const searchModelSelection = pickModelAndFallbacks({
    catalog: liveCatalog.filter((model) => model.modelId !== "openrouter/auto"),
    tier: options?.spendingTier ?? "normal",
    requiredCapabilities: ["search"],
    preferredCapabilities: thinkingLevel === "high" ? ["reasoning", "search"] : ["search"],
    preferFast: thinkingLevel !== "high",
    preferCheap: true,
    runtimeStats: options?.modelRuntimeStats,
    maxFallbacks: 3,
  });
  const searchModel = searchModelSelection.selected?.modelId
    ?? liveCatalog.find((model) => model.modelId !== "openrouter/auto")?.modelId
    ?? "openrouter/auto";
  const completion = await withTimeout(
    openRouterChatCompletion({
      model: searchModel,
      fallbackModels: searchModelSelection.fallbacks,
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
  if (completion && options?.actorClerkId) {
    await recordOpenRouterUsage({
      actorClerkId: options.actorClerkId,
      chatId: options.chatId,
      model: completion.model ?? searchModel,
      usage: completion.usage,
    }).catch(() => {});
  }
  const extractedUrls = extractUrls(text);
  const sources = await resolveWebSearchSources(extractedUrls);
  const validUrlSet = new Set(sources.map((source) => source.url));
  const sanitizedText = text
    .replace(/https?:\/\/[^\s)\]>"']+/g, (rawUrl) => {
      const parsed = parseHttpUrl(rawUrl);
      if (!parsed) return "";
      const normalized = parsed.toString();
      return validUrlSet.has(normalized) ? normalized : "";
    })
    .replace(/\s{2,}/g, " ")
    .trim();
  return {
    text: sanitizedText || text,
    urls: sources.map((source) => source.url),
    sources,
    provider: "model_fallback" as const,
  };
}

export async function runRagRetrieval(params: {
  actorClerkId: string;
  packId?: string;
  usePersonalResources: boolean;
  selectedAgentId?: string;
  message: string;
  logger?: { info: (message: string, context?: Record<string, unknown>) => void; warn: (message: string) => void };
}): Promise<RetrievalResult> {
  let retrieval: RetrievalResult = {
    citations: [],
    sourceBlock: "No retrieved sources.",
    diagnostics: {
      scopesAttempted: [],
      status: "not_requested",
      reason: "Retrieval was not requested for this route.",
    },
  };

  try {
    const [packResources, personalResources, agentResources] = await Promise.all([
      params.packId
        ? (convexQuery("resources:listPackResources", {
            actorClerkId: params.actorClerkId,
            packId: params.packId,
          }) as Promise<Array<unknown>>)
        : Promise.resolve([]),
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

    const scopesAttempted = [
      ...(params.packId ? ["pack"] : []),
      ...(params.usePersonalResources ? ["personal"] : []),
      ...(params.selectedAgentId ? ["agent"] : []),
    ];
    const hasRetrievalSources = packResources.length > 0 || personalResources.length > 0 || agentResources.length > 0;
    if (hasRetrievalSources) {
      const queryEmbedding = await openRouterEmbedding(params.message, MODEL_CONFIG.embedding);
      const rawRetrieval = (await convexAction("rag:retrieve", {
        actorClerkId: params.actorClerkId,
        packId: params.packId,
        agentId: params.selectedAgentId,
        includePack: Boolean(params.packId),
        includePersonal: params.usePersonalResources,
        embedding: queryEmbedding,
        topK: 8,
      })) as RetrievalResult;
      retrieval = limitRagRetrievalSources(rawRetrieval);
      retrieval.diagnostics = {
        scopesAttempted,
        status: retrieval.citations.length > 0 ? "retrieved" : "no_high_confidence_matches",
        reason:
          retrieval.citations.length > 0
            ? "Retrieved scoped resource evidence."
            : "Scoped retrieval returned no high-confidence matches.",
      };
      params.logger?.info("RAG retrieval complete", {
        sourceCount: retrieval.citations.length,
        maxSourceFiles: MAX_RAG_SOURCES,
        scopesAttempted,
      });
      if (retrieval.citations.length === 0) {
        params.logger?.warn("RAG retrieval returned zero high-confidence sources");
      }
    } else {
      retrieval.diagnostics = {
        scopesAttempted,
        status: scopesAttempted.length === 0 ? "not_requested" : "no_sources_available",
        reason:
          scopesAttempted.length === 0
            ? "No retrieval scopes were allowed for this route."
            : "No uploaded resources were available inside the allowed scopes.",
      };
    }
  } catch {
    retrieval = {
      citations: [],
      sourceBlock: "Retrieval unavailable. Continue with general instructional support.",
      diagnostics: {
        scopesAttempted: [
          ...(params.packId ? ["pack"] : []),
          ...(params.usePersonalResources ? ["personal"] : []),
          ...(params.selectedAgentId ? ["agent"] : []),
        ],
        status: "failed",
        reason: "Retrieval failed during embedding or vector search.",
      },
    };
    params.logger?.warn("RAG retrieval failed; using fallback source block");
  }

  return retrieval;
}
