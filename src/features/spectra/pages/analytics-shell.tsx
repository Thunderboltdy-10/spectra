"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BarCommand, CollapseStep } from "@/components/ui/adaptive-bar";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import {
  AdminSectionHeader,
  ErrorPanel,
  formatBytes,
  formatCompact,
  formatRelative,
  LoadingPanel,
  MetricCard,
  PrivacyNotice,
  TallySheet,
} from "@/features/spectra/administration/shared";
import { metricDefinition } from "@/features/spectra/administration/metric-registry";
import { workTypeMeta } from "@/features/spectra/components/artifact-card";
import type { CapabilityState } from "@/features/spectra/core/capability-truth";

type MetricReading = { value: number | null; state: CapabilityState };
type DayCount = { day: string; work: number; runs: number };
type AnalyticsPayload = {
  range: { from: number; to: number; fromDay: string; toDay: string };
  computedAt: number;
  privacy: string;
  metrics: {
    workCreated: MetricReading;
    activeWorkspaces: MetricReading;
    aiRuns: MetricReading;
    completionRate: MetricReading;
    modelTokens: MetricReading;
    collaborationBytes: MetricReading;
  };
  byType: Array<{ key: string; value: number }>;
  series?: DayCount[];
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
type Window = (typeof WINDOWS)[number];
const RANGE_OPTIONS = WINDOWS.map((value) => ({
  value: String(value) as `${Window}`,
  label: `${value} days`,
}));
const BAR_PLAN: readonly CollapseStep[] = [{ toMenu: "refresh" }];
const RANGE_WORDS: Record<Window, string> = {
  7: "this week",
  30: "this month",
  90: "these three months",
};
const RUN_WORDS: Record<string, string> = {
  completed: "Finished",
  queued: "Waiting to start",
  running: "Still going",
  awaiting_confirmation: "Waiting on you",
  awaiting_resolution: "Waiting on you",
  failed: "Didn't finish",
  cancelled: "Stopped",
};
const CHART_KINDS = [
  { key: "work", label: "Artifacts made", one: "artifact", many: "artifacts" },
  { key: "runs", label: "Asked Spectra", one: "request", many: "requests" },
] as const;

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

function typeOf(key: string) {
  const meta = workTypeMeta[key as keyof typeof workTypeMeta];
  return {
    label: meta?.label ?? key.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase()),
    color: meta?.color ?? "var(--text-tertiary)",
  };
}

/** A request is named by what Spectra said it did, which may carry markdown or say little. */
function requestTitle(title: string) {
  const plain = title.replace(/[*_`#]+/g, "").trim();
  return !plain || /^(done|ok|okay)\.?$/i.test(plain) ? "A short request" : plain;
}

function counted(count: number, one: string, many: string) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** The range said once, in words: what the numbers below add up to. */
function leadLine(payload: AnalyticsPayload, days: Window) {
  const work = payload.metrics.workCreated.value;
  const runs = payload.metrics.aiRuns.value;
  const when = RANGE_WORDS[days];
  if (work === null && runs === null) return `Your counts for ${when} are still being prepared.`;
  if (!work && !runs) return `Nothing new ${when} yet.`;
  if (work && runs)
    return `You made ${counted(work, "artifact", "artifacts")} and asked Spectra ${counted(runs, "time", "times")} ${when}.`;
  if (work) return `You made ${counted(work, "artifact", "artifacts")} ${when}.`;
  return `You asked Spectra ${counted(runs ?? 0, "time", "times")} ${when}.`;
}

export function AnalyticsShell() {
  const [days, setDays] = useState<Window>(30);
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

  const commands: BarCommand[] = [
    {
      id: "range",
      icon: "calendar",
      label: "Range",
      pinned: true,
      render: () => (
        <Segmented
          label="Range"
          size="compact"
          value={String(days) as `${Window}`}
          options={RANGE_OPTIONS}
          onChange={(next) => setDays(Number(next) as Window)}
        />
      ),
    },
    {
      id: "refresh",
      icon: "retry",
      label: loading ? "Refreshing…" : "Refresh analytics",
      labelPolicy: "never",
      disabled: loading,
      onSelect: () => void refresh(),
    },
  ];

  return (
    <main className="spectra-wave-y relative isolate h-full min-h-0 flex-1 overflow-y-auto" data-spectra-app-surface="true">
      <PageBody>
        <PageHeader title="Analytics" commands={commands} plan={BAR_PLAN} barLabel="Analytics commands" />
        <div className="admin-page mt-6">
          {error && !payload ? (
            <ErrorPanel message={error} retry={() => void refresh()} />
          ) : payload ? (
            <AnalyticsBody payload={payload} days={days} />
          ) : (
            <LoadingPanel label="Loading your analytics" />
          )}
        </div>
      </PageBody>
    </main>
  );
}

function AnalyticsBody({ payload, days }: { payload: AnalyticsPayload; days: Window }) {
  const { metrics, runOutcomes } = payload;
  const workTotal = payload.byType.reduce((sum, row) => sum + row.value, 0);
  const outcomes = [
    { key: "completed", label: "Finished", value: runOutcomes.completed, color: "var(--success)" },
    { key: "active", label: "Still going", value: runOutcomes.active, color: "var(--accent-cyan)" },
    { key: "failed", label: "Didn't finish", value: runOutcomes.failed, color: "var(--warning)" },
    { key: "cancelled", label: "Stopped", value: runOutcomes.cancelled, color: "var(--text-tertiary)" },
  ];
  const runTotal = outcomes.reduce((sum, row) => sum + row.value, 0);
  return (
    <>
      <p className="analytics-lead">{leadLine(payload, days)}</p>

      <TallySheet>
        <MetricCard
          label="Artifacts made"
          value={formatCompact(metrics.workCreated.value)}
          detail="New in this range"
          state={metrics.workCreated.state}
          source={metricDefinition("account.work_created").source}
        />
        <MetricCard
          label="Workspaces in use"
          value={formatCompact(metrics.activeWorkspaces.value)}
          detail="Something changed in them"
          state={metrics.activeWorkspaces.state}
          source={metricDefinition("account.active_workspaces").source}
        />
        <MetricCard
          label="Asked Spectra"
          value={formatCompact(metrics.aiRuns.value)}
          detail="Every request, however it ended"
          state={metrics.aiRuns.state}
          source={metricDefinition("account.ai_runs").source}
        />
        <MetricCard
          label="Finished"
          value={metrics.completionRate.value === null ? formatCompact(null) : `${metrics.completionRate.value}%`}
          detail="Of the requests that ended"
          state={metrics.completionRate.state}
          source={metricDefinition("account.ai_completion_rate").source}
        />
        <MetricCard
          label="AI use"
          value={formatCompact(metrics.modelTokens.value)}
          detail="Tokens read and written"
          state={metrics.modelTokens.state}
          source={metricDefinition("account.model_tokens").source}
        />
        <MetricCard
          label="Live editing"
          value={formatBytes(metrics.collaborationBytes.value)}
          detail="Changes sent while editing"
          state={metrics.collaborationBytes.state}
          source={metricDefinition("account.collaboration_bytes").source}
        />
      </TallySheet>

      <section>
        <AdminSectionHeader title="Day by day" />
        <DayChart series={payload.series ?? []} fromDay={payload.range.fromDay} toDay={payload.range.toDay} />
      </section>

      <div className="admin-columns">
        <section>
          <AdminSectionHeader title="What you made" count={workTotal || undefined} />
          {workTotal ? (
            <>
              <div className="analytics-mix" aria-hidden>
                {payload.byType.map((row) => (
                  <span
                    key={row.key}
                    style={{ flexGrow: row.value, "--mix-color": typeOf(row.key).color } as React.CSSProperties}
                  />
                ))}
              </div>
              <dl className="admin-facts">
                {payload.byType.map((row) => (
                  <div key={row.key}>
                    <dt className="analytics-row-label">
                      <i style={{ "--mix-color": typeOf(row.key).color } as React.CSSProperties} aria-hidden />
                      {typeOf(row.key).label}
                    </dt>
                    <dd>{row.value.toLocaleString()}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className="admin-ledger-empty">
              {metrics.workCreated.value === null ? "Your artifact history is still being prepared." : "No new artifacts in this range."}
            </p>
          )}
        </section>

        <section>
          <AdminSectionHeader title="How your requests ended" count={runTotal || undefined} />
          {runTotal ? (
            <>
              <div className="analytics-mix" aria-hidden>
                {outcomes.filter((row) => row.value > 0).map((row) => (
                  <span key={row.key} style={{ flexGrow: row.value, "--mix-color": row.color } as React.CSSProperties} />
                ))}
              </div>
              <dl className="admin-facts">
                {outcomes.map((row) => (
                  <div key={row.key}>
                    <dt className="analytics-row-label">
                      <i style={{ "--mix-color": row.color } as React.CSSProperties} aria-hidden />
                      {row.label}
                    </dt>
                    <dd>{row.value.toLocaleString()}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className="admin-ledger-empty">
              {metrics.aiRuns.value === null ? "Your request history is still being prepared." : "You didn't ask Spectra anything in this range."}
            </p>
          )}
        </section>
      </div>

      <div className="admin-columns">
        <section>
          <AdminSectionHeader title="Latest artifact" />
          {payload.recentWork.length ? (
            <ul className="admin-ledger">
              {payload.recentWork.map((item) => (
                <li key={item.id}>
                  <Link className="admin-line" href={`/library?artifactId=${encodeURIComponent(item.id)}`}>
                    <span className="admin-line-main">
                      <strong>{item.title}</strong>
                      <span>{typeOf(item.blueprintKey).label}</span>
                    </span>
                    <span className="admin-line-meta">{formatRelative(item.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-ledger-empty">Nothing new in this range.</p>
          )}
        </section>

        <section>
          <AdminSectionHeader title="Latest requests" />
          {payload.recentRuns.length ? (
            <ul className="admin-ledger">
              {payload.recentRuns.map((item) => (
                <li key={item.id} className="admin-line">
                  <span className="admin-line-main">
                    <strong>{requestTitle(item.title)}</strong>
                    <span>{RUN_WORDS[item.status] ?? item.status.replaceAll("_", " ")}</span>
                  </span>
                  <span className="admin-line-meta">{formatRelative(item.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-ledger-empty">No requests in this range.</p>
          )}
        </section>
      </div>

      <PrivacyNotice>
        Only you see this page. It counts titles, types and dates; what you wrote and what you asked Spectra are not read to make it.
      </PrivacyNotice>
    </>
  );
}

const chartDay = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
const dayWords = (day: string) => chartDay.format(new Date(`${day}T00:00:00Z`));

function DayChart({ series, fromDay, toDay }: { series: DayCount[]; fromDay: string; toDay: string }) {
  const [kindKey, setKindKey] = useState<(typeof CHART_KINDS)[number]["key"]>("work");
  const kind = CHART_KINDS.find((item) => item.key === kindKey) ?? CHART_KINDS[0];
  const days = useMemo(() => {
    const byDay = new Map(series.map((row) => [row.day, row]));
    const out: DayCount[] = [];
    const last = Date.parse(`${toDay}T00:00:00Z`);
    for (let at = Date.parse(`${fromDay}T00:00:00Z`); at <= last; at += 86_400_000) {
      const day = new Date(at).toISOString().slice(0, 10);
      out.push(byDay.get(day) ?? { day, work: 0, runs: 0 });
    }
    return out;
  }, [fromDay, series, toDay]);
  const values = days.map((row) => row[kind.key]);
  const most = Math.max(0, ...values);
  // Rounded up to even, so the middle line of the scale is a whole count too.
  const peak = most > 1 && most % 2 ? most + 1 : most;
  return (
    <>
      <div className="admin-chart-choice" role="group" aria-label="What the chart shows">
        {CHART_KINDS.map((item) => (
          <button key={item.key} type="button" aria-pressed={item.key === kindKey} onClick={() => setKindKey(item.key)}>
            {item.label}
          </button>
        ))}
      </div>
      <figure className="admin-chart" aria-label={`${kind.label} each day`}>
        <div className="admin-chart-scale" aria-hidden>
          <span>{peak ? peak.toLocaleString() : ""}</span>
          <span>{peak > 1 ? (peak / 2).toLocaleString() : ""}</span>
          <span>0</span>
        </div>
        {peak ? (
          <div className="admin-chart-bars analytics-chart-bars" data-few={days.length <= 14 ? "" : undefined}>
            {days.map((row, index) => {
              const label = `${dayWords(row.day)}: ${counted(values[index], kind.one, kind.many)}`;
              return (
                <span
                  key={row.day}
                  className="admin-chart-bar"
                  tabIndex={0}
                  role="img"
                  aria-label={label}
                  title={label}
                  style={{ height: `${(values[index] / peak) * 100}%` }}
                />
              );
            })}
          </div>
        ) : (
          <p className="analytics-chart-empty">Nothing on any day in this range.</p>
        )}
        <div className="admin-chart-days" aria-hidden>
          <span>{dayWords(days[0]?.day ?? fromDay)}</span>
          <span>{dayWords(days[days.length - 1]?.day ?? toDay)}</span>
        </div>
      </figure>
    </>
  );
}
