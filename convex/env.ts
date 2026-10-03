const openRouterKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
const artificialAnalysisKey = (process.env.ARTIFICIAL_ANALYSIS_API_KEY ?? "").trim();
const hasOpenRouterKey = openRouterKey.length > 0;

const warnedScopes = new Set<string>();

if (!hasOpenRouterKey) {
  console.warn("[env] OPENROUTER_API_KEY missing at startup; some features will run in degraded mode.");
}

export function getOpenRouterApiKey() {
  return hasOpenRouterKey ? openRouterKey : null;
}

/**
 * The embedding model shared by memory and the semantic index. It is read per call, never at load,
 * so a deployment can change it without a code change. `null` disables vectors: retrieval keeps
 * serving full-text results and says so.
 */
export function getEmbeddingModelSetting(): { model: string; provider: string | null } | null {
  const model = (process.env.SPECTRA_EMBEDDING_MODEL ?? "").trim();
  const provider = (process.env.SPECTRA_EMBEDDING_PROVIDER ?? "").trim();
  return model ? { model, provider: provider || null } : null;
}

export function getArtificialAnalysisApiKey() {
  return artificialAnalysisKey.length > 0 ? artificialAnalysisKey : null;
}

export function isOpenRouterConfigured() {
  return hasOpenRouterKey;
}

export function warnOpenRouterMissing(scope: string) {
  if (hasOpenRouterKey) return;
  const cleanScope = scope.trim() || "unknown_scope";
  if (warnedScopes.has(cleanScope)) return;
  warnedScopes.add(cleanScope);
  console.warn(`[env] OPENROUTER_API_KEY missing; ${cleanScope} will run in degraded mode.`);
}

export function getOpenRouterAdminWarnings() {
  if (hasOpenRouterKey) return [];
  return [
    "OPENROUTER_API_KEY is missing.",
    "Model catalog sync is paused and continues serving cached catalog data.",
    "File ingestion for text documents is queued and retried automatically.",
  ];
}
