import { isModelAllowedInTier, modelSupportsCapability, type CatalogModelEntry, type ModelCapability } from "@/lib/model-selection";
import type { SpendingTier } from "@/types";

export type ModelAnchorSource = "auto" | "manual" | "openrouter_auto";

export type StableModelAnchor = {
  modelId: string;
  source: ModelAnchorSource;
  routeKey: string;
  reason: string;
  requiredCapabilities: ModelCapability[];
  spendingTier: SpendingTier;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  metadataUpdatedAt?: number;
};

export type ModelAnchorResolution = {
  anchor: StableModelAnchor;
  reuseModelId?: string;
  reuseReason?: string;
  fallbackReason?: string;
  mismatchReasons: string[];
  staleMetadataPenalty: number;
  whyThisModel: string;
};

const DEFAULT_ANCHOR_TTL_MS = 30 * 60 * 1000;
const DEFAULT_METADATA_STALE_DAYS = 45;

function modelMetadataTimestamp(model?: CatalogModelEntry) {
  if (!model) return undefined;
  if (typeof model.createdAt === "number" && Number.isFinite(model.createdAt)) return model.createdAt;
  if (model.releaseDate) {
    const parsed = Date.parse(model.releaseDate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function staleMetadataPenalty(model: CatalogModelEntry | undefined, now: number, staleAfterDays: number) {
  const timestamp = modelMetadataTimestamp(model);
  if (!timestamp) return 0;
  const ageDays = Math.max(0, (now - timestamp) / (24 * 60 * 60 * 1000));
  if (ageDays <= staleAfterDays) return 0;
  return Math.min(0.35, ((ageDays - staleAfterDays) / staleAfterDays) * 0.18);
}

export function buildStableModelAnchorRouteKey(params: {
  mode: string;
  spendingTier: SpendingTier;
  requiredCapabilities: ModelCapability[];
  needsSearch?: boolean;
  needsRag?: boolean;
}) {
  return [
    params.mode,
    params.spendingTier,
    params.needsSearch ? "search" : "no-search",
    params.needsRag ? "rag" : "no-rag",
    [...params.requiredCapabilities].sort().join("+") || "text",
  ].join(":");
}

function anchorSource(routerMode: string): ModelAnchorSource {
  if (routerMode === "manual") return "manual";
  if (routerMode === "openrouter_auto") return "openrouter_auto";
  return "auto";
}

export function resolveStableModelAnchor(params: {
  existingAnchor?: StableModelAnchor;
  selectedModelId: string;
  routerMode: string;
  manualModel?: string;
  mode: string;
  spendingTier: SpendingTier;
  requiredCapabilities?: ModelCapability[];
  needsSearch?: boolean;
  needsRag?: boolean;
  catalog?: CatalogModelEntry[];
  routeReason: string;
  now?: number;
  ttlMs?: number;
  metadataStaleAfterDays?: number;
}): ModelAnchorResolution {
  const now = params.now ?? Date.now();
  const requiredCapabilities = params.requiredCapabilities ?? [];
  const route = buildStableModelAnchorRouteKey({
    mode: params.mode,
    spendingTier: params.spendingTier,
    requiredCapabilities,
    needsSearch: params.needsSearch,
    needsRag: params.needsRag,
  });
  const catalog = params.catalog ?? [];
  const selectedMeta = catalog.find((model) => model.modelId === params.selectedModelId);
  const mismatchReasons: string[] = [];
  const stalePenalty = staleMetadataPenalty(
    selectedMeta,
    now,
    params.metadataStaleAfterDays ?? DEFAULT_METADATA_STALE_DAYS,
  );

  let reuseModelId: string | undefined;
  let reuseReason: string | undefined;
  let fallbackReason: string | undefined;

  const existing = params.existingAnchor;
  if (params.routerMode === "manual") {
    if (existing?.modelId && existing.modelId !== params.manualModel) {
      fallbackReason = "manual override replaced previous model anchor";
    }
  } else if (existing?.modelId) {
    const anchoredMeta = catalog.find((model) => model.modelId === existing.modelId);
    if (existing.expiresAt <= now) {
      mismatchReasons.push("anchor expired");
    }
    if (existing.routeKey !== route) {
      mismatchReasons.push("route requirements changed");
    }
    if (anchoredMeta && !isModelAllowedInTier(anchoredMeta, params.spendingTier)) {
      mismatchReasons.push(`anchor violates ${params.spendingTier} tier`);
    }
    for (const capability of requiredCapabilities) {
      if (anchoredMeta && !modelSupportsCapability(anchoredMeta, capability)) {
        mismatchReasons.push(`anchor missing ${capability}`);
      }
    }
    if (catalog.length > 0 && !anchoredMeta) {
      mismatchReasons.push("anchor missing from catalog");
    }

    if (mismatchReasons.length === 0) {
      reuseModelId = existing.modelId;
      reuseReason = "stable conversation model anchor reused";
    } else {
      fallbackReason = `model anchor fallback: ${mismatchReasons.join(", ")}`;
    }
  }

  const effectiveModelId = reuseModelId ?? params.selectedModelId;
  const effectiveMeta = catalog.find((model) => model.modelId === effectiveModelId);
  const anchor: StableModelAnchor = {
    modelId: effectiveModelId,
    source: anchorSource(params.routerMode),
    routeKey: route,
    reason: reuseReason ?? params.routeReason,
    requiredCapabilities,
    spendingTier: params.spendingTier,
    createdAt: existing?.modelId === effectiveModelId ? existing.createdAt : now,
    updatedAt: now,
    expiresAt: now + (params.ttlMs ?? DEFAULT_ANCHOR_TTL_MS),
    metadataUpdatedAt: modelMetadataTimestamp(effectiveMeta),
  };

  const whyParts = [
    reuseReason ?? params.routeReason,
    requiredCapabilities.length > 0 ? `required ${requiredCapabilities.join(", ")}` : "text chat capable route",
    params.needsSearch ? "search-aware route data" : undefined,
    stalePenalty > 0 ? `stale metadata penalty ${stalePenalty.toFixed(2)}` : undefined,
    fallbackReason,
  ].filter((part): part is string => Boolean(part));

  return {
    anchor,
    reuseModelId,
    reuseReason,
    fallbackReason,
    mismatchReasons,
    staleMetadataPenalty: stalePenalty,
    whyThisModel: whyParts.join("; "),
  };
}
