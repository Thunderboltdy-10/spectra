export type SearxngResult = {
  url: string;
  title: string;
  content?: string;
  engine?: string;
};

type SearxngOptions = {
  limit?: number;
  timeoutMs?: number;
  language?: string;
};

const DEFAULT_SEARXNG_INSTANCES = [
  "https://searx.be",
  "https://search.bus-hit.me",
  "https://searxng.world",
  "https://paulgo.io",
  "https://searx.tiekoetter.com",
];

const DEFAULT_TIMEOUT_MS = 6500;
const MAX_TIMEOUT_MS = 15000;
const MIN_TIMEOUT_MS = 2500;

function normalizeInstance(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function configuredInstances() {
  const primary = process.env.SEARXNG_BASE_URL ? [process.env.SEARXNG_BASE_URL] : [];
  const fallbacks = (process.env.SEARXNG_FALLBACK_URLS ?? "")
    .split(/[,\s;]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  const merged = [...primary, ...fallbacks, ...DEFAULT_SEARXNG_INSTANCES]
    .map(normalizeInstance)
    .filter(Boolean);
  return Array.from(new Set(merged));
}

function configuredTimeoutMs() {
  const envValue = Number.parseInt(process.env.SEARXNG_TIMEOUT_MS ?? "", 10);
  if (!Number.isFinite(envValue)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, envValue));
}

export async function searxngSearch(query: string, options: SearxngOptions = {}): Promise<SearxngResult[]> {
  const instances = configuredInstances();
  const timeoutMs = Math.min(
    MAX_TIMEOUT_MS,
    Math.max(MIN_TIMEOUT_MS, options.timeoutMs ?? configuredTimeoutMs()),
  );
  const limit = Math.min(10, Math.max(3, options.limit ?? 6));
  const language = options.language ?? "en";

  for (const instance of instances) {
    try {
      const response = await fetch(
        `${instance}/search?q=${encodeURIComponent(query)}&format=json&language=${encodeURIComponent(language)}&safesearch=1`,
        {
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            Accept: "application/json",
            "User-Agent": "AI-School-Search/1.0",
          },
        },
      );
      if (!response.ok) continue;
      const payload = (await response.json()) as { results?: Array<Record<string, unknown>> };
      const results = (payload.results ?? [])
        .map((item) => ({
          url: typeof item.url === "string" ? item.url : "",
          title: typeof item.title === "string" ? item.title : "",
          content: typeof item.content === "string" ? item.content : "",
          engine: typeof item.engine === "string" ? item.engine : "",
        }))
        .filter((item) => item.url && item.title)
        .slice(0, limit);
      if (results.length > 0) {
        return results;
      }
    } catch {
      // Try the next public instance.
    }
  }

  return [];
}
