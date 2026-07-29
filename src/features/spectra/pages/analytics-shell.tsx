"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Clock3,
  FileText,
  Layers3,
  Sparkles,
} from "lucide-react";
import {
  getSpectraOverview,
  type SpectraArtifact,
  type SpectraOverview,
  type SpectraResultCard,
  type SpectraRun,
} from "@/features/spectra/data/api";
import { blueprintMeta } from "@/features/spectra/components/artifact-card";

type AnalyticsState = {
  artifacts: SpectraArtifact[];
  workspaces: SpectraOverview["workspaces"];
  runs: SpectraRun[];
  resultCards: SpectraResultCard[];
};

export function AnalyticsShell() {
  const [overview, setOverview] = useState<AnalyticsState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await getSpectraOverview(undefined, true);
        if (cancelled) return;
        setOverview({
          artifacts: payload.artifacts ?? [],
          workspaces: payload.workspaces ?? [],
          runs: payload.runs ?? [],
          resultCards: payload.resultCards ?? [],
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

  const byType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const artifact of overview?.artifacts ?? []) {
      counts.set(
        artifact.blueprintKey,
        (counts.get(artifact.blueprintKey) ?? 0) + 1,
      );
    }
    return [...counts.entries()]
      .map(([key, count]) => ({
        key,
        count,
        label:
          blueprintMeta[key as keyof typeof blueprintMeta]?.label ??
          key.replaceAll("_", " "),
        color:
          blueprintMeta[key as keyof typeof blueprintMeta]?.color ??
          "var(--text-tertiary)",
      }))
      .sort((a, b) => b.count - a.count);
  }, [overview?.artifacts]);

  const runStatus = useMemo(() => {
    const counts = {
      completed: 0,
      failed: 0,
      cancelled: 0,
      active: 0,
    };
    for (const run of overview?.runs ?? []) {
      if (run.status === "completed") counts.completed += 1;
      else if (run.status === "failed") counts.failed += 1;
      else if (run.status === "cancelled") counts.cancelled += 1;
      else counts.active += 1;
    }
    return counts;
  }, [overview?.runs]);

  const recentCards = (overview?.resultCards ?? [])
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8);

  const recentRuns = (overview?.runs ?? [])
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8);

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
          A private overview of your Spectra activity — artifacts, runs, and
          recent results. School and platform operators never see private
          prompts, threads, or memory here.
        </p>
      </header>

      <div className="overflow-y-auto px-8 py-6">
        {error ? (
          <div className="rounded-[10px] border border-[var(--border-default)] px-5 py-4 text-sm text-[var(--text-secondary)]">
            {error}
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={<Layers3 size={16} />}
                label="Artifacts"
                value={overview?.artifacts.length}
              />
              <MetricCard
                icon={<BarChart3 size={16} />}
                label="Workspaces"
                value={overview?.workspaces.length}
              />
              <MetricCard
                icon={<Activity size={16} />}
                label="Recent runs"
                value={overview?.runs.length}
              />
              <MetricCard
                icon={<Sparkles size={16} />}
                label="Result cards"
                value={overview?.resultCards.length}
              />
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <section>
                <SectionHeading
                  title="Artifacts by type"
                  detail="Your library composition across blueprints"
                />
                <div className="mt-3 space-y-2">
                  {byType.length === 0 ? (
                    <EmptyLine label="No artifacts yet." />
                  ) : (
                    byType.map((row) => {
                      const max = byType[0]?.count ?? 1;
                      const width = Math.max(8, Math.round((row.count / max) * 100));
                      return (
                        <div
                          key={row.key}
                          className="flex items-center gap-3 py-1.5"
                        >
                          <span
                            className="w-28 shrink-0 truncate text-[13px] text-[var(--text-secondary)]"
                            title={row.label}
                          >
                            {row.label}
                          </span>
                          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${width}%`,
                                background: row.color,
                              }}
                            />
                          </div>
                          <span className="w-8 text-right text-[13px] tabular-nums text-[var(--text-primary)]">
                            {row.count}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>

              <section>
                <SectionHeading
                  title="Run outcomes"
                  detail="Status mix across recent AI runs"
                />
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {(
                    [
                      ["Completed", runStatus.completed, "#15916c"],
                      ["Active", runStatus.active, "#3b82f6"],
                      ["Failed", runStatus.failed, "#c2410c"],
                      ["Cancelled", runStatus.cancelled, "#78716c"],
                    ] as const
                  ).map(([label, value, color]) => (
                    <div
                      key={label}
                      className="border border-[var(--border-subtle)] px-4 py-3"
                    >
                      <p className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                        {label}
                      </p>
                      <p
                        className="mt-1 font-display text-2xl tabular-nums"
                        style={{ color }}
                      >
                        {overview ? value : "—"}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="mt-8 grid gap-6 xl:grid-cols-2">
              <section>
                <SectionHeading
                  title="Recent results"
                  detail="Cards kept from your latest runs"
                />
                <div className="mt-3 divide-y divide-[var(--border-subtle)]">
                  {recentCards.length === 0 ? (
                    <EmptyLine label="No result cards yet." />
                  ) : (
                    recentCards.map((card) => (
                      <div key={card._id} className="flex gap-3 py-3">
                        <FileText
                          size={15}
                          className="mt-0.5 shrink-0 text-[var(--text-tertiary)]"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                            {card.title}
                          </p>
                          {card.summary ? (
                            <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-[var(--text-secondary)]">
                              {card.summary}
                            </p>
                          ) : null}
                          <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                            {card.variant} · {formatRelative(card.updatedAt)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section>
                <SectionHeading
                  title="Recent runs"
                  detail="Latest prompts and outcomes"
                />
                <div className="mt-3 divide-y divide-[var(--border-subtle)]">
                  {recentRuns.length === 0 ? (
                    <EmptyLine label="No runs yet." />
                  ) : (
                    recentRuns.map((run) => (
                      <div key={run._id} className="flex gap-3 py-3">
                        <Clock3
                          size={15}
                          className="mt-0.5 shrink-0 text-[var(--text-tertiary)]"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                            {run.finalSummary?.trim() ||
                              run.userPrompt.slice(0, 120) ||
                              "Untitled run"}
                          </p>
                          <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                            {run.status}
                            {run.decision ? ` · ${run.decision}` : ""}
                            {" · "}
                            {formatRelative(run.updatedAt)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          </>
        )}

        <section className="mt-8 border-t border-[var(--border-subtle)] pt-5">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            What stays private
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
            Prompt text, thread transcripts, memory claims, and unrelated
            artifacts are excluded from school and platform analytics. This page
            only summarizes your own accessible work.
          </p>
        </section>
      </div>
    </div>
  );
}

function SectionHeading({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">
        {title}
      </h2>
      <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">{detail}</p>
    </div>
  );
}

function EmptyLine({ label }: { label: string }) {
  return (
    <p className="py-4 text-[13px] text-[var(--text-tertiary)]">{label}</p>
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
    <div className="border border-[var(--border-default)] px-5 py-4">
      <div className="flex items-center gap-2 text-[var(--text-secondary)]">
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-[0.12em]">
          {label}
        </span>
      </div>
      <p className="mt-3 font-display text-3xl tabular-nums text-[var(--text-primary)]">
        {valueLabel ?? (value === undefined ? "—" : String(value))}
      </p>
    </div>
  );
}

function formatRelative(timestamp: number) {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "Just now";
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)} min ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)} hr ago`;
  return `${Math.round(delta / 86_400_000)} d ago`;
}
