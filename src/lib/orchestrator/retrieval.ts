import { convexAction, convexQuery } from "@/lib/convex-server";
import { MODEL_CONFIG } from "@/lib/model-config";
import { getLiveCatalogSnapshot } from "@/lib/openrouter-catalog-cache";
import { openRouterChatCompletion, openRouterEmbeddingRequest } from "@/lib/openrouter";
import { withTimeout } from "@/lib/orchestrator/history";
import { isModelAllowedInTier, pickModelAndFallbacks, type CatalogModelEntry, type ModelRuntimeStat } from "@/lib/model-selection";
import { tavily, type TavilyClient, type TavilyExtractResponse, type TavilyGetResearchResponse, type TavilySearchResponse } from "@tavily/core";
import { recordOpenRouterUsage } from "@/lib/usage-tracking";

export type RetrievedCitation = {
  resourceId?: string;
  filename: string;
  page?: number;
  sourceType: "pack" | "personal" | "agent";
  text: string;
  score?: number;
};

export type RetrievalResult = {
  citations: RetrievedCitation[];
  sourceBlock: string;
  queryEmbedding?: number[];
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
    embeddingUsage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cost?: number;
    };
    embeddingDurationMs?: number;
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
  relevanceScore?: number;
  reliabilityScore?: number;
  reliabilityLabel?: "high" | "medium" | "low";
  reliabilityReason?: string;
  publishedDate?: string;
  favicon?: string;
  query?: string;
};

type SearchStrategy = "none" | "search" | "search_extract" | "extract_url" | "crawl" | "research";
type SearchTrigger =
  | "none"
  | "time_sensitive"
  | "explicit_search"
  | "research_mode"
  | "deep_research"
  | "read_url"
  | "crawl_request";

type SearchPlan = {
  strategy: SearchStrategy;
  trigger: SearchTrigger;
  query?: string;
  targetUrl?: string;
  maxResults?: number;
  maxExtractResults?: number;
  subqueries?: string[];
};

export type WebSearchOperation = {
  tool: "search" | "extract" | "crawl" | "research" | "model_fallback";
  status: "completed" | "failed" | "skipped";
  query?: string;
  targetUrl?: string;
  resultCount?: number;
  selectedUrls?: string[];
  durationMs?: number;
  costCredits?: number;
  reason?: string;
};

export type WebSearchResult = {
  text: string;
  urls: string[];
  sources: WebSearchSource[];
  provider: "tavily" | "model_fallback" | "disabled" | "error";
  strategy?: SearchStrategy;
  triggeredBy?: SearchTrigger;
  operations?: WebSearchOperation[];
  costCredits?: number;
  fallbackReason?: string;
  modelUsed?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
  durationMs?: number;
};

const MAX_WEB_SOURCES = 6;
export const MAX_RAG_SOURCES = 5;
const MAX_RESEARCH_SUBQUESTIONS = 3;
const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
const URL_VALIDATION_TIMEOUT_MS = 3500;
const TITLE_PARSE_TIMEOUT_MS = 2000;
const TAVILY_TIMEOUT_MS = 12_000;

const tavilySearchCache = new Map<string, { expiresAt: number; response: TavilySearchResponse }>();

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

export function scoreWebSource(url: string): ReliabilityScore {
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

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function reliabilityLabelForScore(score: number | undefined): "high" | "medium" | "low" {
  if (typeof score !== "number" || !Number.isFinite(score)) return "medium";
  if (score >= 0.75) return "high";
  if (score <= 0.45) return "low";
  return "medium";
}

function clampSnippet(value: string | undefined, max = 280) {
  if (!value) return undefined;
  const compact = compactText(value);
  if (!compact) return undefined;
  return compact.slice(0, max);
}

function domainFromUrl(url: string) {
  const parsed = parseHttpUrl(url);
  return parsed ? parsed.hostname.toLowerCase().replace(/^www\./, "") : "";
}

function mergeWebSources(items: WebSearchSource[]) {
  const deduped = new Map<string, WebSearchSource>();
  for (const item of items) {
    if (!item.url) continue;
    const key = item.url;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, item);
      continue;
    }
    deduped.set(key, {
      ...existing,
      title: existing.title || item.title,
      domain: existing.domain || item.domain,
      snippet: existing.snippet || item.snippet,
      relevanceScore: Math.max(existing.relevanceScore ?? 0, item.relevanceScore ?? 0) || undefined,
      reliabilityScore: Math.max(existing.reliabilityScore ?? 0, item.reliabilityScore ?? 0) || undefined,
      reliabilityLabel:
        reliabilityLabelForScore(
          Math.max(existing.reliabilityScore ?? 0, item.reliabilityScore ?? 0) || undefined,
        ),
      reliabilityReason: existing.reliabilityReason || item.reliabilityReason,
      publishedDate: existing.publishedDate || item.publishedDate,
      favicon: existing.favicon || item.favicon,
      query: existing.query || item.query,
    });
  }
  return [...deduped.values()].slice(0, Math.max(MAX_WEB_SOURCES, 12));
}

function buildSearchCacheKey(query: string, options: {
  maxResults: number;
  topic?: "general" | "news" | "finance";
  days?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
}) {
  return JSON.stringify({
    q: compactText(query).toLowerCase(),
    maxResults: options.maxResults,
    topic: options.topic ?? "general",
    days: options.days ?? null,
    includeDomains: (options.includeDomains ?? []).slice().sort(),
    excludeDomains: (options.excludeDomains ?? []).slice().sort(),
  });
}

function getTavilyClient(): TavilyClient | null {
  const apiKey = (process.env.TAVILY_API_KEY ?? "").trim();
  if (!apiKey) return null;
  return tavily({ apiKey, clientSource: "ai-school" });
}

function extractTargetUrlFromMessage(message: string) {
  const candidate = extractUrls(message)[0];
  return candidate ?? undefined;
}

function buildResearchSubqueries(message: string, explicit?: string[]) {
  if (Array.isArray(explicit) && explicit.length > 0) {
    return explicit.map((item) => compactText(item)).filter(Boolean).slice(0, MAX_RESEARCH_SUBQUESTIONS);
  }

  const normalized = compactText(message);
  if (!normalized) return [];

  const cleaned = normalized
    .replace(/\b(research|investigate|analy[sz]e|compare|evaluate|deep dive|thoroughly)\b/gi, "")
    .replace(/[?]/g, "")
    .trim();

  const split = cleaned
    .split(/\b(?: and | vs\.?| versus |,|;| also | plus )\b/i)
    .map((item) => compactText(item))
    .filter((item) => item.length >= 8);

  if (split.length > 0) {
    return split.slice(0, MAX_RESEARCH_SUBQUESTIONS);
  }

  return [cleaned || normalized].slice(0, MAX_RESEARCH_SUBQUESTIONS);
}

function formatSourcesAsBriefing(sources: WebSearchSource[], heading: string) {
  if (!sources.length) return "";
  return [
    heading,
    ...sources.slice(0, 12).map((source, index) => {
      const rel = typeof source.relevanceScore === "number" ? ` | relevance ${source.relevanceScore.toFixed(2)}` : "";
      const reliability = typeof source.reliabilityScore === "number" ? ` | reliability ${source.reliabilityScore.toFixed(2)} (${source.reliabilityLabel ?? "medium"})` : "";
      return `${index + 1}. ${source.title}\n${source.snippet ?? "No snippet available."}\n${source.url}${rel}${reliability}`;
    }),
  ].join("\n\n");
}

function toWebSourceFromSearchResult(result: {
  url: string;
  title?: string;
  content?: string;
  score?: number;
  publishedDate?: string;
  favicon?: string;
}, query: string): WebSearchSource {
  const reliability = scoreWebSource(result.url);
  const domain = domainFromUrl(result.url);
  const title = compactText(result.title ?? "") || domain || result.url;
  return {
    url: result.url,
    title,
    domain,
    snippet: clampSnippet(result.content),
    relevanceScore: typeof result.score === "number" ? result.score : undefined,
    reliabilityScore: reliability.score,
    reliabilityLabel: reliability.confidence,
    reliabilityReason: reliability.reason,
    publishedDate: result.publishedDate,
    favicon: result.favicon,
    query,
  };
}

async function runTavilySearchWithCache(client: TavilyClient, query: string, params: {
  maxResults: number;
  topic?: "general" | "news" | "finance";
  days?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
}) {
  const key = buildSearchCacheKey(query, params);
  const now = Date.now();
  const cached = tavilySearchCache.get(key);
  if (cached && cached.expiresAt > now) {
    return { response: cached.response, fromCache: true };
  }

  const response = await withTimeout(
    client.search(query, {
      searchDepth: "advanced",
      topic: params.topic ?? "general",
      days: params.days,
      maxResults: params.maxResults,
      includeRawContent: false,
      includeFavicon: true,
      includeUsage: true,
      includeDomains: params.includeDomains,
      excludeDomains: params.excludeDomains,
      includeAnswer: false,
      timeout: TAVILY_TIMEOUT_MS,
    }),
    TAVILY_TIMEOUT_MS + 1_000,
  );

  if (!response) {
    throw new Error("Tavily search timed out.");
  }

  tavilySearchCache.set(key, {
    response,
    expiresAt: now + SEARCH_CACHE_TTL_MS,
  });
  return { response, fromCache: false };
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

async function resolveWebSearchSources(urls: string[], snippetByUrl?: Map<string, string>) {
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

async function runOnlineModelFallbackSearch(
  message: string,
  thinkingLevel: "low" | "medium" | "high",
  options?: {
    actorClerkId?: string;
    chatId?: string;
    modelCatalog?: CatalogModelEntry[];
    spendingTier?: "normal" | "expensive_blocked" | "cheap_only" | "free_only";
    modelRuntimeStats?: Record<string, ModelRuntimeStat>;
    strategy?: SearchStrategy;
    trigger?: SearchTrigger;
    reason?: string;
  },
): Promise<WebSearchResult> {
  const liveCatalog = options?.modelCatalog?.length
    ? options.modelCatalog
    : (await getLiveCatalogSnapshot()).models;
  const spendingTier = options?.spendingTier ?? "normal";
  const searchModelSelection = pickModelAndFallbacks({
    catalog: liveCatalog.filter((model) => model.modelId !== "openrouter/auto"),
    tier: spendingTier,
    requiredCapabilities: ["search"],
    preferredCapabilities: thinkingLevel === "high" ? ["reasoning", "search"] : ["search"],
    preferFast: thinkingLevel !== "high",
    preferCheap: true,
    runtimeStats: options?.modelRuntimeStats,
    maxFallbacks: 3,
  });
  const searchModel = searchModelSelection.selected?.modelId
    ?? searchModelSelection.fallbacks.find((candidate) =>
      liveCatalog.some((model) => model.modelId === candidate && isModelAllowedInTier(model, spendingTier)))
    ?? liveCatalog.find((model) => model.modelId !== "openrouter/auto" && isModelAllowedInTier(model, spendingTier))?.modelId;
  if (!searchModel) {
    return {
      text: "",
      urls: [],
      sources: [],
      provider: "disabled",
      strategy: options?.strategy,
      triggeredBy: options?.trigger,
      fallbackReason: options?.reason,
      operations: [
        {
          tool: "model_fallback",
          status: "skipped",
          reason: "No search-capable model available in the active spending tier.",
        },
      ],
    };
  }
  const onlineModel = searchModel.endsWith(":online") ? searchModel : `${searchModel}:online`;
  const onlineFallbackModels = searchModelSelection.fallbacks
    .filter((candidate) => candidate !== searchModel)
    .map((candidate) => (candidate.endsWith(":online") ? candidate : `${candidate}:online`));
  const startedAt = Date.now();
  const completionPromise = openRouterChatCompletion({
    model: onlineModel,
    fallbackModels: onlineFallbackModels,
    messages: [
      {
        role: "system",
        content:
          "Use integrated web search to answer. Return concise bullets and include direct source URLs. Do not invent URLs.",
      },
      {
        role: "user",
        content: message,
      },
    ],
    temperature: 0.2,
  });
  let usageRecorded = false;
  const recordUsage = async (completion: Awaited<typeof completionPromise>) => {
    if (!options?.actorClerkId || usageRecorded) return;
    usageRecorded = true;
    await recordOpenRouterUsage({
      actorClerkId: options.actorClerkId,
      chatId: options.chatId,
      model: completion.model ?? onlineModel,
      usage: completion.usage,
    }).catch(() => {});
  };
  void completionPromise.then((completion) => {
    void recordUsage(completion);
  }).catch(() => {});

  const completion = await withTimeout(
    completionPromise,
    8000,
  );

  const text = completion?.choices?.[0]?.message?.content?.trim() ?? "";
  const modelUsed = completion?.model ?? onlineModel;
  const usage = completion?.usage;
  const durationMs = Date.now() - startedAt;
  if (completion) {
    await recordUsage(completion);
  }
  const extractedUrls = extractUrls(text);
  if (extractedUrls.length === 0) {
    return {
      text,
      urls: [],
      sources: [],
      provider: "error",
      strategy: options?.strategy,
      triggeredBy: options?.trigger,
      fallbackReason: options?.reason,
      operations: [
        {
          tool: "model_fallback",
          status: "failed",
          query: message,
          resultCount: 0,
          durationMs,
          reason: "Model fallback did not return valid source URLs.",
        },
      ],
      modelUsed,
      usage,
      durationMs,
    };
  }
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
    strategy: options?.strategy,
    triggeredBy: options?.trigger,
    fallbackReason: options?.reason,
    operations: [
      {
        tool: "model_fallback",
        status: "completed",
        query: message,
        resultCount: sources.length,
        selectedUrls: sources.map((source) => source.url),
        durationMs,
        reason: options?.reason,
      },
    ],
    modelUsed,
    usage,
    durationMs,
  };
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
    searchPlan?: SearchPlan;
  },
): Promise<WebSearchResult> {
  const plan = options?.searchPlan ?? {
    strategy: "search" as const,
    trigger: "time_sensitive" as const,
    query: message,
    maxResults: thinkingLevel === "high" ? 5 : 3,
    maxExtractResults: thinkingLevel === "high" ? 2 : 1,
  };
  const strategy = plan.strategy;
  const trigger = plan.trigger;
  const query = compactText(plan.query ?? message);
  const targetUrl = plan.targetUrl ?? extractTargetUrlFromMessage(message);
  const maxResults = Math.max(1, Math.min(strategy === "search_extract" || strategy === "research" ? 8 : 5, plan.maxResults ?? (thinkingLevel === "high" ? 5 : 3)));
  const maxExtractResults = Math.max(1, Math.min(3, plan.maxExtractResults ?? (strategy === "search_extract" ? 2 : 1)));

  if (strategy === "none" || !query) {
    return {
      text: "",
      urls: [],
      sources: [],
      provider: "disabled",
      strategy,
      triggeredBy: trigger,
      operations: [{ tool: "search", status: "skipped", reason: "Search strategy resolved to none." }],
    };
  }

  const tavilyClient = getTavilyClient();
  let tavilyFailureReason: string | undefined;
  if (!tavilyClient) {
    tavilyFailureReason = "TAVILY_API_KEY missing.";
  }

  if (tavilyClient) {
    try {
      const operations: WebSearchOperation[] = [];
      const startAt = Date.now();
      let costCredits = 0;

      if (strategy === "extract_url") {
        if (!targetUrl) {
          throw new Error("No valid URL was provided for extract mode.");
        }
        const extractStartedAt = Date.now();
        const extractResponse = await withTimeout(
          tavilyClient.extract([targetUrl], {
            extractDepth: "advanced",
            format: "markdown",
            includeFavicon: true,
            includeUsage: true,
            chunksPerSource: 3,
            timeout: TAVILY_TIMEOUT_MS,
          }),
          TAVILY_TIMEOUT_MS + 1_000,
        );
        if (!extractResponse) {
          throw new Error("Tavily extract timed out.");
        }
        costCredits += extractResponse.usage?.credits ?? 0;
        const sources = extractResponse.results.map((result) => {
          const reliability = scoreWebSource(result.url);
          const domain = domainFromUrl(result.url);
          return {
            url: result.url,
            title: result.title || domain || result.url,
            domain,
            snippet: clampSnippet(result.rawContent, 320),
            relevanceScore: undefined,
            reliabilityScore: reliability.score,
            reliabilityLabel: reliability.confidence,
            reliabilityReason: reliability.reason,
            favicon: result.favicon,
            query,
          } satisfies WebSearchSource;
        });

        operations.push({
          tool: "extract",
          status: "completed",
          query,
          targetUrl,
          selectedUrls: [targetUrl],
          resultCount: sources.length,
          durationMs: Date.now() - extractStartedAt,
          costCredits: extractResponse.usage?.credits,
        });
        return {
          text: formatSourcesAsBriefing(sources, "=== TAVILY EXTRACT BRIEFING ==="),
          urls: sources.map((source) => source.url),
          sources,
          provider: "tavily",
          strategy,
          triggeredBy: trigger,
          operations,
          costCredits,
          durationMs: Date.now() - startAt,
        };
      }

      if (strategy === "crawl") {
        if (!targetUrl) {
          throw new Error("No valid URL was provided for crawl mode.");
        }
        const crawlStartedAt = Date.now();
        const crawlResponse = await withTimeout(
          tavilyClient.crawl(targetUrl, {
            limit: 8,
            maxDepth: 2,
            maxBreadth: 8,
            extractDepth: "basic",
            format: "markdown",
            includeFavicon: true,
            includeUsage: true,
            timeout: TAVILY_TIMEOUT_MS,
            chunksPerSource: 2,
          }),
          TAVILY_TIMEOUT_MS + 2_000,
        );
        if (!crawlResponse) {
          throw new Error("Tavily crawl timed out.");
        }
        costCredits += crawlResponse.usage?.credits ?? 0;
        const sources = crawlResponse.results.map((result) => {
          const reliability = scoreWebSource(result.url);
          const domain = domainFromUrl(result.url);
          return {
            url: result.url,
            title: domain || result.url,
            domain,
            snippet: clampSnippet(result.rawContent, 320),
            reliabilityScore: reliability.score,
            reliabilityLabel: reliability.confidence,
            reliabilityReason: reliability.reason,
            favicon: result.favicon,
            query,
          } satisfies WebSearchSource;
        });

        operations.push({
          tool: "crawl",
          status: "completed",
          query,
          targetUrl,
          selectedUrls: sources.map((source) => source.url),
          resultCount: sources.length,
          durationMs: Date.now() - crawlStartedAt,
          costCredits: crawlResponse.usage?.credits,
        });
        return {
          text: formatSourcesAsBriefing(sources, "=== TAVILY CRAWL BRIEFING ==="),
          urls: sources.map((source) => source.url),
          sources,
          provider: "tavily",
          strategy,
          triggeredBy: trigger,
          operations,
          costCredits,
          durationMs: Date.now() - startAt,
        };
      }

      if (strategy === "research") {
        const researchStartedAt = Date.now();
        const researchResponse = await withTimeout(
          tavilyClient.research(query, {
            model: "auto",
            citationFormat: "numbered",
            timeout: TAVILY_TIMEOUT_MS,
          }),
          TAVILY_TIMEOUT_MS + 2_000,
        );

        if (!researchResponse || typeof researchResponse !== "object" || !("requestId" in researchResponse)) {
          throw new Error("Tavily research did not return a valid request id.");
        }

        let researchResult = await tavilyClient.getResearch(researchResponse.requestId);
        const pollStartedAt = Date.now();
        while (researchResult.status !== "completed" && Date.now() - pollStartedAt < 20_000) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          researchResult = await tavilyClient.getResearch(researchResponse.requestId);
        }

        if (researchResult.status !== "completed") {
          throw new Error(`Tavily research status remained ${researchResult.status}.`);
        }

        const completed = researchResult as TavilyGetResearchResponse;
        const sources = (completed.sources ?? []).map((source) => {
          const reliability = scoreWebSource(source.url);
          const domain = domainFromUrl(source.url);
          return {
            url: source.url,
            title: source.title || domain || source.url,
            domain,
            snippet: undefined,
            reliabilityScore: reliability.score,
            reliabilityLabel: reliability.confidence,
            reliabilityReason: reliability.reason,
            query,
          } satisfies WebSearchSource;
        });
        operations.push({
          tool: "research",
          status: "completed",
          query,
          resultCount: sources.length,
          selectedUrls: sources.map((source) => source.url),
          durationMs: Date.now() - researchStartedAt,
        });

        const content = typeof completed.content === "string"
          ? completed.content
          : JSON.stringify(completed.content, null, 2);

        return {
          text: compactText(content),
          urls: sources.map((source) => source.url),
          sources,
          provider: "tavily",
          strategy,
          triggeredBy: trigger,
          operations,
          costCredits,
          durationMs: Date.now() - startAt,
        };
      }

      if (strategy === "search_extract") {
        const subqueries = buildResearchSubqueries(query, plan.subqueries);
        const searchCalls = await Promise.all(
          subqueries.map(async (subquery) => {
            const searchStartedAt = Date.now();
            const { response, fromCache } = await runTavilySearchWithCache(tavilyClient, subquery, {
              maxResults,
              topic: "general",
            });
            operations.push({
              tool: "search",
              status: "completed",
              query: subquery,
              resultCount: response.results.length,
              durationMs: Date.now() - searchStartedAt,
              costCredits: fromCache ? 0 : response.usage?.credits,
              reason: fromCache ? "cache_hit_30m" : undefined,
            });
            costCredits += fromCache ? 0 : (response.usage?.credits ?? 0);
            return { subquery, response };
          }),
        );

        const searchSources = mergeWebSources(
          searchCalls.flatMap(({ subquery, response }) =>
            response.results.slice(0, maxResults).map((result) =>
              toWebSourceFromSearchResult(result, subquery)),
          ),
        );

        const urlsForExtract = Array.from(
          new Set(
            searchCalls.flatMap(({ response }) =>
              response.results.slice(0, maxExtractResults).map((item) => item.url),
            ),
          ),
        ).slice(0, 8);

        let extractedSources: WebSearchSource[] = [];
        if (urlsForExtract.length > 0) {
          const extractStartedAt = Date.now();
          const extractResponse: TavilyExtractResponse | null = await withTimeout(
            tavilyClient.extract(urlsForExtract, {
              extractDepth: "advanced",
              format: "markdown",
              includeFavicon: true,
              includeUsage: true,
              chunksPerSource: 2,
              timeout: TAVILY_TIMEOUT_MS,
            }),
            TAVILY_TIMEOUT_MS + 1_000,
          );
          if (extractResponse) {
            operations.push({
              tool: "extract",
              status: "completed",
              query,
              selectedUrls: urlsForExtract,
              resultCount: extractResponse.results.length,
              durationMs: Date.now() - extractStartedAt,
              costCredits: extractResponse.usage?.credits,
            });
            costCredits += extractResponse.usage?.credits ?? 0;
            extractedSources = extractResponse.results.map((result) => {
              const reliability = scoreWebSource(result.url);
              const domain = domainFromUrl(result.url);
              return {
                url: result.url,
                title: result.title || domain || result.url,
                domain,
                snippet: clampSnippet(result.rawContent, 380),
                reliabilityScore: reliability.score,
                reliabilityLabel: reliability.confidence,
                reliabilityReason: reliability.reason,
                favicon: result.favicon,
                query,
              } satisfies WebSearchSource;
            });
          } else {
            operations.push({
              tool: "extract",
              status: "failed",
              query,
              selectedUrls: urlsForExtract,
              reason: "Tavily extract timed out.",
            });
          }
        }

        const mergedSources = mergeWebSources([...searchSources, ...extractedSources]).slice(0, 12);
        return {
          text: formatSourcesAsBriefing(
            mergedSources,
            "=== TAVILY RESEARCH BRIEFING (search + extract) ===",
          ),
          urls: mergedSources.map((source) => source.url),
          sources: mergedSources,
          provider: "tavily",
          strategy,
          triggeredBy: trigger,
          operations,
          costCredits,
          durationMs: Date.now() - startAt,
        };
      }

      const searchStartedAt = Date.now();
      const { response, fromCache } = await runTavilySearchWithCache(tavilyClient, query, {
        maxResults,
        topic: trigger === "time_sensitive" ? "news" : "general",
      });
      operations.push({
        tool: "search",
        status: "completed",
        query,
        resultCount: response.results.length,
        durationMs: Date.now() - searchStartedAt,
        costCredits: fromCache ? 0 : response.usage?.credits,
        reason: fromCache ? "cache_hit_30m" : undefined,
      });
      costCredits += fromCache ? 0 : (response.usage?.credits ?? 0);

      const sources = mergeWebSources(
        response.results.slice(0, maxResults).map((result) => toWebSourceFromSearchResult(result, query)),
      );
      return {
        text: formatSourcesAsBriefing(sources, "=== TAVILY SEARCH BRIEFING ==="),
        urls: sources.map((source) => source.url),
        sources,
        provider: "tavily",
        strategy,
        triggeredBy: trigger,
        operations,
        costCredits,
        durationMs: Date.now() - startAt,
      };
    } catch (error) {
      tavilyFailureReason = error instanceof Error ? error.message : String(error);
    }
  }

  const allowModelFallback = strategy === "search" || strategy === "extract_url" || strategy === "crawl";
  if (!allowModelFallback) {
    return {
      text: "",
      urls: [],
      sources: [],
      provider: "error",
      strategy,
      triggeredBy: trigger,
      fallbackReason: tavilyFailureReason ?? "Unknown Tavily failure.",
      operations: [
        {
          tool: "search",
          status: "failed",
          query,
          reason: "Tavily failed and online-model fallback is disabled for this research strategy.",
        },
      ],
    };
  }

  return runOnlineModelFallbackSearch(message, thinkingLevel, {
    ...options,
    strategy,
    trigger,
    reason: tavilyFailureReason ?? "Unknown Tavily failure.",
  });
}

export async function runRagRetrieval(params: {
  actorClerkId: string;
  chatId?: string;
  packId?: string;
  usePersonalResources: boolean;
  selectedAgentId?: string;
  message: string;
  logger?: { info: (message: string, context?: Record<string, unknown>) => void; warn: (message: string) => void };
}): Promise<RetrievalResult> {
  let embeddingModel: string | undefined;
  let queryEmbedding: number[] | undefined;
  let embeddingUsage:
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        cost?: number;
      }
    | undefined;
  let embeddingDurationMs: number | undefined;
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
    const isProcessedResource = (value: unknown): value is { status: "processed" } => {
      if (!value || typeof value !== "object") return false;
      const status = (value as { status?: string }).status;
      return status === "processed";
    };
    const [packResources, personalResources, agentResources, selectedAgent] = await Promise.all([
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
      params.selectedAgentId
        ? (convexQuery("agents:getAgent", {
            actorClerkId: params.actorClerkId,
            agentId: params.selectedAgentId,
          }) as Promise<{ _id: string; guidelinesTopicMap?: string[] }>)
        : Promise.resolve(null),
    ]);

    const scopesAttempted = [
      ...(params.packId ? ["pack"] : []),
      ...(params.usePersonalResources ? ["personal"] : []),
      ...(params.selectedAgentId ? ["agent"] : []),
    ];
    const processedPackResources = packResources.filter(isProcessedResource);
    const processedPersonalResources = personalResources.filter(isProcessedResource);
    const processedAgentResources = agentResources.filter(isProcessedResource);
    const hasRetrievalSources =
      processedPackResources.length > 0
      || processedPersonalResources.length > 0
      || processedAgentResources.length > 0;
    if (hasRetrievalSources) {
      const embeddingStartedAt = Date.now();
      const embeddingResult = await openRouterEmbeddingRequest(params.message, MODEL_CONFIG.embedding);
      embeddingDurationMs = Date.now() - embeddingStartedAt;
      embeddingModel = embeddingResult.model ?? MODEL_CONFIG.embedding;
      embeddingUsage = embeddingResult.usage;
      queryEmbedding = embeddingResult.embedding;
      await recordOpenRouterUsage({
        actorClerkId: params.actorClerkId,
        chatId: params.chatId,
        model: embeddingModel,
        usage: embeddingUsage,
        skipIfZeroTokens: false,
      }).catch(() => {});
      const rawRetrieval = (await convexAction("rag:retrieve", {
        actorClerkId: params.actorClerkId,
        packId: params.packId,
        agentId: processedAgentResources.length > 0 ? params.selectedAgentId : undefined,
        topicMap:
          processedAgentResources.length > 0
            ? (selectedAgent?.guidelinesTopicMap ?? [])
            : [],
        includePack: processedPackResources.length > 0 && Boolean(params.packId),
        includePersonal: processedPersonalResources.length > 0 && params.usePersonalResources,
        embedding: queryEmbedding,
        topK: 8,
      })) as RetrievalResult;
      let retrievalCombined = rawRetrieval;
      if (
        params.selectedAgentId
        && processedAgentResources.length > 0
        && rawRetrieval.citations.length === 0
        && (processedPackResources.length > 0 || processedPersonalResources.length > 0)
      ) {
        const fallbackRetrieval = (await convexAction("rag:retrieve", {
          actorClerkId: params.actorClerkId,
          packId: params.packId,
          agentId: undefined,
          topicMap: [],
          includePack: processedPackResources.length > 0 && Boolean(params.packId),
          includePersonal: processedPersonalResources.length > 0 && params.usePersonalResources,
          embedding: queryEmbedding,
          topK: 8,
        })) as RetrievalResult;
        retrievalCombined = {
          citations: [...rawRetrieval.citations, ...fallbackRetrieval.citations],
          sourceBlock: [rawRetrieval.sourceBlock, fallbackRetrieval.sourceBlock]
            .filter((item) => item && item.trim().length > 0)
            .join("\n\n"),
        };
      }
      retrieval = limitRagRetrievalSources(retrievalCombined);
      retrieval.queryEmbedding = queryEmbedding;
      retrieval.diagnostics = {
        scopesAttempted,
        status: retrieval.citations.length > 0 ? "retrieved" : "no_high_confidence_matches",
        reason:
          retrieval.citations.length > 0
            ? "Retrieved scoped resource evidence."
            : "Scoped retrieval returned no high-confidence matches.",
        embeddingModel,
        embeddingUsage,
        embeddingDurationMs,
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
      const hasAnyScopedResources = packResources.length > 0 || personalResources.length > 0 || agentResources.length > 0;
      retrieval.diagnostics = {
        scopesAttempted,
        status: scopesAttempted.length === 0 ? "not_requested" : "no_sources_available",
        reason:
          scopesAttempted.length === 0
            ? "No retrieval scopes were allowed for this route."
            : hasAnyScopedResources
              ? "Retrieval skipped: resources exist but none are fully processed yet."
              : "No uploaded resources were available inside the allowed scopes.",
        embeddingModel,
        embeddingUsage,
        embeddingDurationMs,
      };
      retrieval.queryEmbedding = queryEmbedding;
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
        embeddingModel,
        embeddingUsage,
        embeddingDurationMs,
      },
    };
    params.logger?.warn("RAG retrieval failed; using fallback source block");
  }

  return retrieval;
}
