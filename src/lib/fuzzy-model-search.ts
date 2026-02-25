export function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .replace(/[-_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ALIASES: Record<string, string[]> = {
  openai: ["gpt", "o3", "o4", "dall-e", "chatgpt"],
  google: ["gemini", "gemma", "palm", "bard"],
  anthropic: ["claude", "sonnet", "opus", "haiku"],
  meta: ["llama", "codellama"],
  deepseek: ["deepseek", "r1"],
  perplexity: ["sonar", "pplx"],
  mistral: ["mistral", "mixtral"],
};

function extractVersionTokens(value: string) {
  return Array.from(value.toLowerCase().matchAll(/\b\d+(?:\.\d+)+\b/g)).map((match) => match[0]);
}

export function fuzzyScore(
  query: string,
  model: { name: string; modelId: string; provider: string; description?: string },
): number {
  const nq = normalizeQuery(query);
  if (!nq) return 0;

  const target = normalizeQuery(
    `${model.name} ${model.modelId} ${model.provider} ${model.description ?? ""}`,
  );

  const tokens = nq.split(" ").filter(Boolean);
  const queryVersions = extractVersionTokens(query);
  const targetVersions = extractVersionTokens(target);
  let matched = 0;
  for (const token of tokens) {
    if (target.includes(token)) matched += 1;
  }

  if (queryVersions.length > 0) {
    let versionHits = 0;
    for (const version of queryVersions) {
      const matchedVersion = targetVersions.some((candidate) =>
        candidate === version ||
        candidate.startsWith(`${version}.`) ||
        version.startsWith(`${candidate}.`),
      );
      if (matchedVersion) versionHits += 1;
    }
    if (versionHits === 0) return 0;
    matched += versionHits * 1.8;
  }

  for (const [provider, aliases] of Object.entries(ALIASES)) {
    if (aliases.some((alias) => nq.includes(alias)) && target.includes(provider)) {
      matched += 0.5;
    }
  }

  return matched / Math.max(tokens.length + queryVersions.length, 1);
}
