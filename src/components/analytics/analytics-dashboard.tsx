"use client";

import { useMemo } from "react";
import { Activity, BookOpen, Brain, Clock3, MessageSquare, Trophy, Users } from "lucide-react";
import { MODE_REGISTRY } from "@/lib/modes";
import type { StudyMode } from "@/types";
import { StatsCard } from "@/components/analytics/stats-card";
import { ActivityChart } from "@/components/analytics/activity-chart";
import { TopicCloud } from "@/components/analytics/topic-cloud";
import { ModeBreakdown } from "@/components/analytics/mode-breakdown";
import { TimeOfDayChart } from "@/components/analytics/time-of-day-chart";

type AnalyticsRow = {
  day: string;
  sessionsCount: number;
  messagesCount: number;
  topicsExplored: string[];
  modesUsed: string[];
  modelsUsed: string[];
  quizScores: number[];
  totalTokensUsed: number;
};

type EnhancedAnalytics = {
  timeSpentDaily: Array<{
    day: string;
    timerSeconds: number;
    estimatedSeconds: number;
    totalSeconds: number;
    messages: number;
  }>;
  modeMessageCounts: Record<string, number>;
  quizTrend: Array<{
    day: string;
    attempts: number;
    averageScore: number;
  }>;
  productivity: {
    totalStudySeconds: number;
    estimatedSessions: number;
    messagesPerSession: number;
    topicDepth: number;
    activeDays: number;
  };
};

type AnalyticsDashboardProps = {
  role: "student" | "teacher" | "admin";
  studentData: AnalyticsRow[];
  studentSignals: {
    hourlyPromptCounts: number[];
    dailyPromptCounts: Array<{ day: string; count: number }>;
    dailyPeakHours: Array<{ day: string; hour: number; count: number }>;
    preferredModel?: string;
    preferredModelCount: number;
  };
  enhanced: EnhancedAnalytics;
  classData: AnalyticsRow[];
};

function formatHour(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const normalized = hour % 12 === 0 ? 12 : hour % 12;
  return `${normalized} ${suffix}`;
}

function shortDayLabel(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDurationFromSeconds(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0m";
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function formatModelName(modelId?: string) {
  if (!modelId) return "-";
  const raw = modelId.split("/").pop() ?? modelId;
  return raw
    .replace(/:free$/i, "")
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((word) => {
      if (/^\d+(\.\d+)?$/.test(word)) return word;
      if (/^(gpt|o3|o4|r1|claude|gemini)$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function aggregateRows(rows: AnalyticsRow[]) {
  let totalSessions = 0;
  let totalMessages = 0;
  let totalTokens = 0;
  const allTopics: string[] = [];
  const modeCounts: Record<string, number> = {};
  const allScores: number[] = [];

  for (const row of rows) {
    totalSessions += row.sessionsCount;
    totalMessages += row.messagesCount;
    totalTokens += row.totalTokensUsed;
    allTopics.push(...row.topicsExplored);
    for (const mode of row.modesUsed) modeCounts[mode] = (modeCounts[mode] ?? 0) + 1;
    allScores.push(...row.quizScores);
  }

  const avgScore = allScores.length > 0
    ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
    : null;

  const uniqueTopicCount = new Set(
    allTopics.map((topic) => topic.trim().toLowerCase()).filter((topic) => topic.length > 0),
  ).size;

  return {
    totalSessions,
    totalMessages,
    totalTokens,
    topics: allTopics,
    uniqueTopicCount,
    modeCounts,
    avgScore,
    daysActive: rows.length,
  };
}

function buildDailyActivity(rows: AnalyticsRow[]) {
  const now = new Date();
  const days: { day: string; count: number }[] = [];
  const map = new Map<string, number>();

  for (const row of rows) {
    map.set(row.day, (map.get(row.day) ?? 0) + row.messagesCount);
  }

  for (let i = 13; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const key = date.toISOString().slice(0, 10);
    days.push({ day: key, count: map.get(key) ?? 0 });
  }
  return days;
}

function buildDailyStudyTime(daily: EnhancedAnalytics["timeSpentDaily"]) {
  const now = new Date();
  const byDay = new Map(daily.map((item) => [item.day, item]));

  const series: Array<{
    day: string;
    totalSeconds: number;
    timerSeconds: number;
    estimatedSeconds: number;
    messages: number;
  }> = [];

  for (let i = 13; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const key = date.toISOString().slice(0, 10);
    const row = byDay.get(key);
    series.push({
      day: key,
      totalSeconds: row?.totalSeconds ?? 0,
      timerSeconds: row?.timerSeconds ?? 0,
      estimatedSeconds: row?.estimatedSeconds ?? 0,
      messages: row?.messages ?? 0,
    });
  }

  return series;
}

function calculateStreak(rows: AnalyticsRow[]) {
  const days = new Set(rows.map((row) => row.day));
  let streak = 0;
  const now = new Date();
  const current = new Date(now.toISOString().slice(0, 10));
  const todayKey = current.toISOString().slice(0, 10);
  if (!days.has(todayKey)) {
    current.setDate(current.getDate() - 1);
  }

  for (let i = 0; i < 365; i += 1) {
    const key = current.toISOString().slice(0, 10);
    if (days.has(key)) {
      streak += 1;
      current.setDate(current.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function StudyTimeChart({
  data,
}: {
  data: Array<{
    day: string;
    totalSeconds: number;
    timerSeconds: number;
    estimatedSeconds: number;
    messages: number;
  }>;
}) {
  const maxSeconds = Math.max(...data.map((item) => item.totalSeconds), 1);
  const totalSeconds = data.reduce((sum, item) => sum + item.totalSeconds, 0);
  const trackedSeconds = data.reduce((sum, item) => sum + item.timerSeconds, 0);

  return (
    <div className="journal-card journal-scribble p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Time spent per day</p>
        <p className="text-xs text-[var(--text-secondary)]">
          {formatDurationFromSeconds(totalSeconds)} total
          {trackedSeconds > 0 ? ` • ${formatDurationFromSeconds(trackedSeconds)} timer-logged` : ""}
        </p>
      </div>

      <div className="grid grid-cols-14 gap-1.5">
        {data.map((item, index) => {
          const height = Math.max(8, Math.round((item.totalSeconds / maxSeconds) * 86));
          return (
            <div key={item.day} className="group flex min-w-0 flex-col items-center gap-1">
              <div className="relative flex h-24 w-full items-end">
                <div
                  className="w-full rounded-md bg-[var(--accent-cyan)]/85 transition-all duration-200 group-hover:bg-[var(--accent-cyan)]"
                  style={{ height }}
                />
                <div className="pointer-events-none absolute -top-10 left-1/2 w-max -translate-x-1/2 rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] opacity-0 transition group-hover:opacity-100">
                  {formatDurationFromSeconds(item.totalSeconds)}
                </div>
              </div>
              <span className="text-[9px] text-[var(--text-secondary)]">
                {index % 2 === 0 ? shortDayLabel(item.day) : " "}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ModePieChart({ modeCounts }: { modeCounts: Record<string, number> }) {
  const entries = Object.entries(modeCounts)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a);

  if (entries.length === 0) {
    return (
      <div className="journal-card border-dashed p-4 text-center text-sm text-[var(--text-secondary)]">
        No mode usage data yet
      </div>
    );
  }

  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const segments = entries.map(([mode, count], index) => {
    const share = total > 0 ? (count / total) * 100 : 0;
    const start = entries
      .slice(0, index)
      .reduce((sum, [, previousCount]) => sum + ((total > 0 ? previousCount / total : 0) * 100), 0);
    const config = MODE_REGISTRY[mode as StudyMode];
    return {
      mode,
      count,
      share,
      start,
      end: start + share,
      label: config?.label ?? mode,
      color: config?.color ?? ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"][index % 5],
    };
  });

  const gradient = `conic-gradient(${segments
    .map((segment) => `${segment.color} ${segment.start}% ${segment.end}%`)
    .join(",")})`;

  return (
    <div className="journal-card journal-scribble p-4">
      <p className="mb-3 text-xs uppercase tracking-wide text-[var(--text-secondary)]">Messages per mode</p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative mx-auto h-36 w-36 shrink-0">
          <div className="h-full w-full rounded-full" style={{ background: gradient }} />
          <div className="absolute inset-[18%] flex flex-col items-center justify-center rounded-full bg-[var(--bg-elevated)] text-center">
            <p className="text-xl font-semibold">{total}</p>
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">Messages</p>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          {segments.slice(0, 6).map((segment) => (
            <div key={segment.mode} className="flex items-center justify-between gap-2 text-xs">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
                <span className="truncate">{segment.label}</span>
              </span>
              <span className="text-[var(--text-secondary)]">{Math.round(segment.share)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuizTrendChart({ trend }: { trend: EnhancedAnalytics["quizTrend"] }) {
  if (trend.length === 0) {
    return (
      <div className="journal-card border-dashed p-4 text-center text-sm text-[var(--text-secondary)]">
        No quiz trend data yet
      </div>
    );
  }

  const points = trend.map((item, index) => {
    const x = trend.length === 1 ? 50 : (index / (trend.length - 1)) * 100;
    const y = 100 - Math.max(0, Math.min(100, item.averageScore));
    return { x, y, ...item };
  });
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const latest = trend[trend.length - 1];

  return (
    <div className="journal-card journal-scribble p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Quiz performance trend</p>
        <p className="text-xs text-[var(--text-secondary)]">
          Latest: {latest?.averageScore ?? 0}% ({latest?.attempts ?? 0} attempt{(latest?.attempts ?? 0) === 1 ? "" : "s"})
        </p>
      </div>

      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
        <svg viewBox="0 0 100 100" className="h-40 w-full" preserveAspectRatio="none" aria-label="Quiz score trend">
          <line x1="0" y1="100" x2="100" y2="100" stroke="var(--border-default)" strokeWidth="1" />
          <line x1="0" y1="0" x2="0" y2="100" stroke="var(--border-default)" strokeWidth="1" />
          <polyline
            points={polyline}
            fill="none"
            stroke="var(--accent-cyan)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {points.map((point) => (
            <circle key={`${point.day}-${point.x}`} cx={point.x} cy={point.y} r="1.7" fill="var(--accent-cyan)" />
          ))}
        </svg>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-4">
        {trend.slice(-4).map((item) => (
          <div key={item.day} className="rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1.5">
            <p>{shortDayLabel(item.day)}</p>
            <p className="font-medium text-[var(--text-primary)]">{item.averageScore}%</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductivityInsights({
  productivity,
}: {
  productivity: EnhancedAnalytics["productivity"];
}) {
  const avgStudyPerDay = productivity.activeDays > 0
    ? productivity.totalStudySeconds / productivity.activeDays
    : 0;

  const insight = productivity.messagesPerSession >= 8
    ? "High message throughput suggests deep iteration during each study block."
    : productivity.messagesPerSession >= 4
      ? "Steady interaction pace. Consider one longer focused block for harder topics."
      : "Short sessions dominate. Try running one full Pomodoro for deeper retention.";

  return (
    <div className="journal-card p-4">
      <p className="mb-3 text-xs uppercase tracking-wide text-[var(--text-secondary)]">Productivity insights</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">Messages / session</p>
          <p className="mt-1 text-lg font-semibold">{productivity.messagesPerSession}</p>
        </div>
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">Topic depth</p>
          <p className="mt-1 text-lg font-semibold">{productivity.topicDepth}</p>
        </div>
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">Estimated sessions</p>
          <p className="mt-1 text-lg font-semibold">{productivity.estimatedSessions}</p>
        </div>
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">Avg study / active day</p>
          <p className="mt-1 text-lg font-semibold">{formatDurationFromSeconds(avgStudyPerDay)}</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-[var(--text-secondary)]">{insight}</p>
    </div>
  );
}

export function AnalyticsDashboard({ role, studentData, studentSignals, enhanced, classData }: AnalyticsDashboardProps) {
  const student = useMemo(() => aggregateRows(studentData), [studentData]);
  const classAgg = useMemo(() => aggregateRows(classData), [classData]);
  const dailyActivity = useMemo(() => buildDailyActivity(studentData), [studentData]);
  const classDailyActivity = useMemo(() => buildDailyActivity(classData), [classData]);
  const dailyStudyTime = useMemo(() => buildDailyStudyTime(enhanced.timeSpentDaily), [enhanced.timeSpentDaily]);
  const streak = useMemo(() => calculateStreak(studentData), [studentData]);
  const topHour = useMemo(() => {
    const counts = studentSignals.hourlyPromptCounts ?? [];
    if (counts.length === 0) return 0;
    let index = 0;
    let max = -1;
    for (let i = 0; i < counts.length; i += 1) {
      if ((counts[i] ?? 0) > max) {
        max = counts[i] ?? 0;
        index = i;
      }
    }
    return index;
  }, [studentSignals.hourlyPromptCounts]);
  const isTeacher = role === "admin" || role === "teacher";

  const uniqueStudents = useMemo(() => {
    const ids = new Set<string>();
    for (const row of classData) {
      if ("userId" in row) ids.add(String((row as AnalyticsRow & { userId?: string }).userId));
    }
    return ids.size;
  }, [classData]);

  const averageDailyStudyMinutes = enhanced.productivity.activeDays > 0
    ? Math.round((enhanced.productivity.totalStudySeconds / enhanced.productivity.activeDays) / 60)
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="journal-heading mb-3 text-xl font-semibold">Your Study Stats</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <StatsCard
            icon={Activity}
            label="Study streak"
            value={`${streak} day${streak !== 1 ? "s" : ""}`}
            color="#10b981"
          />
          <StatsCard
            icon={MessageSquare}
            label="Total messages"
            value={student.totalMessages}
            subtitle={`${student.totalSessions} sessions`}
            color="#3b82f6"
          />
          <StatsCard
            icon={BookOpen}
            label="Topics explored"
            value={student.uniqueTopicCount}
            color="#8b5cf6"
          />
          <StatsCard
            icon={Trophy}
            label="Avg quiz score"
            value={student.avgScore !== null ? `${student.avgScore}%` : "-"}
            subtitle={student.avgScore !== null ? "across all quizzes" : "No quizzes yet"}
            color="#f59e0b"
          />
          <StatsCard
            icon={Clock3}
            label="Avg study/day"
            value={`${averageDailyStudyMinutes}m`}
            subtitle="timers + message estimate"
            color="#0ea5e9"
          />
          <StatsCard
            icon={Brain}
            label="Preferred model"
            value={formatModelName(studentSignals.preferredModel)}
            subtitle={
              studentSignals.preferredModelCount > 0
                ? `${studentSignals.preferredModelCount} routed responses`
                : "No routed responses yet"
            }
            color="#ef4444"
          />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ActivityChart data={dailyActivity} label="Daily activity (14 days)" />
        <StudyTimeChart data={dailyStudyTime} />
        <TimeOfDayChart hourlyCounts={studentSignals.hourlyPromptCounts} dailyPeaks={studentSignals.dailyPeakHours} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ModePieChart modeCounts={enhanced.modeMessageCounts} />
        <QuizTrendChart trend={enhanced.quizTrend} />
      </div>

      <ProductivityInsights productivity={enhanced.productivity} />

      <TopicCloud topics={student.topics} />

      {isTeacher && classData.length > 0 && (
        <div className="mt-8">
          <h2 className="journal-heading mb-3 text-xl font-semibold">Class Overview</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              icon={Users}
              label="Active students"
              value={uniqueStudents || classAgg.daysActive}
              color="#6366f1"
            />
            <StatsCard
              icon={MessageSquare}
              label="Total messages"
              value={classAgg.totalMessages}
              subtitle={`${classAgg.totalSessions} sessions`}
              color="#3b82f6"
            />
            <StatsCard
              icon={Brain}
              label="Tokens used"
              value={classAgg.totalTokens.toLocaleString()}
              color="#ef4444"
            />
            <StatsCard
              icon={Trophy}
              label="Class avg quiz"
              value={classAgg.avgScore !== null ? `${classAgg.avgScore}%` : "-"}
              color="#f59e0b"
            />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <ActivityChart data={classDailyActivity} label="Class daily activity (14 days)" />
            <ModeBreakdown modeCounts={classAgg.modeCounts} />
          </div>
          <div className="mt-4">
            <TopicCloud topics={classAgg.topics} />
          </div>
        </div>
      )}

      <div className="journal-card p-3 text-xs text-[var(--text-secondary)]">
        Most active study window: <span className="font-medium text-[var(--text-primary)]">{formatHour(topHour)} UTC</span>
      </div>
    </div>
  );
}
