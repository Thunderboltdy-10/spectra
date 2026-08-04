import { getSpectraModelProfile, getSpectraProviderRouting } from "../../ai/model-config";
import { canonicalizeSourceUrl } from "../records";

export type ResearchMode = "quick" | "verified" | "deep";
export type ParallelSearchResult = { title: string; url: string; content: string; publishedAt?: string; authority: "primary" | "secondary" | "unknown" };
export type PurposefulSearch = { purpose: string; query: string };
export type ParallelSearchCall = (search: PurposefulSearch, options: { maxResults: number; signal?: AbortSignal }) => Promise<ParallelSearchResult[]>;

function authority(url: string) {
  const hostname = new URL(url).hostname;
  if (/\.(?:gov|edu)$/i.test(hostname) || /(?:who\.int|un\.org|europa\.eu)$/i.test(hostname)) return "primary" as const;
  return "unknown" as const;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !Array.isArray(entry))) : [];
}

export async function openRouterParallelSearch(search: PurposefulSearch, options: { maxResults: number; signal?: AbortSignal }): Promise<ParallelSearchResult[]> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("PROVIDER_UNAVAILABLE: OpenRouter is not configured.");
  const profile = getSpectraModelProfile();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000", "X-OpenRouter-Title": "Spectra Parallel Research" },
    body: JSON.stringify({
      model: profile.route,
      provider: getSpectraProviderRouting("primary"),
      messages: [{ role: "user", content: `Search purpose: ${search.purpose}\nQuery: ${search.query}\nReturn the strongest directly relevant sources. Do not answer beyond the evidence.` }],
      tools: [{
        type: "openrouter:web_search",
        parameters: {
          engine: "parallel",
          max_results: Math.max(1, Math.min(20, options.maxResults)),
          max_total_results: Math.max(1, Math.min(20, options.maxResults)),
          max_uses: 1,
          search_context_size: "high",
        },
      }],
      max_tool_calls: 1,
      reasoning: { effort: profile.reasoningProfile, exclude: true },
    }),
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`PROVIDER_UNAVAILABLE: Parallel search returned ${response.status}.`);
  const payload = await response.json() as Record<string, unknown>;
  const message = rows(payload.choices)[0]?.message as Record<string, unknown> | undefined;
  const candidates = [
    ...rows(message?.annotations).flatMap((entry) => {
      const citation = entry.url_citation && typeof entry.url_citation === "object" ? entry.url_citation as Record<string, unknown> : entry;
      return [citation];
    }),
    ...rows(payload.web_results),
  ];
  const seen = new Set<string>();
  return candidates.flatMap((entry) => {
    if (typeof entry.url !== "string") return [];
    let url: string;
    try { url = canonicalizeSourceUrl(entry.url); } catch { return []; }
    if (seen.has(url)) return [];
    seen.add(url);
    return [{
      title: typeof entry.title === "string" ? entry.title.slice(0, 500) : new URL(url).hostname,
      url,
      content: typeof entry.content === "string" ? entry.content.slice(0, 8_000) : typeof entry.snippet === "string" ? entry.snippet.slice(0, 8_000) : "",
      ...(typeof entry.published_at === "string" ? { publishedAt: entry.published_at } : {}),
      authority: authority(url),
    }];
  }).slice(0, options.maxResults);
}

export async function conductParallelResearch(input: { mode: ResearchMode; searches: PurposefulSearch[]; signal?: AbortSignal; search?: ParallelSearchCall }) {
  const maximumCalls = input.mode === "quick" ? 1 : input.mode === "verified" ? 2 : 5;
  const purposeful = input.searches.filter((entry, index, rows) => entry.query.trim().length >= 3 && rows.findIndex((candidate) => candidate.purpose.trim().toLowerCase() === entry.purpose.trim().toLowerCase()) === index).slice(0, maximumCalls);
  const execute = input.search ?? openRouterParallelSearch;
  const byUrl = new Map<string, ParallelSearchResult>();
  let calls = 0;
  for (const search of purposeful) {
    if (input.signal?.aborted) throw input.signal.reason;
    const results = await execute(search, { maxResults: 20, signal: input.signal });
    calls += 1;
    for (const result of results) byUrl.set(canonicalizeSourceUrl(result.url), result);
    const values = [...byUrl.values()];
    const sufficient = input.mode === "quick" ? values.length >= 3 : input.mode === "verified" ? values.length >= 5 && values.some((entry) => entry.authority === "primary") : values.length >= 8 && values.filter((entry) => entry.authority === "primary").length >= 2;
    if (sufficient) break;
  }
  return { mode: input.mode, calls, stoppedEarly: calls < Math.min(maximumCalls, purposeful.length), results: [...byUrl.values()] };
}
