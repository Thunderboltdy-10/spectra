"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Brain,
  Code2,
  Eye,
  PenLine,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Timer,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { ProviderLogo } from "@/components/provider-logo";
import { ModelLeaderboardDrawer } from "@/components/chat/model-leaderboard-drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fuzzyScore } from "@/lib/fuzzy-model-search";

const TASK_CHIPS = [
  { label: "Physics", query: "physics equations derivation problem solving" },
  { label: "Essay", query: "essay writing thesis argument revision" },
  { label: "Coding", query: "coding debugging algorithm implementation" },
  { label: "Vision", query: "image diagram OCR visual analysis" },
  { label: "Fast & Cheap", query: "fast cheap free low latency" },
  { label: "Research", query: "research synthesis evidence citation" },
];

type SpendingTier = "normal" | "cheap_only" | "free_only";
type CapabilityFilter = "all" | "reasoning" | "code" | "vision" | "speed" | "creative";
type PriceFilter = "all" | "free" | "cheap" | "premium" | "unknown";
type SortMode = "recommended" | "context" | "input_price" | "popular";

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
  curatedNotes?: string;
  benchmarkMMLU?: number;
  benchmarkHumanEval?: number;
  arenaElo?: number;
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

function sanitizeName(value: string) {
  return value
    .replace(/:free$/i, "")
    .replace(/[\s(_-]*\bfree\b[\s)_-]*/gi, " ")
    .replace(/\s*&\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatContext(value?: number) {
  if (!value || value <= 0) return "—";
  return Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

function formatCost(value: number | undefined, isFree?: boolean) {
  if (isFree) return "—";
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value <= 0) return "—";
  if (value < 0.01) return `$${value.toFixed(4)}/M`;
  return `$${value.toFixed(2)}/M`;
}

function primaryCost(model: ExplorerModel) {
  if (typeof model.inputCostPerM === "number" && Number.isFinite(model.inputCostPerM)) {
    return model.inputCostPerM;
  }
  if (typeof model.outputCostPerM === "number" && Number.isFinite(model.outputCostPerM)) {
    return model.outputCostPerM;
  }
  return undefined;
}

function isIncludedModel(model: ExplorerModel) {
  const inCost = primaryCost(model);
  return Boolean(model.isFree || model.modelId.includes(":free") || (typeof inCost === "number" && inCost <= 0));
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

function hasCapability(model: ExplorerModel, capability: CapabilityFilter) {
  if (capability === "all") return true;
  const caps = computeCapabilities(model);
  if (capability === "vision") return caps.vision >= 5;
  if (capability === "speed") return caps.speed >= 8;
  if (capability === "reasoning") return caps.reasoning >= 7;
  if (capability === "code") return caps.code >= 7;
  return caps.creative >= 7;
}

function matchesPrice(model: ExplorerModel, price: PriceFilter) {
  if (price === "all") return true;
  const cost = primaryCost(model);
  if (price === "free") return isIncludedModel(model);
  if (price === "unknown") return typeof cost !== "number";
  if (typeof cost !== "number") return false;
  if (price === "cheap") return cost <= 3;
  return cost > 3;
}

function blockedByTier(model: ExplorerModel, tier: SpendingTier) {
  if (tier === "normal") return false;
  if (tier === "free_only") return !isIncludedModel(model);
  if (isIncludedModel(model)) return false;
  return (primaryCost(model) ?? Number.MAX_SAFE_INTEGER) > 3;
}

function scoreModel(model: ExplorerModel, tier: SpendingTier) {
  const caps = computeCapabilities(model);
  let score = 0;

  score += model.isFeatured ? 40 : 0;
  score += Math.min(24, model.usageCount * 2);
  score += caps.reasoning * 1.4;
  score += caps.code * 1.0;
  score += caps.speed * 0.8;
  score += caps.vision * 0.6;
  score += caps.creative * 0.6;

  if (model.contextLength) {
    if (model.contextLength >= 200_000) score += 14;
    else if (model.contextLength >= 64_000) score += 8;
    else if (model.contextLength >= 16_000) score += 3;
  }

  const inputCost = primaryCost(model);
  if (isIncludedModel(model)) score += 12;
  else if (typeof inputCost === "number") {
    if (inputCost <= 1) score += 8;
    else if (inputCost <= 3) score += 4;
    else if (inputCost > 12) score -= 5;
  }

  if (tier === "free_only" && !isIncludedModel(model)) score -= 100;
  if (tier === "cheap_only" && !isIncludedModel(model) && (inputCost ?? Number.MAX_SAFE_INTEGER) > 3) score -= 60;

  return score;
}

function capabilityPills(model: ExplorerModel) {
  const caps = computeCapabilities(model);
  const pills: Array<{ key: string; label: string; icon: React.ReactNode }> = [];
  if (caps.reasoning >= 7) pills.push({ key: "reasoning", label: "Reasoning", icon: <Brain className="h-3 w-3" /> });
  if (caps.code >= 7) pills.push({ key: "code", label: "Code", icon: <Code2 className="h-3 w-3" /> });
  if (caps.vision >= 5) pills.push({ key: "vision", label: "Vision", icon: <Eye className="h-3 w-3" /> });
  if (caps.speed >= 8) pills.push({ key: "speed", label: "Fast", icon: <Timer className="h-3 w-3" /> });
  if (caps.creative >= 7) pills.push({ key: "creative", label: "Creative", icon: <PenLine className="h-3 w-3" /> });
  if (isIncludedModel(model)) pills.push({ key: "included", label: "Included", icon: <Tag className="h-3 w-3" /> });
  return pills.slice(0, 5);
}

function tierLabel(tier: SpendingTier) {
  if (tier === "free_only") return "Budget only";
  if (tier === "cheap_only") return "Cheap only";
  return "Normal";
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

  return (
    <article
      className={`rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 ${
        restricted ? "opacity-55" : "transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]"
      }`}
    >
      <div className="mb-3 flex items-start gap-2.5">
        <ProviderLogo provider={model.provider} modelId={model.modelId} />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-[var(--text-primary)]">{sanitizeName(model.name || model.modelId)}</p>
          <p className="truncate text-xs text-[var(--text-secondary)]">{model.provider}</p>
        </div>
      </div>

      <p className="line-clamp-3 min-h-[54px] text-xs leading-relaxed text-[var(--text-secondary)]">{model.description || "No description available."}</p>

      <div className="mt-3 flex flex-wrap gap-1">
        {capabilityPills(model).map((badge) => (
          <span
            key={`${model.modelId}-${badge.key}`}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]"
          >
            {badge.icon}
            {badge.label}
          </span>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5 text-[11px] text-[var(--text-secondary)]">
        <div
          title="Context window: how much text the model can consider in one request."
          className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1.5"
        >
          <p className="uppercase tracking-wide">Context</p>
          <p className="mt-0.5 text-[var(--text-primary)]">{formatContext(model.contextLength)}</p>
        </div>
        <div
          title="Input price: estimated cost per 1M prompt tokens."
          className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1.5"
        >
          <p className="uppercase tracking-wide">Input</p>
          <p className="mt-0.5 text-[var(--text-primary)]">{formatCost(model.inputCostPerM, model.isFree)}</p>
        </div>
        <div
          title="Output price: estimated cost per 1M generated tokens."
          className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1.5"
        >
          <p className="uppercase tracking-wide">Output</p>
          <p className="mt-0.5 text-[var(--text-primary)]">{formatCost(model.outputCostPerM, model.isFree)}</p>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] text-[var(--text-secondary)]">
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1.5">
          <p className="uppercase tracking-wide">Released</p>
          <p className="mt-0.5 text-[var(--text-primary)]">{model.releaseDate ?? "Unknown"}</p>
        </div>
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1.5">
          <p className="uppercase tracking-wide">Knowledge</p>
          <p className="mt-0.5 text-[var(--text-primary)]">{model.knowledgeCutoff ?? "Unknown"}</p>
        </div>
      </div>

      {(typeof model.benchmarkMMLU === "number" || typeof model.benchmarkHumanEval === "number" || typeof model.arenaElo === "number") ? (
        <div className="mt-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)]">
          <p className="uppercase tracking-wide">Benchmarks</p>
          <p className="mt-0.5 text-[var(--text-primary)]">
            MMLU {typeof model.benchmarkMMLU === "number" ? model.benchmarkMMLU.toFixed(1) : "—"} • HumanEval {typeof model.benchmarkHumanEval === "number" ? model.benchmarkHumanEval.toFixed(1) : "—"} • Elo {typeof model.arenaElo === "number" ? Math.round(model.arenaElo) : "—"}
          </p>
        </div>
      ) : null}

      {model.usageCount > 0 && (
        <p className="mt-2 text-[11px] text-[var(--text-secondary)]">Used {model.usageCount}x in your school</p>
      )}

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
  const [catalogModels, setCatalogModels] = useState<CatalogModel[]>([]);
  const [featuredModels, setFeaturedModels] = useState<CatalogModel[]>([]);
  const [mostUsed, setMostUsed] = useState<MostUsedModel[]>([]);
  const [mostUsedByUser, setMostUsedByUser] = useState<MostUsedModel[]>([]);
  const [liveModels, setLiveModels] = useState<LiveModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticIds, setSemanticIds] = useState<string[] | null>(null);

  const [tier, setTier] = useState<SpendingTier>("normal");
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [providerSearch, setProviderSearch] = useState("");
  const [capability, setCapability] = useState<CapabilityFilter>("all");
  const [price, setPrice] = useState<PriceFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("recommended");
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);

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
          mostUsedByUser?: MostUsedModel[];
        };

        setCatalogModels(catalogPayload.models ?? []);
        setFeaturedModels(catalogPayload.featured ?? []);
        setMostUsed(catalogPayload.mostUsed ?? []);
        setMostUsedByUser(catalogPayload.mostUsedByUser ?? []);

        if (bootstrapRes.ok) {
          const bootstrap = (await bootstrapRes.json()) as { userSpending?: { tier?: SpendingTier } };
          if (bootstrap.userSpending?.tier) {
            setTier(bootstrap.userSpending.tier);
          }
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

  const models = useMemo(() => {
    const usageMap = new Map(mostUsed.map((model) => [model.modelId, model.usageCount]));
    const merged = new Map<string, ExplorerModel>();

    for (const model of catalogModels) {
      merged.set(model.modelId, {
        ...model,
        name: sanitizeName(model.name || model.modelId),
        usageCount: usageMap.get(model.modelId) ?? 0,
      });
    }

    for (const live of liveModels) {
      const existing = merged.get(live.id);
      merged.set(live.id, {
        _id: existing?._id ?? live.id,
        modelId: live.id,
        name: sanitizeName(existing?.name || live.name || live.id),
        provider: existing?.provider || live.provider || "Unknown",
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
      });
    }

    return [...merged.values()]
      .filter((model) => !/whisper|tts|speech|transcribe/i.test(model.modelId))
      .filter((model) => (model.contextLength ?? 0) > 0 || Boolean(model.description));
  }, [catalogModels, liveModels, mostUsed]);

  const providers = useMemo(() => {
    const scores = new Map<string, number>();
    for (const model of models) {
      const providerName = model.provider?.trim();
      if (!providerName) continue;
      const base = scores.get(providerName) ?? 0;
      const usageBoost = Math.max(1, model.usageCount);
      const featuredBoost = model.isFeatured ? 8 : 0;
      const costBoost = isIncludedModel(model) ? 2 : 0;
      scores.set(providerName, base + usageBoost + featuredBoost + costBoost);
    }

    return ["all", ...Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([providerName]) => providerName)];
  }, [models]);

  const filteredProviders = useMemo(() => {
    const needle = providerSearch.trim().toLowerCase();
    if (!needle) return providers;
    const filtered = providers.filter((item) => item === "all" || item.toLowerCase().includes(needle));
    if (provider !== "all" && !filtered.includes(provider)) {
      return [provider, ...filtered];
    }
    return filtered;
  }, [provider, providerSearch, providers]);

  async function runSemanticSearch(value: string) {
    const clean = value.trim();
    if (!clean) {
      setSemanticIds(null);
      return;
    }

    setSemanticLoading(true);
    try {
      const response = await fetch("/api/models/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: clean }),
      });

      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as { results: Array<{ modelId: string }> };
      setSemanticIds(payload.results.map((item) => item.modelId));
    } catch {
      setSemanticIds(null);
    } finally {
      setSemanticLoading(false);
    }
  }

  useEffect(() => {
    const clean = query.trim();
    if (!clean) {
      setSemanticIds(null);
      return;
    }

    const timeout = setTimeout(() => {
      const localHits = models
        .map((model) => ({ modelId: model.modelId, score: fuzzyScore(clean, model) }))
        .filter((row) => row.score > 0)
        .slice(0, 10);

      if (localHits.length < 4) {
        void runSemanticSearch(clean);
      } else {
        setSemanticIds(null);
      }
    }, 450);

    return () => clearTimeout(timeout);
  }, [models, query]);

  const semanticSet = useMemo(() => new Set(semanticIds ?? []), [semanticIds]);

  const allModels = useMemo(() => {
    const clean = query.trim().toLowerCase();

    const scopedInitial = models
      .filter((model) => (provider === "all" ? true : model.provider === provider))
      .filter((model) => hasCapability(model, capability));
    const scoped = scopedInitial.length > 0 ? scopedInitial : models;

    const priced = scoped.filter((model) => matchesPrice(model, price));
    let filtered = priced.length > 0 ? priced : scoped;

    if (price === "free" && filtered.length < 3) {
      const supplemental = [...scoped]
        .filter((model) => !filtered.some((picked) => picked.modelId === model.modelId))
        .sort((a, b) => {
          const aCost = primaryCost(a) ?? Number.MAX_SAFE_INTEGER;
          const bCost = primaryCost(b) ?? Number.MAX_SAFE_INTEGER;
          return aCost - bCost;
        })
        .slice(0, Math.max(0, 3 - filtered.length));
      filtered = [...filtered, ...supplemental];
    }

    if (clean) {
      const searched = filtered
        .map((model) => ({ model, score: fuzzyScore(clean, model) }))
        .filter((row) => row.score > 0 || semanticSet.has(row.model.modelId))
        .sort((a, b) => {
          const aSemantic = semanticSet.has(a.model.modelId) ? 1 : 0;
          const bSemantic = semanticSet.has(b.model.modelId) ? 1 : 0;
          if (aSemantic !== bSemantic) return bSemantic - aSemantic;
          return b.score - a.score;
        })
        .map((row) => row.model)
        .slice(0, Math.min(30, filtered.length));
      if (searched.length > 0) {
        filtered = searched;
      } else {
        filtered = [...filtered]
          .sort((a, b) => scoreModel(b, tier) - scoreModel(a, tier))
          .slice(0, Math.min(12, filtered.length));
      }
    }

    if (filtered.length === 0) {
      filtered = [...models]
        .sort((a, b) => scoreModel(b, tier) - scoreModel(a, tier))
        .slice(0, Math.min(12, models.length));
    }

    return [...filtered].sort((a, b) => {
      if (sortMode === "context") return (b.contextLength ?? 0) - (a.contextLength ?? 0);
      if (sortMode === "input_price") {
        const aCost = typeof a.inputCostPerM === "number" ? a.inputCostPerM : Number.MAX_SAFE_INTEGER;
        const bCost = typeof b.inputCostPerM === "number" ? b.inputCostPerM : Number.MAX_SAFE_INTEGER;
        return aCost - bCost;
      }
      if (sortMode === "popular") return b.usageCount - a.usageCount;
      return scoreModel(b, tier) - scoreModel(a, tier);
    });
  }, [capability, models, price, provider, query, semanticSet, sortMode, tier]);

  const featured = useMemo(() => {
    const source = featuredModels.length > 0 ? featuredModels : models.filter((model) => model.isFeatured);
    return [...source]
      .map((model) => models.find((item) => item.modelId === model.modelId) ?? ({ ...model, usageCount: 0 } as ExplorerModel))
      .sort((a, b) => (a.featuredOrder ?? 999) - (b.featuredOrder ?? 999));
  }, [featuredModels, models]);

  const mostUsedCards = useMemo(() => {
    return mostUsed
      .map((item) => {
        const existing = models.find((model) => model.modelId === item.modelId);
        if (existing) return existing;
        return {
          ...item,
          name: sanitizeName(item.name || item.modelId),
          usageCount: item.usageCount ?? 0,
        } as ExplorerModel;
      })
      .filter((model): model is ExplorerModel => Boolean(model));
  }, [models, mostUsed]);

  const mostUsedByUserCards = useMemo(() => {
    return mostUsedByUser
      .map((item) => {
        const existing = models.find((model) => model.modelId === item.modelId);
        if (existing) return existing;
        return {
          ...item,
          name: sanitizeName(item.name || item.modelId),
          usageCount: item.usageCount ?? 0,
        } as ExplorerModel;
      })
      .filter((model): model is ExplorerModel => Boolean(model));
  }, [models, mostUsedByUser]);

  function tryModel(modelId: string) {
    router.push(`/?model=${encodeURIComponent(modelId)}&mode=auto`);
  }

  if (loading) {
    return (
      <AppShell>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 9 }).map((_, index) => (
            <div key={index} className="h-56 animate-pulse rounded-xl bg-[var(--bg-secondary)]" />
          ))}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <section className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Model Explorer</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Strength-first browsing with real context length and pricing visibility.
          </p>
        </div>
        <Button variant="secondary" className="gap-2" onClick={() => setLeaderboardOpen(true)}>
          <Trophy className="h-4 w-4" />
          Leaderboard
        </Button>
      </section>

      <section className="mb-5 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-4 h-5 w-5 text-[var(--text-secondary)]" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks or model names"
            className="h-14 w-full pl-12 text-lg"
          />
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-secondary)]" />
            <Input
              value={providerSearch}
              onChange={(event) => setProviderSearch(event.target.value)}
              placeholder="Search providers"
              className="h-9 pl-9 text-sm"
            />
          </div>
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            className="h-9 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)]"
          >
            {filteredProviders.length === 0 && <option value="all">All providers</option>}
            {filteredProviders.map((item) => (
              <option key={item} value={item}>{item === "all" ? "All providers (recommended)" : item}</option>
            ))}
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={capability}
            onChange={(event) => setCapability(event.target.value as CapabilityFilter)}
            className="h-9 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)]"
          >
            <option value="all">All capabilities</option>
            <option value="reasoning">Reasoning</option>
            <option value="code">Code</option>
            <option value="vision">Vision</option>
            <option value="speed">Speed</option>
            <option value="creative">Creative</option>
          </select>

          <select
            value={price}
            onChange={(event) => setPrice(event.target.value as PriceFilter)}
            className="h-9 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)]"
          >
            <option value="all">All prices</option>
            <option value="free">Included</option>
            <option value="cheap">Cheap</option>
            <option value="premium">Premium</option>
            <option value="unknown">Unknown</option>
          </select>

          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
            className="h-9 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)]"
          >
            <option value="recommended">Recommended</option>
            <option value="popular">Most used</option>
            <option value="context">Largest context</option>
            <option value="input_price">Lowest input cost</option>
          </select>

          {TASK_CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => {
                setQuery(chip.query);
                void runSemanticSearch(chip.query);
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
            >
              <Sparkles className="h-3 w-3" />
              {chip.label}
            </button>
          ))}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--text-secondary)]">
            <SlidersHorizontal className="h-3 w-3" />
            Tier: {tierLabel(tier)}
          </span>
        </div>
      </section>

      {featured.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">Featured Models</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {featured.slice(0, 6).map((model) => (
              <ModelCard key={model.modelId} model={model} tier={tier} onTry={tryModel} />
            ))}
          </div>
        </section>
      )}

      {mostUsedCards.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">Most Used In Your School</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {mostUsedCards.slice(0, 6).map((model) => (
              <ModelCard key={`popular-${model.modelId}`} model={model} tier={tier} onTry={tryModel} />
            ))}
          </div>
        </section>
      )}

      {mostUsedByUserCards.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">Most Used By You</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {mostUsedByUserCards.slice(0, 6).map((model) => (
              <ModelCard key={`mine-${model.modelId}`} model={model} tier={tier} onTry={tryModel} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">All Models</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            {semanticLoading ? "Semantic ranking in progress..." : `${allModels.length} models`}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {allModels.map((model) => (
            <ModelCard key={model.modelId} model={model} tier={tier} onTry={tryModel} />
          ))}
        </div>
      </section>

      <ModelLeaderboardDrawer open={leaderboardOpen} onClose={() => setLeaderboardOpen(false)} />
    </AppShell>
  );
}
