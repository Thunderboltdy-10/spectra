"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Clock3,
  DatabaseZap,
  Layers3,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { workTypeMeta } from "@/features/spectra/components/artifact-card";
import type { CapabilityState } from "@/features/spectra/core/capability-truth";
import {
  CapabilityTruthBadge,
  CapabilityTruthState,
} from "@/features/spectra/integrations/status/capability-truth";
import {
  metricDefinition,
  metricSourceLabel,
  type SpectraMetricDefinition,
} from "@/features/spectra/administration/metric-registry";

type MetricValue = { value: number | null; state: CapabilityState };
type AnalyticsPayload = {
  range: { from: number; to: number; fromDay: string; toDay: string };
  computedAt: number;
  privacy: string;
  metrics: {
    workCreated: MetricValue;
    activeWorkspaces: MetricValue;
    aiRuns: MetricValue;
    completionRate: MetricValue;
    modelTokens: MetricValue;
    collaborationBytes: MetricValue;
  };
  byType: Array<{ key: string; value: number }>;
  runOutcomes: Record<"completed" | "active" | "failed" | "cancelled", number>;
  recentWork: Array<{
    id: string;
    title: string;
    blueprintKey: string;
    status: string;
    createdAt: number;
  }>;
  recentRuns: Array<{
    id: string;
    title: string;
    status: string;
    createdAt: number;
  }>;
};

const WINDOWS = [7, 30, 90] as const;

async function loadAnalytics(from: number, to: number) {
  const response = await fetch(
    `/api/spectra/analytics?from=${from}&to=${to}`,
    { cache: "no-store" },
  );
  const payload = (await response.json().catch(() => null)) as
    | { data?: AnalyticsPayload; message?: string; error?: { message?: string } }
    | null;
  if (!response.ok || !payload?.data)
    throw new Error(
      payload?.message ?? payload?.error?.message ?? "Could not load analytics.",
    );
  return payload.data;
}

export function AnalyticsShell() {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const [payload, setPayload] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const to = Date.now();
    const from = to - days * 24 * 60 * 60_000;
    try {
      setPayload(await loadAnalytics(from, to));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load analytics.");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const overallState: CapabilityState = error
    ? { kind: "unavailable", retryable: true, message: error }
    : loading && payload
      ? { kind: "refreshing", previous: payload }
      : payload
        ? { kind: "available", updatedAt: payload.computedAt }
        : { kind: "refreshing" };

  const byType = useMemo(
    () =>
      (payload?.byType ?? []).map((row) => ({
        ...row,
        label:
          workTypeMeta[row.key as keyof typeof workTypeMeta]?.label ??
          row.key.replaceAll("_", " "),
        color:
          workTypeMeta[row.key as keyof typeof workTypeMeta]?.color ?? "#64748b",
      })),
    [payload?.byType],
  );

  const metricCards = payload
    ? [
        ["account.work_created", payload.metrics.workCreated, Layers3, "number"],
        ["account.active_workspaces", payload.metrics.activeWorkspaces, BarChart3, "number"],
        ["account.ai_runs", payload.metrics.aiRuns, Activity, "number"],
        ["account.ai_completion_rate", payload.metrics.completionRate, ShieldCheck, "percent"],
        ["account.model_tokens", payload.metrics.modelTokens, DatabaseZap, "compact"],
        ["account.collaboration_bytes", payload.metrics.collaborationBytes, RefreshCw, "bytes"],
      ] as const
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      <header className="px-6 py-5 lg:px-9">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            {overallState.kind !== "available" ? <CapabilityTruthBadge state={overallState} /> : null}
            <h1 className="font-display text-display font-semibold leading-none tracking-[-0.03em] text-[var(--text-primary)]">
              Analytics
            </h1>
            <p className="mt-2 max-w-2xl text-caption leading-5 text-[var(--text-secondary)]">
              A date-bounded view of your work and AI activity, derived without reading private content.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1">
              {WINDOWS.map((windowDays) => (
                <button
                  key={windowDays}
                  type="button"
                  onClick={() => setDays(windowDays)}
                  className={`h-7 rounded-md px-3 text-micro font-semibold ${days === windowDays ? "bg-[var(--text-primary)] text-[var(--bg-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
                >
                  {windowDays}d
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border-default)] px-3 text-micro font-semibold disabled:opacity-45"
            >
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>
        {payload ? (
          <p className="mt-3 text-micro text-[var(--text-tertiary)]">
            {payload.range.fromDay} → {payload.range.toDay} · computed {formatDate(payload.computedAt)}
          </p>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 lg:px-9">
        {error ? (
          <CapabilityTruthState state={overallState} title="Personal analytics" onRetry={() => void refresh()} />
        ) : null}

        <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
          {metricCards.map(([id, metric, Icon, format]) => (
            <MetricCard
              key={id}
              definition={metricDefinition(id)}
              metric={metric}
              icon={<Icon className="size-4" />}
              format={format}
            />
          ))}
          {!payload
            ? Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="h-28 animate-pulse rounded-card bg-[var(--bg-secondary)]" />
              ))
            : null}
        </div>

        {payload ? (
          <>
            <div className="mt-7 grid gap-7 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,.85fr)]">
              <section className="p-2">
                <SectionHeading title="Work created by type" detail="New work in this account and date range" />
                <div className="mt-5 space-y-3">
                  {payload.metrics.workCreated.value === null ? <CapabilityTruthState state={payload.metrics.workCreated.state} title="Work history" /> : byType.length ? byType.map((row) => {
                    const maximum = byType[0]?.value ?? 1;
                    return (
                      <div key={row.key} className="grid grid-cols-[112px_1fr_32px] items-center gap-3">
                        <span className="truncate text-caption font-medium text-[var(--text-secondary)]">{row.label}</span>
                        <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(5, (row.value / maximum) * 100)}%`, background: row.color }} />
                        </div>
                        <span className="text-right text-caption font-semibold tabular-nums">{row.value}</span>
                      </div>
                    );
                  }) : <EmptyLine label="No work was created in this range." />}
                </div>
              </section>

              <section className="p-2">
                <SectionHeading title="AI run outcomes" detail="Settled and still-active runs remain distinct" />
                {payload.metrics.aiRuns.value === null ? <div className="mt-4"><CapabilityTruthState state={payload.metrics.aiRuns.state} title="AI run history" /></div> : <div className="mt-4 grid grid-cols-2 gap-1">
                  {([
                    ["Completed", payload.runOutcomes.completed, "#14795c"],
                    ["Active", payload.runOutcomes.active, "#2563eb"],
                    ["Failed", payload.runOutcomes.failed, "#b45309"],
                    ["Cancelled", payload.runOutcomes.cancelled, "#64748b"],
                  ] as const).map(([label, value, color]) => (
                    <div key={label} className="rounded-card p-4 transition-colors hover:bg-[var(--bg-secondary)]">
                      <p className="text-micro font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">{label}</p>
                      <p className="mt-2 font-display text-metric font-semibold tabular-nums" style={{ color }}>{value}</p>
                    </div>
                  ))}
                </div>}
              </section>
            </div>

            <div className="mt-7 grid gap-7 xl:grid-cols-2">
              <RecentList title="Recent work" detail="Created in this range" empty={payload.metrics.workCreated.value === null ? "Work history is still being prepared." : "No recent work."} rows={payload.recentWork.map((item) => ({ id: item.id, title: item.title, detail: `${item.blueprintKey.replaceAll("_", " ")} · ${item.status}`, timestamp: item.createdAt }))} />
              <RecentList title="Recent AI runs" detail="Titles and status only; prompts are not queried" empty={payload.metrics.aiRuns.value === null ? "AI run history is still being prepared." : "No recent AI runs."} rows={payload.recentRuns.map((item) => ({ id: item.id, title: item.title, detail: item.status, timestamp: item.createdAt }))} />
            </div>

            <section className="mt-8 p-2">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-800" />
                <div>
                  <h2 className="text-ui font-semibold text-[var(--text-primary)]">Privacy and source boundary</h2>
                  <p className="mt-1 max-w-3xl text-caption leading-6 text-[var(--text-secondary)]">{payload.privacy}</p>
                  <p className="mt-2 text-micro text-[var(--text-tertiary)]">Indexed sources: work created, workspace activity, AI run metadata, and daily account usage meters.</p>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function MetricCard({ definition, metric, icon, format }: { definition: SpectraMetricDefinition; metric: MetricValue; icon: React.ReactNode; format: "number" | "percent" | "compact" | "bytes" }) {
  return (
    <article className="rounded-card p-4 transition-colors hover:bg-[var(--bg-secondary)]" title={`Source: ${metricSourceLabel(definition)}. ${definition.aggregation}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-[var(--text-secondary)]">{icon}<span className="text-micro font-medium">{definition.label}</span></div>
        {metric.state.kind !== "available" ? <CapabilityTruthBadge state={metric.state} className="min-h-5 px-2 text-micro" /> : null}
      </div>
      <p className="mt-3 font-display text-display font-semibold tabular-nums text-[var(--text-primary)]">{formatMetric(metric.value, format)}</p>
      {metric.state.kind === "partial" || metric.value === 0 || metric.value === null ? <p className="mt-2 text-micro leading-4 text-[var(--text-secondary)]">{metric.state.kind === "partial" ? metric.state.details : definition.zeroMeaning}</p> : null}
    </article>
  );
}

function SectionHeading({ title, detail }: { title: string; detail: string }) {
  return <div><h2 className="font-display text-title font-semibold text-[var(--text-primary)]">{title}</h2><p className="mt-1 text-micro text-[var(--text-tertiary)]">{detail}</p></div>;
}

function RecentList({ title, detail, empty, rows }: { title: string; detail: string; empty: string; rows: Array<{ id: string; title: string; detail: string; timestamp: number }> }) {
  return <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5"><SectionHeading title={title} detail={detail} /><div className="mt-3 divide-y divide-[var(--border-subtle)]">{rows.length ? rows.map((row) => <div key={row.id} className="flex items-start gap-3 py-3"><Clock3 className="mt-0.5 size-3.5 shrink-0 text-[var(--text-tertiary)]" /><div className="min-w-0 flex-1"><p className="truncate text-caption font-semibold text-[var(--text-primary)]">{row.title}</p><p className="mt-1 text-micro capitalize text-[var(--text-tertiary)]">{row.detail} · {formatDate(row.timestamp)}</p></div></div>) : <EmptyLine label={empty} />}</div></section>;
}

function EmptyLine({ label }: { label: string }) {
  return <p className="py-6 text-center text-micro text-[var(--text-tertiary)]">{label}</p>;
}

function formatMetric(value: number | null, format: "number" | "percent" | "compact" | "bytes") {
  if (value === null) return "Not measured";
  if (format === "percent") return `${value}%`;
  if (format === "bytes") return value < 1_024 ? `${value} B` : value < 1_048_576 ? `${(value / 1_024).toFixed(1)} KB` : `${(value / 1_048_576).toFixed(1)} MB`;
  if (format === "compact") return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return value.toLocaleString();
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}
