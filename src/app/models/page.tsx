"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Check,
  Filter,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rightPanelSurfaceClassName } from "@/components/ui/right-panel-surface";
import { useSidebar } from "@/context/sidebar-context";
import { fuzzyScore } from "@/lib/fuzzy-model-search";
import { MODEL_COST_BLOCK_LIST } from "@/lib/model-config";

type SpendingTier = "normal" | "expensive_blocked" | "cheap_only" | "free_only";
type SortMode = "recommended" | "popular" | "context";

type CapabilityScores = {
  reasoning: number;
  creative: number;
  code: number;
  vision: number;
  speed: number;
};

type CatalogModel = {
  _id: string;
  modelId: string;
  name: string;
  provider: string;
  description: string;
  contextLength?: number;
  inputCostPerM?: number;
  outputCostPerM?: number;
  tags: string[];
  isFree?: boolean;
  isFeatured?: boolean;
  featuredOrder?: number;
  capabilities?: CapabilityScores;
  releaseDate?: string;
  knowledgeCutoff?: string;
  openRouterRank?: number;
};

type LiveModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  contextLength?: number;
  pricing: {
    prompt?: number;
    completion?: number;
  };
  tags: string[];
};

type MostUsedModel = CatalogModel & {
  usageCount: number;
};

type ExplorerModel = CatalogModel & {
  usageCount: number;
};

type ProviderStat = {
  name: string;
  count: number;
  usageScore: number;
};

type LeaderboardEntry = {
  modelId: string;
  provider: string;
  name: string;
  totalTokens: number;
  usageCount: number;
};

function sanitizeName(value: string) {
  return value
    .replace(/:free$/i, "")
    .replace(/[\s(_-]*\bfree\b[\s)_-]*/gi, " ")
    .replace(/\s*&\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeProviderName(provider: string) {
  const clean = provider.trim();
  if (!clean) return "Unknown";
  const normalized = clean.toLowerCase();
  if (normalized.includes("openai")) return "OpenAI";
  if (normalized.includes("google") || normalized.includes("gemini")) return "Google";
  if (normalized.includes("anthropic")) return "Anthropic";
  if (normalized.includes("meta")) return "Meta";
  if (normalized.includes("mistral")) return "Mistral";
  if (normalized.includes("deepseek")) return "DeepSeek";
  if (normalized.includes("perplexity")) return "Perplexity";
  if (normalized.includes("x-ai") || normalized.includes("xai")) return "xAI";
  if (normalized.includes("cohere")) return "Cohere";
  if (normalized.includes("moonshot")) return "Moonshot";
  if (normalized.includes("qwen")) return "Qwen";
  if (normalized.includes("openrouter")) return "OpenRouter";
  return clean
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatContext(value?: number) {
  if (!value || value <= 0) return "Unknown";
  return Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

function isBudgetSafe(model: ExplorerModel) {
  if (model.isFree) return true;
  if (model.modelId.includes(":free")) return true;
  const inCost = typeof model.inputCostPerM === "number" ? model.inputCostPerM : undefined;
  const outCost = typeof model.outputCostPerM === "number" ? model.outputCostPerM : undefined;
  return (inCost ?? 0) === 0 && (outCost ?? 0) === 0;
}

function isCheapModel(model: ExplorerModel) {
  if (isBudgetSafe(model)) return true;
  const inCost = typeof model.inputCostPerM === "number" ? model.inputCostPerM : Number.POSITIVE_INFINITY;
  return inCost <= 3;
}

function blockedByTier(model: ExplorerModel, tier: SpendingTier) {
  if (tier === "normal") return false;
  if (tier === "expensive_blocked") {
    return MODEL_COST_BLOCK_LIST.has(model.modelId) || model.modelId === "openrouter/auto";
  }
  if (tier === "cheap_only") {
    return !isCheapModel(model) || model.modelId === "openrouter/auto";
  }
  return !isBudgetSafe(model) || model.modelId === "openrouter/auto";
}

function blockedReason(model: ExplorerModel, tier: SpendingTier) {
  if (!blockedByTier(model, tier)) return null;
  if (tier === "expensive_blocked") return "Temporarily blocked by current usage guardrails";
  if (tier === "cheap_only") return "Limited to low-cost models until guardrails relax";
  return "Only guardrail-safe models are available right now";
}

function computeCapabilities(model: Pick<ExplorerModel, "capabilities" | "tags" | "modelId">): CapabilityScores {
  if (model.capabilities) return model.capabilities;

  const source = `${model.modelId} ${(model.tags ?? []).join(" ")}`.toLowerCase();
  return {
    reasoning: /reason|o3|o4|r1|sonnet|pro/.test(source) ? 8 : 5,
    creative: /claude|gpt|gemini/.test(source) ? 7 : 5,
    code: /code|coder|codestral|deepseek/.test(source) ? 8 : 5,
    vision: /vision|image|multimodal/.test(source) ? 7 : 0,
    speed: /flash|mini|lite|haiku/.test(source) ? 9 : 5,
  };
}

function capabilityLabels(model: ExplorerModel) {
  const caps = computeCapabilities(model);
  const labels: string[] = [];
  if (caps.reasoning >= 7) labels.push("Reasoning");
  if (caps.code >= 7) labels.push("Code");
  if (caps.vision >= 5) labels.push("Vision");
  if (caps.speed >= 8) labels.push("Fast");
  if (caps.creative >= 7) labels.push("Creative");
  return labels.slice(0, 3);
}

function scoreModel(model: ExplorerModel, tier: SpendingTier) {
  const caps = computeCapabilities(model);
  let score = 0;

  score += model.isFeatured ? 35 : 0;
  score += Math.min(22, model.usageCount * 2);
  score += caps.reasoning * 1.5;
  score += caps.code * 1.1;
  score += caps.speed * 0.7;
  score += caps.vision * 0.5;

  if (model.contextLength) {
    if (model.contextLength >= 200_000) score += 10;
    else if (model.contextLength >= 64_000) score += 6;
    else if (model.contextLength >= 16_000) score += 2;
  }

  if (isBudgetSafe(model)) score += 8;
  if (blockedByTier(model, tier)) score -= 80;

  return score;
}

function ModelCard({
  model,
  tier,
  onTry,
}: {
  model: ExplorerModel;
  tier: SpendingTier;
  onTry: (modelId: string) => void;
}) {
  const restricted = blockedByTier(model, tier);
  const restrictionReason = blockedReason(model, tier);

  return (
    <article
      className={`relative rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 ${
        restricted
          ? "border-dashed opacity-60 grayscale saturate-0"
          : "transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]"
      }`}
    >
      {restricted ? (
        <span className="absolute right-3 top-3 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
          Unavailable
        </span>
      ) : null}
      <div className="mb-3 flex items-start gap-2.5">
        <ProviderLogo provider={model.provider} modelId={model.modelId} size={22} className="h-11 w-11 shrink-0 min-w-[24px]" />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-[var(--text-primary)]">{sanitizeName(model.name || model.modelId)}</p>
          <p className="truncate text-xs text-[var(--text-secondary)]">{model.provider}</p>
        </div>
      </div>

      <p className="line-clamp-3 min-h-[54px] text-xs leading-relaxed text-[var(--text-secondary)]">
        {model.description || "No description available."}
      </p>

      <div className="mt-3 flex flex-wrap gap-1">
        {capabilityLabels(model).map((label) => (
          <span
            key={`${model.modelId}-${label}`}
            className="inline-flex items-center rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]"
          >
            {label}
          </span>
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)]">
        <p className="uppercase tracking-wide">Context window</p>
        <p className="mt-0.5 text-[var(--text-primary)]">{formatContext(model.contextLength)}</p>
      </div>

      {model.usageCount > 0 && (
        <p className="mt-2 text-[11px] text-[var(--text-secondary)]">Used {model.usageCount}x in your school</p>
      )}

      {restrictionReason ? (
        <p className="mt-2 text-[11px] text-[var(--warning)]">{restrictionReason}</p>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="truncate text-[10px] text-[var(--text-secondary)]" title={sanitizeName(model.modelId)}>{sanitizeName(model.modelId)}</span>
        <Button size="sm" disabled={restricted} onClick={() => onTry(model.modelId)}>
          Use Model
        </Button>
      </div>
    </article>
  );
}

export default function ModelsPage() {
  const router = useRouter();
  const { userSpending } = useSidebar();
  const [catalogModels, setCatalogModels] = useState<CatalogModel[]>([]);
  const [featuredModels, setFeaturedModels] = useState<CatalogModel[]>([]);
  const [mostUsed, setMostUsed] = useState<MostUsedModel[]>([]);
  const [liveModels, setLiveModels] = useState<LiveModel[]>([]);
  const [loading, setLoading] = useState(true);

  const tier: SpendingTier = userSpending?.tier ?? "normal";
  const [providerSearch, setProviderSearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("recommended");
  const [showRestricted, setShowRestricted] = useState(false);
  const [visibleCount, setVisibleCount] = useState(18);
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const autoLoadSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [catalogRes, bootstrapRes, liveRes] = await Promise.all([
          fetch("/api/models"),
          fetch("/api/bootstrap"),
          fetch("/api/models/live"),
        ]);

        if (!catalogRes.ok) throw new Error(await catalogRes.text());

        const catalogPayload = (await catalogRes.json()) as {
          models: CatalogModel[];
          featured?: CatalogModel[];
          mostUsed?: MostUsedModel[];
        };

        setCatalogModels(catalogPayload.models ?? []);
        setFeaturedModels(catalogPayload.featured ?? []);
        setMostUsed(catalogPayload.mostUsed ?? []);

        if (bootstrapRes.ok) {
          await bootstrapRes.json();
        }

        if (liveRes.ok) {
          const livePayload = (await liveRes.json()) as { models: LiveModel[] };
          setLiveModels(livePayload.models ?? []);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load models");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    setLeaderboardLoading(true);
    void (async () => {
      try {
        const response = await fetch("/api/analytics/model-leaderboard");
        if (!response.ok) throw new Error(await response.text());
        const payload = (await response.json()) as { models: LeaderboardEntry[] };
        setLeaderboardEntries(payload.models ?? []);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load leaderboard");
      } finally {
        setLeaderboardLoading(false);
      }
    })();
  }, []);

  const models = useMemo(() => {
    const usageMap = new Map(mostUsed.map((model) => [model.modelId, model.usageCount]));
    const liveRankMap = new Map(liveModels.map((model, index) => [model.id, index]));
    const merged = new Map<string, ExplorerModel>();

    for (const model of catalogModels) {
      merged.set(model.modelId, {
        ...model,
        name: sanitizeName(model.name || model.modelId),
        provider: normalizeProviderName(model.provider),
        usageCount: usageMap.get(model.modelId) ?? 0,
        openRouterRank: model.openRouterRank ?? liveRankMap.get(model.modelId),
      });
    }

    for (const live of liveModels) {
      const existing = merged.get(live.id);
      merged.set(live.id, {
        _id: existing?._id ?? live.id,
        modelId: live.id,
        name: sanitizeName(existing?.name || live.name || live.id),
        provider: normalizeProviderName(existing?.provider || live.provider || "Unknown"),
        description: existing?.description || live.description || "",
        contextLength: existing?.contextLength ?? live.contextLength,
        inputCostPerM: existing?.inputCostPerM ?? live.pricing.prompt,
        outputCostPerM: existing?.outputCostPerM ?? live.pricing.completion,
        tags: Array.from(new Set([...(existing?.tags ?? []), ...(live.tags ?? [])])),
        isFree:
          existing?.isFree ??
          (live.id.includes(":free") || (live.pricing.prompt === 0 && live.pricing.completion === 0)),
        isFeatured: existing?.isFeatured,
        featuredOrder: existing?.featuredOrder,
        capabilities: existing?.capabilities,
        usageCount: usageMap.get(live.id) ?? existing?.usageCount ?? 0,
        openRouterRank: existing?.openRouterRank ?? liveRankMap.get(live.id),
      });
    }

    return [...merged.values()]
      .filter((model) => !/whisper|tts|speech|transcribe/i.test(model.modelId));
  }, [catalogModels, liveModels, mostUsed]);

  const providerStats = useMemo(() => {
    const aggregate = new Map<string, ProviderStat>();
    for (const model of models) {
      const providerName = model.provider?.trim() || "Unknown";
      const current = aggregate.get(providerName) ?? { name: providerName, count: 0, usageScore: 0 };
      current.count += 1;
      current.usageScore += Math.max(1, model.usageCount) + (model.isFeatured ? 4 : 0);
      aggregate.set(providerName, current);
    }

    return [...aggregate.values()].sort((a, b) => b.usageScore - a.usageScore || a.name.localeCompare(b.name));
  }, [models]);

  const visibleProviders = useMemo(() => {
    const needle = providerSearch.trim().toLowerCase();
    if (!needle) return providerStats;
    return providerStats.filter((provider) => {
      if (provider.name.toLowerCase().includes(needle)) return true;
      return models.some((model) =>
        model.provider === provider.name &&
        fuzzyScore(needle, model) > 0.24,
      );
    });
  }, [models, providerSearch, providerStats]);

  const featured = useMemo(() => {
    const source = featuredModels.length > 0 ? featuredModels : models.filter((model) => model.isFeatured);
    return [...source]
      .map((model) => models.find((item) => item.modelId === model.modelId) ?? ({ ...model, usageCount: 0 } as ExplorerModel))
      .sort((a, b) => (a.featuredOrder ?? 999) - (b.featuredOrder ?? 999));
  }, [featuredModels, models]);

  const filteredModels = useMemo(() => {
    const selected = new Set(selectedProviders);
    const cleanModelSearch = modelSearch.trim().toLowerCase();

    let rows = models.filter((model) => {
      if (selected.size > 0 && !selected.has(model.provider)) {
        return false;
      }
      if (!cleanModelSearch) return true;
      const localScore = fuzzyScore(cleanModelSearch, model);
      const haystack = `${model.name} ${model.modelId} ${model.provider} ${(model.tags ?? []).join(" ")}`.toLowerCase();
      // Direct substring match
      if (haystack.includes(cleanModelSearch)) return true;
      // Fuzzy match
      if (localScore > 0.25) return true;
      // Version-aware matching: "4.1" matches "gpt-4.1", "4o" matches "gpt-4o", "sonnet 4.5" matches "claude-sonnet-4.5"
      const versionPattern = cleanModelSearch.replace(/\./g, "\\.").replace(/\s+/g, ".*");
      try {
        if (new RegExp(versionPattern, "i").test(haystack)) return true;
      } catch { /* ignore invalid regex */ }
      return false;
    });

    rows = rows.sort((a, b) => {
      // Always push openrouter/auto models to the bottom regardless of sort mode
      const aIsAuto = a.modelId.includes("openrouter/auto");
      const bIsAuto = b.modelId.includes("openrouter/auto");
      if (aIsAuto !== bIsAuto) return aIsAuto ? 1 : -1;

      if (sortMode === "context") return (b.contextLength ?? 0) - (a.contextLength ?? 0);
      if (sortMode === "popular") {
        const aRank = typeof a.openRouterRank === "number" ? a.openRouterRank : Number.MAX_SAFE_INTEGER;
        const bRank = typeof b.openRouterRank === "number" ? b.openRouterRank : Number.MAX_SAFE_INTEGER;
        if (aRank !== bRank) return aRank - bRank;
        return b.usageCount - a.usageCount;
      }
      return scoreModel(b, tier) - scoreModel(a, tier);
    });

    return rows;
  }, [modelSearch, models, selectedProviders, sortMode, tier]);

  const [availableModels, restrictedModels] = useMemo(() => {
    const available: ExplorerModel[] = [];
    const restricted: ExplorerModel[] = [];
    for (const model of filteredModels) {
      if (blockedByTier(model, tier)) {
        restricted.push(model);
      } else {
        available.push(model);
      }
    }
    return [available, restricted];
  }, [filteredModels, tier]);

  useEffect(() => {
    setVisibleCount(18);
  }, [modelSearch, selectedProviders, sortMode, tier]);

  useEffect(() => {
    const sentinel = autoLoadSentinelRef.current;
    if (!sentinel) return;
    if (visibleCount >= availableModels.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting) return;
        setVisibleCount((prev) => Math.min(prev + 18, availableModels.length));
      },
      { rootMargin: "240px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [availableModels.length, visibleCount]);

  function tryModel(modelId: string) {
    router.push(`/?model=${encodeURIComponent(modelId)}`);
  }

  function toggleProvider(name: string) {
    setSelectedProviders((prev) => {
      if (prev.includes(name)) {
        return prev.filter((item) => item !== name);
      }
      return [...prev, name];
    });
  }

  function clearProviderFilters() {
    setSelectedProviders([]);
  }

  const sortLabel =
    sortMode === "recommended"
      ? "Recommended"
      : sortMode === "popular"
        ? "Popular"
        : "Largest context";

  if (loading) {
    return (
      <AppShell>
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 9 }).map((_, index) => (
            <div key={index} className="h-56 animate-pulse rounded-xl bg-[var(--bg-secondary)]" />
          ))}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell fullBleed contentClassName="2xl:px-14">
      <section data-tour="models-header">
        <div className="mb-4">
          <h1 className="font-display text-3xl">Model Atlas</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
            Compare providers, keep model discovery fast, and switch to chat with one click.
          </p>
        </div>

        <div className="grid gap-2 lg:grid-cols-[1fr_1fr_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-secondary)]" />
            <Input
              value={modelSearch}
              onChange={(event) => setModelSearch(event.target.value)}
              placeholder="Search models"
              className="h-10 w-full pl-10 text-sm focus-visible:border-[var(--border-default)] focus-visible:ring-0"
              data-tour="models-search-models"
            />
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-secondary)]" />
            <Input
              value={providerSearch}
              onChange={(event) => setProviderSearch(event.target.value)}
              placeholder="Search providers"
              className="h-10 w-full pl-10 text-sm focus-visible:border-[var(--border-default)] focus-visible:ring-0"
            />
          </div>

          <div className="relative">
            <button
              type="button"
              className="inline-flex h-10 w-full items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
            >
              <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                <Filter className="h-3.5 w-3.5" />
                Sort by
              </span>
              <span>{sortLabel}</span>
            </button>
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              aria-label="Sort models"
              className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
            >
              <option value="recommended">Recommended</option>
              <option value="popular">Popular</option>
              <option value="context">Largest context</option>
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {selectedProviders.length > 0 ? (
            <button
              type="button"
              onClick={clearProviderFilters}
              className="inline-flex items-center gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
            >
              Clear providers
            </button>
          ) : null}
        </div>
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          {featured.length > 0 ? (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">Featured Models</h2>
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {featured.slice(0, 6).map((model) => (
                  <ModelCard key={`featured-${model.modelId}`} model={model} tier={tier} onTry={tryModel} />
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <div className="mb-3 flex items-end justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Available now</h2>
                <p className="text-xs text-[var(--text-secondary)]">Provider-filtered models you can use immediately.</p>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">{availableModels.length} models</p>
            </div>

            {availableModels.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 text-center text-sm text-[var(--text-secondary)]">
                No models match your current filters.
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {availableModels.slice(0, visibleCount).map((model) => (
                    <ModelCard key={`available-${model.modelId}`} model={model} tier={tier} onTry={tryModel} />
                  ))}
                </div>
                {visibleCount < availableModels.length ? <div ref={autoLoadSentinelRef} className="h-10" aria-hidden /> : null}
              </>
            )}

            {restrictedModels.length > 0 ? (
              <div className="mt-6">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-[var(--text-primary)]">Temporarily restricted</h3>
                    <p className="text-xs text-[var(--text-secondary)]">Unavailable under current guardrails.</p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowRestricted((prev) => !prev)}>
                    {showRestricted ? "Hide restricted" : `Show restricted (${restrictedModels.length})`}
                  </Button>
                </div>
                {showRestricted ? (
                  <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                    {restrictedModels.map((model) => (
                      <ModelCard key={`restricted-${model.modelId}`} model={model} tier={tier} onTry={tryModel} />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Selection tip</h3>
                <p className="text-xs text-[var(--text-secondary)]">
                  Start with a focused provider filter, then compare 2-3 models on your exact coursework prompt.
                </p>
              </div>
              <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => router.push("/chat")}>
                Open Chat
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </section>
        </div>

        <aside
          data-tour="models-provider-panel"
          className={`${rightPanelSurfaceClassName("rounded-2xl p-4")} xl:sticky xl:top-6 xl:max-h-[84vh] xl:overflow-y-auto`}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Provider Filters</h2>
            <p className="text-xs text-[var(--text-secondary)]">{visibleProviders.length} providers</p>
          </div>

          <div className="max-h-[44vh] space-y-2 overflow-y-auto pr-1">
            {visibleProviders.map((provider) => {
              const selected = selectedProviders.includes(provider.name);
              return (
                <button
                  key={provider.name}
                  type="button"
                  onClick={() => {
                    toggleProvider(provider.name);
                  }}
                  className={`flex min-h-[44px] w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
                    selected
                      ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,var(--bg-primary))]"
                      : "border-[var(--border-default)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <ProviderLogo provider={provider.name} size={22} className="h-10 w-10 shrink-0 min-w-[24px]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-[var(--text-primary)]">{provider.name}</p>
                    <p className="text-[10px] text-[var(--text-secondary)]">{provider.count} models</p>
                  </div>
                  <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] ${selected ? "border-[var(--accent-cyan)] text-[var(--accent-cyan)]" : "border-[var(--border-default)] text-[var(--text-secondary)]"}`}>
                    {selected ? <Check className="h-3 w-3" /> : null}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 border-t border-[var(--border-default)] pt-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Live Leaderboard</h3>
              <span className="text-[10px] text-[var(--text-secondary)]">Top 20</span>
            </div>
            <div className="max-h-[30vh] space-y-2 overflow-y-auto pr-1">
              {leaderboardLoading ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="h-14 animate-pulse rounded-xl bg-[var(--bg-secondary)]" />
                ))
              ) : leaderboardEntries.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[var(--border-default)] p-4 text-center text-xs text-[var(--text-secondary)]">
                  No model usage yet.
                </p>
              ) : (
                leaderboardEntries.slice(0, 20).map((entry, index) => (
                  <div key={entry.modelId} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[11px] font-semibold text-[var(--text-secondary)]">
                      {index + 1}
                    </span>
                    <ProviderLogo provider={entry.provider} modelId={entry.modelId} size={14} className="h-7 w-7 shrink-0 min-w-[24px]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-[var(--text-primary)]">{sanitizeName(entry.name)}</p>
                      <p className="text-[10px] text-[var(--text-secondary)]">
                        {formatTokens(entry.totalTokens)} tokens · {entry.usageCount} uses
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
