export type SearxngResult = {
  url: string;
  title: string;
  content?: string;
  engine?: string;
};

const SEARXNG_INSTANCES = [
  "https://searx.be",
  "https://search.bus-hit.me",
  "https://searxng.world",
  "https://paulgo.io",
  "https://searx.tiekoetter.com",
];

export async function searxngSearch(query: string): Promise<SearxngResult[]> {
  for (const instance of SEARXNG_INSTANCES) {
    try {
      const response = await fetch(
        `${instance}/search?q=${encodeURIComponent(query)}&format=json&language=en`,
        {
          signal: AbortSignal.timeout(3000),
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
        .slice(0, 6);
      if (results.length > 0) {
        return results;
      }
    } catch {
      // Try the next public instance.
    }
  }

  return [];
}
