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
  "https://search.inetol.net",
  "https://searx.tiekoetter.com",
  "https://search.ononoki.org",
  "https://search.mdosch.de",
  "https://search.rhscz.eu",
  "https://searx.rhscz.eu",
  "https://searxng.site",
  "https://priv.au",
  "https://searx.ro",
  "https://search.bladerunn.in",
  "https://etsi.me",
];

const DEFAULT_TIMEOUT_MS = 6000;
const MAX_TIMEOUT_MS = 15000;
const MIN_TIMEOUT_MS = 2500;
const RETRY_TIMEOUT_MS = 8000;
const BATCH_SIZE = 2;

// Instance health tracking — skip recently-failed instances for 5 minutes
const instanceFailures = new Map<string, number>();
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

function isInstanceHealthy(instance: string): boolean {
  const failedAt = instanceFailures.get(instance);
  if (!failedAt) return true;
  if (Date.now() - failedAt > FAILURE_COOLDOWN_MS) {
    instanceFailures.delete(instance);
    return true;
  }
  return false;
}

function markInstanceFailed(instance: string) {
  instanceFailures.set(instance, Date.now());
}

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

type InstanceOutcome =
  | { kind: "success"; instance: string; results: SearxngResult[] }
  | { kind: "empty"; instance: string }
  | { kind: "failed"; instance: string; error: string }
  | { kind: "aborted"; instance: string };

async function queryInstance(params: {
  instance: string;
  query: string;
  language: string;
  limit: number;
  timeoutMs: number;
  controller: AbortController;
}): Promise<InstanceOutcome> {
  const { instance, query, language, limit, timeoutMs, controller } = params;
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(
      `${instance}/search?q=${encodeURIComponent(query)}&format=json&language=${encodeURIComponent(language)}&safesearch=1`,
      {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "AI-School-Search/1.0",
        },
      },
    );
    if (!response.ok) {
      console.warn(`[searxng] ${instance} returned ${response.status}`);
      markInstanceFailed(instance);
      return { kind: "failed", instance, error: `HTTP ${response.status}` };
    }
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
      return { kind: "success", instance, results };
    }
    console.warn(`[searxng] ${instance} returned 0 results for "${query.slice(0, 60)}"`);
    return { kind: "empty", instance };
  } catch (error) {
    if (controller.signal.aborted) {
      if (timedOut) {
        markInstanceFailed(instance);
        return { kind: "failed", instance, error: "timeout" };
      }
      return { kind: "aborted", instance };
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[searxng] ${instance} failed: ${msg}`);
    markInstanceFailed(instance);
    return { kind: "failed", instance, error: msg };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function runParallelBatch(params: {
  instances: string[];
  query: string;
  language: string;
  limit: number;
  timeoutMs: number;
}) {
  const controllers = new Map<string, AbortController>();
  for (const instance of params.instances) {
    controllers.set(instance, new AbortController());
  }

  let resolved = false;
  let completed = 0;
  const outcomes: InstanceOutcome[] = [];

  return new Promise<{ winner?: { instance: string; results: SearxngResult[] }; outcomes: InstanceOutcome[] }>((resolve) => {
    for (const instance of params.instances) {
      const controller = controllers.get(instance);
      if (!controller) continue;
      void queryInstance({
        instance,
        query: params.query,
        language: params.language,
        limit: params.limit,
        timeoutMs: params.timeoutMs,
        controller,
      }).then((outcome) => {
        outcomes.push(outcome);
        completed += 1;

        if (!resolved && outcome.kind === "success") {
          resolved = true;
          for (const [candidate, candidateController] of controllers.entries()) {
            if (candidate !== outcome.instance) candidateController.abort();
          }
          resolve({
            winner: {
              instance: outcome.instance,
              results: outcome.results,
            },
            outcomes,
          });
          return;
        }

        if (!resolved && completed === params.instances.length) {
          resolved = true;
          resolve({ outcomes });
        }
      });
    }
  });
}

export async function searxngSearch(query: string, options: SearxngOptions = {}): Promise<SearxngResult[]> {
  const instances = configuredInstances();
  const timeoutMs = Math.min(
    MAX_TIMEOUT_MS,
    Math.max(MIN_TIMEOUT_MS, options.timeoutMs ?? configuredTimeoutMs()),
  );
  const limit = Math.min(10, Math.max(3, options.limit ?? 6));
  const language = options.language ?? "en";

  // Prioritize healthy instances
  const healthy = instances.filter(isInstanceHealthy);
  const unhealthy = instances.filter((i) => !isInstanceHealthy(i));
  const ordered = [...healthy, ...unhealthy];

  const runBatches = async (attemptTimeoutMs: number) => {
    for (let i = 0; i < ordered.length; i += BATCH_SIZE) {
      const batch = ordered.slice(i, i + BATCH_SIZE);
      const { winner } = await runParallelBatch({
        instances: batch,
        query,
        language,
        limit,
        timeoutMs: attemptTimeoutMs,
      });
      if (winner?.results?.length) {
        return winner.results;
      }
    }
    return [];
  };

  const firstPass = await runBatches(timeoutMs);
  if (firstPass.length > 0) {
    return firstPass;
  }

  // Retry once with a longer timeout before giving up.
  const retryTimeoutMs = Math.max(timeoutMs, RETRY_TIMEOUT_MS);
  const retryPass = await runBatches(retryTimeoutMs);
  if (retryPass.length > 0) {
    return retryPass;
  }

  console.warn(`[searxng] all ${ordered.length} instances failed for "${query.slice(0, 80)}"`);
  return [];
}
