import { convexQuery } from "@/lib/convex-server";
import { getRouterFallbacks, resolveModelForRole } from "@/lib/model-config";
import { getLiveCatalogSnapshot } from "@/lib/openrouter-catalog-cache";
import type { CatalogModelEntry } from "@/lib/model-selection";
import type { ModelRole } from "@/lib/model-roles";

function toCatalog(entries: Array<Record<string, unknown>>): CatalogModelEntry[] {
  return entries as unknown as CatalogModelEntry[];
}

export async function resolveRoleModelBundle(params: {
  actorClerkId: string;
  role: ModelRole;
  fallbackModel: string;
  maxFallbacks?: number;
}) {
  const dbCatalogUnknown = await convexQuery("models:listModels", {
    actorClerkId: params.actorClerkId,
  }).catch(() => [] as unknown[]);
  const dbCatalogRaw = Array.isArray(dbCatalogUnknown)
    ? dbCatalogUnknown as Array<Record<string, unknown>>
    : [];

  const liveCatalog = await getLiveCatalogSnapshot({
    fallbackCatalog: toCatalog(dbCatalogRaw),
  });
  const catalog = liveCatalog.models.length > 0 ? liveCatalog.models : toCatalog(dbCatalogRaw);

  const model = catalog.length > 0 ? resolveModelForRole(params.role, catalog) : params.fallbackModel;
  const fallbackLookup = getRouterFallbacks(catalog);
  const fallbackModels = (fallbackLookup[model] ?? [params.fallbackModel])
    .filter((candidate) => candidate && candidate !== model)
    .slice(0, Math.max(1, params.maxFallbacks ?? 3));

  return {
    model,
    fallbackModels,
    catalog,
    source: liveCatalog.source,
  };
}
