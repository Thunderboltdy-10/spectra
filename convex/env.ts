const openRouterKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
const hasOpenRouterKey = openRouterKey.length > 0;

const warnedScopes = new Set<string>();

if (!hasOpenRouterKey) {
  console.warn("[env] OPENROUTER_API_KEY missing at startup; some features will run in degraded mode.");
}

export function getOpenRouterApiKey() {
  return hasOpenRouterKey ? openRouterKey : null;
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
