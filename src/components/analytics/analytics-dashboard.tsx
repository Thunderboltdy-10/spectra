"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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

type ModelLeaderboardEntry = {
  modelId: string;
  provider: string;
  name: string;
  totalTokens: number;
  usageCount: number;
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

const TOOLTIP_STYLE = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-default)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--text-primary)",
};

function shortDayLabel(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatHour(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const normalized = hour % 12 === 0 ? 12 : hour % 12;
  return `${normalized} ${suffix}`;
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

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function scoreLabel(entry: ModelLeaderboardEntry) {
  const averageTokens = entry.usageCount > 0 ? entry.totalTokens / entry.usageCount : 0;
  if (averageTokens >= 14_000 || entry.usageCount >= 14) return "High rigor";
  if (averageTokens >= 7_000 || entry.usageCount >= 7) return "Strong fit";
  return "Emerging";
}

function StatItem({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
}) {
  return (
    <div className="min-w-0 px-4 py-3 first:pl-0">
      <p className="text-xs text-[var(--text-secondary)]">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold text-[var(--text-primary)]">{value}</p>
      {subtitle ? <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{subtitle}</p> : null}
    </div>
  );
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
    uniqueTopicCount,
    modeCounts,
    avgScore,
    daysActive: rows.length,
  };
}

function buildDailyActivity(rows: AnalyticsRow[]) {
  const now = new Date();
  const map = new Map<string, number>();

  for (const row of rows) {
    map.set(row.day, (map.get(row.day) ?? 0) + row.messagesCount);
  }

  return Array.from({ length: 14 }, (_, offset) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (13 - offset));
    const key = date.toISOString().slice(0, 10);
    return { day: key, count: map.get(key) ?? 0 };
  });
}

function buildDailyStudyTime(daily: EnhancedAnalytics["timeSpentDaily"]) {
  const now = new Date();
  const byDay = new Map(daily.map((item) => [item.day, item]));

  return Array.from({ length: 14 }, (_, offset) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (13 - offset));
    const key = date.toISOString().slice(0, 10);
    const row = byDay.get(key);
    return {
      day: key,
      totalSeconds: row?.totalSeconds ?? 0,
      totalMinutes: Math.round((row?.totalSeconds ?? 0) / 60),
      messages: row?.messages ?? 0,
    };
  });
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

function ActivityAndTimeChart({
  activity,
  studyTime,
}: {
  activity: Array<{ day: string; count: number }>;
  studyTime: Array<{ day: string; totalMinutes: number }>;
}) {
  const chartData = activity.map((item, index) => ({
    day: shortDayLabel(item.day),
    messages: item.count,
    minutes: studyTime[index]?.totalMinutes ?? 0,
  }));
  const totalMessages = chartData.reduce((sum, item) => sum + item.messages, 0);
  const totalMinutes = chartData.reduce((sum, item) => sum + item.minutes, 0);

  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs text-[var(--text-secondary)]">Activity and study time</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Messages on the left axis, study minutes on the right.</p>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">{totalMessages} msgs • {totalMinutes} minutes</p>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border-default)" strokeOpacity={0.45} />
          <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--text-secondary)" }} tickLine={false} axisLine={false} />
          <YAxis yAxisId="messages" tick={{ fontSize: 10, fill: "var(--text-secondary)" }} tickLine={false} axisLine={false} width={34} />
          <YAxis yAxisId="minutes" orientation="right" tick={{ fontSize: 10, fill: "var(--text-secondary)" }} tickLine={false} axisLine={false} width={34} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Bar yAxisId="messages" dataKey="messages" fill="var(--accent-cyan)" radius={[4, 4, 0, 0]} maxBarSize={24} />
          <Line yAxisId="minutes" type="monotone" dataKey="minutes" stroke="var(--accent-coral)" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function QuizTrendChart({ trend }: { trend: EnhancedAnalytics["quizTrend"] }) {
  const compactTrend = trend.slice(-8);
  if (compactTrend.length === 0) {
    return <div className="p-4 text-center text-sm text-[var(--text-secondary)]">No quiz trend data yet</div>;
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-secondary)]">Quiz performance</p>
        <p className="text-xs text-[var(--text-secondary)]">{compactTrend[compactTrend.length - 1]?.averageScore ?? 0}% latest</p>
      </div>
      <ResponsiveContainer width="100%" height={128}>
        <ComposedChart data={compactTrend.map((item) => ({ day: shortDayLabel(item.day), score: item.averageScore, attempts: item.attempts }))}>
          <CartesianGrid vertical={false} stroke="var(--border-default)" strokeOpacity={0.45} />
          <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--text-secondary)" }} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "var(--text-secondary)" }} tickLine={false} axisLine={false} width={30} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Line type="monotone" dataKey="score" stroke="var(--mode-quiz)" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ModelLeaderboard() {
  const [entries, setEntries] = useState<ModelLeaderboardEntry[]>([]);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/analytics/model-leaderboard");
      if (!response.ok) return;
      const payload = (await response.json()) as { models?: ModelLeaderboardEntry[] };
      setEntries(payload.models ?? []);
    })();
  }, []);

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-secondary)]">Personal model leaderboard</p>
        <p className="text-xs text-[var(--text-secondary)]">{entries.length > 0 ? `Top ${Math.min(entries.length, 6)}` : "No usage yet"}</p>
      </div>
      <div className="space-y-2">
        {entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-default)] px-3 py-4 text-center text-sm text-[var(--text-secondary)]">
            No routed model usage yet.
          </div>
        ) : (
          entries.slice(0, 6).map((entry, index) => (
            <div key={entry.modelId} className="grid min-h-[44px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5">
              <span className="text-[11px] font-medium text-[var(--text-secondary)]">{index + 1}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--text-primary)]">{formatModelName(entry.name || entry.modelId)}</p>
                <p className="truncate text-[11px] text-[var(--text-secondary)]">{entry.usageCount} uses • {formatTokens(entry.totalTokens)} tokens</p>
              </div>
              <span className="text-[11px] text-[var(--text-secondary)]">{scoreLabel(entry)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ProductivityInsights({ productivity }: { productivity: EnhancedAnalytics["productivity"] }) {
  const avgStudyPerDay = productivity.activeDays > 0 ? productivity.totalStudySeconds / productivity.activeDays : 0;

  return (
    <div className="p-5">
      <p className="mb-3 text-xs text-[var(--text-secondary)]">Productivity insights</p>
      <div className="space-y-1">
        <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-[var(--border-default)] px-1 py-2 text-xs">
          <span className="text-[var(--text-secondary)]">Messages / session</span>
          <span className="font-semibold text-[var(--text-primary)]">{productivity.messagesPerSession}</span>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-[var(--border-default)] px-1 py-2 text-xs">
          <span className="text-[var(--text-secondary)]">Topic depth</span>
          <span className="font-semibold text-[var(--text-primary)]">{productivity.topicDepth}</span>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-[var(--border-default)] px-1 py-2 text-xs">
          <span className="text-[var(--text-secondary)]">Estimated sessions</span>
          <span className="font-semibold text-[var(--text-primary)]">{productivity.estimatedSessions}</span>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-3 px-1 py-2 text-xs">
          <span className="text-[var(--text-secondary)]">Avg study / active day</span>
          <span className="font-semibold text-[var(--text-primary)]">{formatDurationFromSeconds(avgStudyPerDay)}</span>
        </div>
      </div>
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
      <div data-tour="analytics-stats">
        <h2 className="mb-3 font-display text-xl">Your Study Stats</h2>
        <div className="flex flex-wrap divide-x divide-[var(--border-default)] border-t border-b border-[var(--border-default)]">
          <StatItem label="Study streak" value={`${streak} day${streak !== 1 ? "s" : ""}`} />
          <StatItem label="Total messages" value={student.totalMessages} subtitle={`${student.totalSessions} sessions`} />
          <StatItem label="Topics explored" value={student.uniqueTopicCount} />
          <StatItem label="Avg quiz score" value={student.avgScore !== null ? `${student.avgScore}%` : "-"} subtitle={student.avgScore !== null ? "across all quizzes" : "No quizzes yet"} />
          <StatItem label="Avg study/day" value={`${averageDailyStudyMinutes}m`} subtitle="timers + estimate" />
          <StatItem label="Preferred model" value={formatModelName(studentSignals.preferredModel)} subtitle={studentSignals.preferredModelCount > 0 ? `${studentSignals.preferredModelCount} routed responses` : "No routed responses yet"} />
        </div>
      </div>

      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] xl:col-span-2">
        <ActivityAndTimeChart activity={dailyActivity} studyTime={dailyStudyTime} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]">
          <QuizTrendChart trend={enhanced.quizTrend} />
        </section>
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]">
          <ModelLeaderboard />
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]">
          <TimeOfDayChart hourlyCounts={studentSignals.hourlyPromptCounts} dailyPeaks={studentSignals.dailyPeakHours} />
        </section>
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]">
          <ModeBreakdown modeCounts={enhanced.modeMessageCounts} />
        </section>
      </div>

      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]">
        <ProductivityInsights productivity={enhanced.productivity} />
      </section>

      {isTeacher && classData.length > 0 ? (
        <div className="border-t border-[var(--border-default)] pt-6">
          <h2 className="mb-3 font-display text-xl">Class Overview</h2>
          <div className="grid divide-y divide-[var(--border-default)] border-t border-b border-[var(--border-default)] text-sm sm:grid-cols-2 sm:divide-y-0 sm:divide-x">
            <div className="px-4 py-3">
              <p className="text-xs text-[var(--text-secondary)]">Active students</p>
              <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{uniqueStudents || classAgg.daysActive}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-[var(--text-secondary)]">Total messages</p>
              <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{classAgg.totalMessages}</p>
              <p className="text-xs text-[var(--text-secondary)]">{classAgg.totalSessions} sessions</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-[var(--text-secondary)]">Tokens used</p>
              <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{classAgg.totalTokens.toLocaleString()}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-[var(--text-secondary)]">Class avg quiz</p>
              <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{classAgg.avgScore !== null ? `${classAgg.avgScore}%` : "-"}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]">
              <ActivityAndTimeChart activity={classDailyActivity} studyTime={classDailyActivity.map((row) => ({ day: row.day, totalMinutes: 0 }))} />
            </section>
            <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]">
              <ModeBreakdown modeCounts={classAgg.modeCounts} />
            </section>
          </div>
        </div>
      ) : null}

      <div className="p-2 text-xs text-[var(--text-secondary)]">
        Most active study window: <span className="font-medium text-[var(--text-primary)]">{formatHour(topHour)} UTC</span>
      </div>
    </div>
  );
}
