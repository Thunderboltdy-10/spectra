"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownAZ, ArrowUpAZ, Coins, Filter, Search, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  created?: string;
};

type SpendingTier = "normal" | "cheap_only" | "free_only";

type SortKey = "price" | "context" | "newest";
type SortDirection = "asc" | "desc";

function isFree(model: LiveModel) {
  return model.id.includes(":free") || (model.pricing.prompt ?? 0) === 0;
}

function formatCost(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  if (value === 0) return "$0 / 1M";
  if (value < 0.0001) return "<$0.0001 / 1M";
  return `$${value.toFixed(value < 0.01 ? 4 : 3)} / 1M`;
}

function restrictedByTier(model: LiveModel, tier: SpendingTier) {
  if (tier === "normal") return false;
  if (tier === "free_only") return !isFree(model);
  const prompt = model.pricing.prompt ?? Number.MAX_SAFE_INTEGER;
  return !isFree(model) && prompt >= 0.5;
}

export default function ModelsPage() {
  const router = useRouter();

  const [models, setModels] = useState<LiveModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [cachedAt, setCachedAt] = useState("");

  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [sortBy, setSortBy] = useState<SortKey>("price");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [contextMin, setContextMin] = useState(0);
  const [contextMax, setContextMax] = useState(2_000_000);
  const [priceMax, setPriceMax] = useState(3);

  const [tier, setTier] = useState<SpendingTier>("normal");

  useEffect(() => {
    void (async () => {
      try {
        const [modelRes, bootstrapRes] = await Promise.all([fetch("/api/models/live"), fetch("/api/bootstrap")]);

        if (!modelRes.ok) throw new Error(await modelRes.text());
        const modelData = (await modelRes.json()) as { models: LiveModel[]; cachedAt: string };
        setModels(modelData.models);
        setCachedAt(modelData.cachedAt);

        if (bootstrapRes.ok) {
          const bootstrap = (await bootstrapRes.json()) as { userSpending?: { tier?: SpendingTier } };
          if (bootstrap.userSpending?.tier) {
            setTier(bootstrap.userSpending.tier);
          }
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load models");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const providers = useMemo(() => {
    return ["all", ...new Set(models.map((model) => model.provider))];
  }, [models]);

  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase();

    const base = models.filter((model) => {
      const searchable = `${model.name} ${model.id} ${model.provider} ${model.description}`.toLowerCase();
      if (clean && !searchable.includes(clean)) return false;
      if (provider !== "all" && model.provider !== provider) return false;

      const ctx = model.contextLength ?? 0;
      if (ctx < contextMin || ctx > contextMax) return false;

      const prompt = model.pricing.prompt;
      if (typeof prompt === "number" && prompt > priceMax) return false;

      return true;
    });

    const sorted = [...base].sort((a, b) => {
      if (sortBy === "context") {
        return (a.contextLength ?? 0) - (b.contextLength ?? 0);
      }
      if (sortBy === "newest") {
        const ta = a.created ? Date.parse(a.created) : 0;
        const tb = b.created ? Date.parse(b.created) : 0;
        return ta - tb;
      }
      const pa = typeof a.pricing.prompt === "number" ? a.pricing.prompt : Number.MAX_SAFE_INTEGER;
      const pb = typeof b.pricing.prompt === "number" ? b.pricing.prompt : Number.MAX_SAFE_INTEGER;
      return pa - pb;
    });

    return sortDirection === "asc" ? sorted : sorted.reverse();
  }, [models, query, provider, contextMin, contextMax, priceMax, sortBy, sortDirection]);

  if (loading) {
    return (
      <AppShell>
        <div className="space-y-4">
          <div className="h-10 w-72 animate-pulse rounded-xl bg-[var(--bg-secondary)]" />
          <div className="h-20 w-full animate-pulse rounded-xl bg-[var(--bg-secondary)]" />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-56 animate-pulse rounded-xl bg-[var(--bg-secondary)]" />
            ))}
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="font-display text-4xl tracking-tight">Model Explorer</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Live OpenRouter catalog. Cached hourly ({new Date(cachedAt).toLocaleString()}).
        </p>
      </div>

      <div className="mb-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
        <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">
          <Filter className="h-3.5 w-3.5" />
          Filters
        </div>

        <div className="grid gap-2 lg:grid-cols-[1.4fr_1fr_1fr]">
          <div className="relative">
            <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">Search</p>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-secondary)]" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search model name or id"
              className="pl-9"
            />
          </div>

          <label className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            Provider
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-sm normal-case tracking-normal"
            >
              {providers.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <label className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
              Sort by
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as SortKey)}
                className="mt-1 h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-sm normal-case tracking-normal"
              >
                <option value="price">Price</option>
                <option value="context">Context</option>
                <option value="newest">Newest</option>
              </select>
            </label>
            <div className="pt-[17px]">
              <Button
                type="button"
                variant="secondary"
                className="h-10 px-3"
                onClick={() => setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))}
              >
                {sortDirection === "asc" ? <ArrowUpAZ className="h-4 w-4" /> : <ArrowDownAZ className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <label className="text-xs text-[var(--text-secondary)]">
            Context min
            <input
              type="number"
              value={contextMin}
              onChange={(event) => setContextMin(Number(event.target.value))}
              className="mt-1 h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-sm"
            />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">
            Context max
            <input
              type="number"
              value={contextMax}
              onChange={(event) => setContextMax(Number(event.target.value))}
              className="mt-1 h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-sm"
            />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">
            Max prompt price ($/1M)
            <input
              type="number"
              step="0.1"
              value={priceMax}
              onChange={(event) => setPriceMax(Number(event.target.value))}
              className="mt-1 h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-sm"
            />
          </label>
        </div>
      </div>

      <div className="mb-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        <span>{filtered.length} models</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((model) => {
          const restricted = restrictedByTier(model, tier);
          return (
            <article
              key={model.id}
              className={`rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 transition ${
                restricted ? "opacity-55" : "hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]"
              }`}
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ProviderLogo provider={model.provider} modelId={model.id} />
                  <div>
                    <p className="line-clamp-1 font-semibold text-[var(--text-primary)]">{model.name}</p>
                    <p className="text-xs text-[var(--text-secondary)]">{model.provider}</p>
                  </div>
                </div>
              </div>

              <p className="line-clamp-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                {model.description || "No description"}
              </p>

              <div className="mt-3 flex flex-wrap gap-1">
                {model.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
                    {tag}
                  </span>
                ))}
              </div>

              <div className="mt-3 space-y-1 text-xs text-[var(--text-secondary)]">
                <p>Context: {(model.contextLength ?? 0).toLocaleString()}</p>
                <p>Prompt: {formatCost(model.pricing.prompt)}</p>
                <p>Completion: {formatCost(model.pricing.completion)}</p>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={restricted}
                  onClick={() => router.push(`/?model=${encodeURIComponent(model.id)}&mode=auto`)}
                >
                  Try in chat
                </Button>
                {restricted && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-[var(--danger)]">
                    <Coins className="h-3 w-3" />
                    Above your tier
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </AppShell>
  );
}
