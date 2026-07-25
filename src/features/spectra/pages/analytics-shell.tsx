"use client";

import { useEffect, useState } from "react";
import { Activity, BarChart3, Clock3, Layers3 } from "lucide-react";
import { getSpectraOverview } from "@/features/spectra/data/api";

type OverviewMetrics = {
  artifactCount: number;
  workspaceCount: number;
  recentRunCount: number;
};

export function AnalyticsShell() {
  const [overview, setOverview] = useState<OverviewMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await getSpectraOverview(undefined, true);
        if (cancelled) return;
        setOverview({
          artifactCount: payload.artifacts?.length ?? 0,
          workspaceCount: payload.workspaces?.length ?? 0,
          recentRunCount: payload.runs?.length ?? 0,
        });
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load analytics.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      <header className="border-b border-[var(--border-default)] px-8 py-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          Personal signals
        </p>
        <h1 className="mt-1 font-display text-[28px] text-[var(--text-primary)]">
          Analytics
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
          A private overview of your Spectra activity. School and platform
          operators never see private prompts, threads, or memory here.
        </p>
      </header>

      <div className="overflow-y-auto px-8 py-6">
        {error ? (
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-5 py-4 text-sm text-[var(--text-secondary)]">
            {error}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={<Layers3 size={16} />}
              label="Artifacts"
              value={overview?.artifactCount}
            />
            <MetricCard
              icon={<BarChart3 size={16} />}
              label="Workspaces"
              value={overview?.workspaceCount}
            />
            <MetricCard
              icon={<Activity size={16} />}
              label="Recent runs"
              value={overview?.recentRunCount}
            />
            <MetricCard
              icon={<Clock3 size={16} />}
              label="Sync health"
              valueLabel="Live"
            />
          </div>
        )}
        <section className="mt-6 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            What stays private
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
            Prompt text, thread transcripts, memory claims, and unrelated
            artifacts are excluded from school and platform analytics. This page
            only summarizes your own accessible work.
          </p>
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  valueLabel,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
  valueLabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-2 text-[var(--text-secondary)]">
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-[0.12em]">
          {label}
        </span>
      </div>
      <p className="mt-3 font-display text-3xl text-[var(--text-primary)]">
        {valueLabel ?? (value === undefined ? "—" : String(value))}
      </p>
    </div>
  );
}
