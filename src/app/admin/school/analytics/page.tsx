"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";

type AnalyticsData = {
  messagesPerDay: Array<{ day: string; count: number }>;
  modeUsage: Array<{ mode: string; count: number }>;
  avgQuizScore?: number;
  totalQuizAttempts: number;
};

const MODE_COLORS: Record<string, string> = {
  tutor: "var(--mode-tutor)",
  marker: "var(--mode-marker)",
  exam: "var(--mode-exam)",
  draft_coach: "var(--mode-draft_coach)",
  quiz: "var(--mode-quiz)",
  flashcard: "var(--mode-flashcard)",
  research: "var(--mode-research)",
  explain: "var(--mode-explain)",
  general: "var(--mode-general)",
  image: "var(--mode-image)",
};

function prettyMode(mode: string) {
  return mode.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDay(day: string) {
  const [, month, d] = day.split("-");
  if (!month || !d) return day;
  const months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(month, 10)]} ${parseInt(d, 10)}`;
}

// ---- Bar Chart Component ----
type BarChartProps = {
  data: Array<{ label: string; value: number; color?: string }>;
  maxValue: number;
  height?: number;
};

function BarChart({ data, maxValue, height = 200 }: BarChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <p className="text-sm text-[var(--text-secondary)]">No data available.</p>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((item) => {
        const pct = maxValue > 0 ? Math.max(2, (item.value / maxValue) * 100) : 2;
        return (
          <div key={item.label} className="group relative flex flex-1 flex-col items-center justify-end gap-1">
            {/* Tooltip */}
            <div className="pointer-events-none absolute -top-10 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] opacity-0 shadow-[var(--shadow-card)] transition group-hover:opacity-100">
              {item.value.toLocaleString()}
            </div>
            <div
              className="w-full min-h-[4px] rounded-t-lg transition-all"
              style={{
                height: `${pct}%`,
                background: item.color ?? "var(--accent-cyan)",
                opacity: 0.85,
              }}
            />
            {data.length <= 14 && (
              <span className="w-full truncate text-center text-[10px] text-[var(--text-secondary)]">
                {item.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- Donut Chart Component ----
type DonutSlice = { label: string; count: number; color: string };

function DonutChart({ slices }: { slices: DonutSlice[] }) {
  const total = slices.reduce((s, x) => s + x.count, 0);
  if (total === 0) {
    return (
      <div className="flex items-center justify-center py-10">
        <p className="text-sm text-[var(--text-secondary)]">No data available.</p>
      </div>
    );
  }

  const radius = 70;
  const cx = 90;
  const cy = 90;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const segments = slices.map((slice) => {
    const pct = slice.count / total;
    const dash = pct * circumference;
    const gap = circumference - dash;
    const seg = { ...slice, dash, gap, offset, pct };
    offset += dash;
    return seg;
  });

  return (
    <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-start">
      <svg viewBox="0 0 180 180" className="h-44 w-44 shrink-0 -rotate-90">
        {segments.map((seg) => (
          <circle
            key={seg.label}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth="32"
            strokeDasharray={`${seg.dash} ${seg.gap}`}
            strokeDashoffset={-seg.offset}
          />
        ))}
        {/* Center hole */}
        <circle cx={cx} cy={cy} r="54" fill="var(--bg-elevated)" />
      </svg>
      <div className="w-full space-y-2.5">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-3">
            <div className="h-3 w-3 shrink-0 rounded-full" style={{ background: seg.color }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-[var(--text-primary)]">{prettyMode(seg.label)}</span>
                <span className="shrink-0 text-xs font-medium text-[var(--text-secondary)]">
                  {seg.count.toLocaleString()} ({Math.round(seg.pct * 100)}%)
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${seg.pct * 100}%`, background: seg.color }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Quiz Score Trend (mini line chart via SVG) ----
function QuizScoreTrend({ score, attempts }: { score?: number; attempts: number }) {
  const pct = score !== undefined ? Math.round(score * 100) : undefined;

  return (
    <div className="flex flex-col items-center justify-center gap-2 py-4">
      <div
        className="relative flex h-32 w-32 items-center justify-center rounded-full"
        style={{
          background: `conic-gradient(var(--success) ${pct ?? 0}%, var(--bg-secondary) 0%)`,
        }}
      >
        <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-[var(--bg-elevated)]">
          <span className="font-display text-2xl text-[var(--text-primary)]">
            {pct !== undefined ? `${pct}%` : "—"}
          </span>
          <span className="text-[10px] text-[var(--text-secondary)]">avg score</span>
        </div>
      </div>
      <p className="text-sm text-[var(--text-secondary)]">
        {attempts.toLocaleString()} quiz attempt{attempts !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

// ---- Days Filter ----
const DAY_OPTIONS = [7, 14, 30, 60, 90];

export default function SchoolAnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/school-admin/analytics?days=${days}`);
        if (!response.ok) throw new Error(await response.text());
        const result = (await response.json()) as AnalyticsData;
        setData(result);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load analytics");
      } finally {
        setLoading(false);
      }
    })();
  }, [days]);

  const messagesMax = data ? Math.max(...data.messagesPerDay.map((d) => d.count), 1) : 1;

  const modeSlices: DonutSlice[] = (data?.modeUsage ?? []).map((m) => ({
    label: m.mode,
    count: m.count,
    color: MODE_COLORS[m.mode] ?? "var(--text-secondary)",
  }));

  const barData = (data?.messagesPerDay ?? []).map((d) => ({
    label: formatDay(d.day),
    value: d.count,
    color: "var(--accent-cyan)",
  }));

  return (
    <AppShell fullBleed contentClassName="2xl:px-14">
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Link href="/admin/school" className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition">
                <ChevronLeft className="h-3 w-3" /> School Admin
              </Link>
              <span className="text-xs text-[var(--text-secondary)]">/</span>
              <span className="text-xs text-[var(--text-primary)]">Analytics</span>
            </div>
            <h1 className="font-display text-3xl text-[var(--text-primary)]">School Analytics</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Engagement, usage patterns and quiz performance across your school.
            </p>
          </div>
          {/* Days filter */}
          <div className="flex items-center gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm transition ${
                  days === d
                    ? "bg-[var(--bg-primary)] font-semibold text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Messages Over Time — Full Width */}
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-card)]">
          <div className="mb-6 flex items-baseline justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Messages Over Time</h2>
              <p className="mt-0.5 text-sm text-[var(--text-secondary)]">Daily message volume across all students</p>
            </div>
            {data && (
              <span className="text-sm font-medium text-[var(--text-secondary)]">
                Total: {data.messagesPerDay.reduce((s, d) => s + d.count, 0).toLocaleString()}
              </span>
            )}
          </div>
          {loading ? (
            <div className="flex h-[200px] items-center justify-center text-sm text-[var(--text-secondary)]">
              Loading...
            </div>
          ) : (
            <BarChart data={barData} maxValue={messagesMax} height={220} />
          )}
        </section>

        {/* Mode Usage + Quiz Score */}
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          {/* Mode Usage Donut */}
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-card)]">
            <h2 className="mb-1 text-base font-semibold text-[var(--text-primary)]">Mode Usage Breakdown</h2>
            <p className="mb-6 text-sm text-[var(--text-secondary)]">Which AI modes students use most</p>
            {loading ? (
              <div className="flex h-48 items-center justify-center text-sm text-[var(--text-secondary)]">
                Loading...
              </div>
            ) : (
              <DonutChart slices={modeSlices} />
            )}
          </section>

          {/* Quiz Score */}
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-card)]">
            <h2 className="mb-1 text-base font-semibold text-[var(--text-primary)]">Quiz Performance</h2>
            <p className="mb-6 text-sm text-[var(--text-secondary)]">Average quiz score across all attempts</p>
            {loading ? (
              <div className="flex h-48 items-center justify-center text-sm text-[var(--text-secondary)]">
                Loading...
              </div>
            ) : (
              <QuizScoreTrend
                score={data?.avgQuizScore}
                attempts={data?.totalQuizAttempts ?? 0}
              />
            )}
          </section>
        </div>

        {/* Student Engagement Heatmap (day x hour grid placeholder) */}
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-card)]">
          <h2 className="mb-1 text-base font-semibold text-[var(--text-primary)]">Engagement Heatmap</h2>
          <p className="mb-6 text-sm text-[var(--text-secondary)]">Activity by day of week and hour (sample visualisation)</p>
          <HeatmapPlaceholder />
        </section>
      </div>
    </AppShell>
  );
}

// ---- Heatmap Placeholder ----
function HeatmapPlaceholder() {
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const HOURS = Array.from({ length: 24 }, (_, i) => i);

  // Simulate some data for visual purposes
  const activity: Record<string, number> = {};
  for (const day of DAYS) {
    for (const h of HOURS) {
      // Higher activity on weekday mornings/afternoons
      const isWeekday = !["Sat", "Sun"].includes(day);
      const isPrime = h >= 9 && h <= 16;
      const raw = isWeekday && isPrime
        ? Math.random() * 0.8 + 0.2
        : Math.random() * 0.25;
      activity[`${day}-${h}`] = raw;
    }
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        {/* Hour labels */}
        <div className="mb-1 ml-10 flex">
          {HOURS.filter((h) => h % 3 === 0).map((h) => (
            <div
              key={h}
              className="text-center text-[10px] text-[var(--text-secondary)]"
              style={{ width: `${100 / 8}%` }}
            >
              {h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`}
            </div>
          ))}
        </div>

        {DAYS.map((day) => (
          <div key={day} className="mb-1 flex items-center gap-2">
            <span className="w-8 shrink-0 text-right text-[11px] font-medium text-[var(--text-secondary)]">
              {day}
            </span>
            <div className="flex flex-1 gap-0.5">
              {HOURS.map((h) => {
                const val = activity[`${day}-${h}`] ?? 0;
                return (
                  <div
                    key={h}
                    className="flex-1 rounded-sm"
                    style={{
                      height: 20,
                      background: `color-mix(in oklab, var(--accent-cyan) ${Math.round(val * 90)}%, var(--bg-secondary))`,
                    }}
                    title={`${day} ${h}:00 — ${Math.round(val * 100)}% activity`}
                  />
                );
              })}
            </div>
          </div>
        ))}

        {/* Legend */}
        <div className="mt-3 ml-10 flex items-center gap-2">
          <span className="text-[10px] text-[var(--text-secondary)]">Less</span>
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => (
            <div
              key={v}
              className="h-3.5 w-5 rounded-sm"
              style={{
                background: `color-mix(in oklab, var(--accent-cyan) ${Math.round(v * 90)}%, var(--bg-secondary))`,
              }}
            />
          ))}
          <span className="text-[10px] text-[var(--text-secondary)]">More</span>
        </div>
      </div>
    </div>
  );
}
