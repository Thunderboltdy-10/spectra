"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
import { Button } from "@/components/ui/button";

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

function scoreLabel(usageCount: number) {
  if (usageCount >= 14) return "High rigor";
  if (usageCount >= 7) return "Strong fit";
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

  const avgScore =
    allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : null;

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

function monthKeyFromDay(day: string) {
  return day.slice(0, 7);
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const value = new Date(Date.UTC(year, (month ?? 1) - 1, 1));
  return value.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function listDaysInMonth(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return [];
  const totalDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: totalDays }, (_, index) => {
    const value = new Date(Date.UTC(year, month - 1, index + 1));
    return value.toISOString().slice(0, 10);
  });
}

function buildMonthOptions(items: Array<{ day: string }>) {
  return Array.from(new Set(items.map((item) => monthKeyFromDay(item.day)).filter(Boolean))).sort();
}

function buildDailyActivity(rows: AnalyticsRow[], monthKey: string) {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.day, (map.get(row.day) ?? 0) + row.messagesCount);
  }

  return listDaysInMonth(monthKey).map((day) => ({
    day,
    count: map.get(day) ?? 0,
  }));
}

function buildDailyStudyTime(
  daily: EnhancedAnalytics["timeSpentDaily"],
  monthKey: string,
) {
  const byDay = new Map(daily.map((item) => [item.day, item]));
  return listDaysInMonth(monthKey).map((day) => {
    const row = byDay.get(day);
    return {
      day,
      totalSeconds: row?.totalSeconds ?? 0,
      totalMinutes: Math.round((row?.totalSeconds ?? 0) / 60),
      messages: row?.messages ?? 0,
    };
  });
}

function filterByMonth<T extends { day: string }>(rows: T[], monthKey: string) {
  return rows.filter((row) => monthKeyFromDay(row.day) === monthKey);
}

function aggregateMonthlyModeCounts(rows: AnalyticsRow[]) {
  const modeCounts: Record<string, number> = {};
  for (const row of rows) {
    for (const mode of row.modesUsed) {
      modeCounts[mode] = (modeCounts[mode] ?? 0) + 1;
    }
  }
  return modeCounts;
}

function deriveMonthlyProductivity(
  rows: AnalyticsRow[],
  studyRows: EnhancedAnalytics["timeSpentDaily"],
) {
  const totals = aggregateRows(rows);
  const totalStudySeconds = studyRows.reduce((sum, row) => sum + (row.totalSeconds ?? 0), 0);
  const activeDays = new Set(
    [...rows.map((row) => row.day), ...studyRows.filter((row) => row.totalSeconds > 0).map((row) => row.day)],
  ).size;

  return {
    totalStudySeconds,
    estimatedSessions: totals.totalSessions,
    messagesPerSession:
      totals.totalSessions > 0 ? Number((totals.totalMessages / totals.totalSessions).toFixed(1)) : 0,
    topicDepth: totals.uniqueTopicCount,
    activeDays,
  };
}

function buildHourlyCountsForMonth(
  dailyPeaks: Array<{ day: string; hour: number; count: number }>,
  fallbackHourlyCounts: number[],
  monthKey: string,
) {
  const monthlyPeaks = filterByMonth(dailyPeaks, monthKey);
  if (monthlyPeaks.length === 0) {
    return fallbackHourlyCounts;
  }
  const hourly = Array.from({ length: 24 }, () => 0);
  for (const peak of monthlyPeaks) {
    hourly[peak.hour] = (hourly[peak.hour] ?? 0) + peak.count;
  }
  return hourly;
}

function MonthPager({
  monthLabel,
  onPrevious,
  onNext,
  previousDisabled,
  nextDisabled,
}: {
  monthLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  previousDisabled: boolean;
  nextDisabled: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Button type="button" variant="secondary" size="icon" className="h-8 w-8" onClick={onPrevious} disabled={previousDisabled}>
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <div className="min-w-[9rem] rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1 text-center text-[11px] font-medium text-[var(--text-primary)]">
        {monthLabel}
      </div>
      <Button type="button" variant="secondary" size="icon" className="h-8 w-8" onClick={onNext} disabled={nextDisabled}>
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function ChartToolbar(props: {
  monthLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  previousDisabled: boolean;
  nextDisabled: boolean;
}) {
  return (
    <div className="flex justify-end px-4 pt-4 sm:px-5">
      <MonthPager {...props} />
    </div>
  );
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
  if (trend.length === 0) {
    return <div className="p-4 text-center text-sm text-[var(--text-secondary)]">No quiz trend data yet</div>;
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-secondary)]">Quiz performance</p>
        <p className="text-xs text-[var(--text-secondary)]">{trend[trend.length - 1]?.averageScore ?? 0}% latest</p>
      </div>
      <ResponsiveContainer width="100%" height={128}>
        <ComposedChart data={trend.map((item) => ({ day: shortDayLabel(item.day), score: item.averageScore, attempts: item.attempts }))}>
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

function ModelLeaderboard({ rows }: { rows: AnalyticsRow[] }) {
  const entries = useMemo(() => {
    const byModel = new Map<string, number>();
    for (const row of rows) {
      for (const model of row.modelsUsed) {
        if (!model) continue;
        byModel.set(model, (byModel.get(model) ?? 0) + 1);
      }
    }
    return Array.from(byModel.entries())
      .map(([modelId, usageCount]) => ({
        modelId,
        usageCount,
      }))
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 6);
  }, [rows]);

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-secondary)]">Personal model leaderboard</p>
        <p className="text-xs text-[var(--text-secondary)]">{entries.length > 0 ? `Top ${entries.length}` : "No usage yet"}</p>
      </div>
      <div className="space-y-2">
        {entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-default)] px-3 py-4 text-center text-sm text-[var(--text-secondary)]">
            No routed model usage yet.
          </div>
        ) : (
          entries.map((entry, index) => (
            <div key={entry.modelId} className="grid min-h-[44px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5">
              <span className="text-[11px] font-medium text-[var(--text-secondary)]">{index + 1}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--text-primary)]">{formatModelName(entry.modelId)}</p>
                <p className="truncate text-[11px] text-[var(--text-secondary)]">{entry.usageCount} routed responses</p>
              </div>
              <span className="text-[11px] text-[var(--text-secondary)]">{scoreLabel(entry.usageCount)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ProductivityInsights({
  productivity,
}: {
  productivity: {
    totalStudySeconds: number;
    estimatedSessions: number;
    messagesPerSession: number;
    topicDepth: number;
    activeDays: number;
  };
}) {
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
  const streak = useMemo(() => calculateStreak(studentData), [studentData]);
  const isTeacher = role === "admin" || role === "teacher";

  const availableMonths = useMemo(
    () =>
      buildMonthOptions([
        ...studentData,
        ...classData,
        ...enhanced.timeSpentDaily,
        ...enhanced.quizTrend,
        ...studentSignals.dailyPeakHours,
      ]),
    [classData, enhanced.quizTrend, enhanced.timeSpentDaily, studentData, studentSignals.dailyPeakHours],
  );

  const [selectedMonthIndex, setSelectedMonthIndex] = useState(0);

  useEffect(() => {
    setSelectedMonthIndex((prev) => {
      if (availableMonths.length === 0) return 0;
      if (prev >= 0 && prev < availableMonths.length) return prev;
      return availableMonths.length - 1;
    });
  }, [availableMonths]);

  const selectedMonthKey =
    availableMonths[selectedMonthIndex] ??
    availableMonths[availableMonths.length - 1] ??
    monthKeyFromDay(new Date().toISOString().slice(0, 10));

  const filteredStudentData = useMemo(
    () => filterByMonth(studentData, selectedMonthKey),
    [selectedMonthKey, studentData],
  );
  const filteredStudyTime = useMemo(
    () => filterByMonth(enhanced.timeSpentDaily, selectedMonthKey),
    [enhanced.timeSpentDaily, selectedMonthKey],
  );
  const filteredQuizTrend = useMemo(
    () => filterByMonth(enhanced.quizTrend, selectedMonthKey),
    [enhanced.quizTrend, selectedMonthKey],
  );
  const filteredDailyPeaks = useMemo(
    () => filterByMonth(studentSignals.dailyPeakHours, selectedMonthKey),
    [selectedMonthKey, studentSignals.dailyPeakHours],
  );
  const filteredClassData = useMemo(
    () => filterByMonth(classData, selectedMonthKey),
    [classData, selectedMonthKey],
  );

  const dailyActivity = useMemo(() => buildDailyActivity(filteredStudentData, selectedMonthKey), [filteredStudentData, selectedMonthKey]);
  const dailyStudyTime = useMemo(
    () => buildDailyStudyTime(filteredStudyTime, selectedMonthKey),
    [filteredStudyTime, selectedMonthKey],
  );
  const filteredModeCounts = useMemo(() => aggregateMonthlyModeCounts(filteredStudentData), [filteredStudentData]);
  const filteredProductivity = useMemo(
    () => deriveMonthlyProductivity(filteredStudentData, filteredStudyTime),
    [filteredStudentData, filteredStudyTime],
  );
  const filteredHourlyCounts = useMemo(
    () => buildHourlyCountsForMonth(studentSignals.dailyPeakHours, studentSignals.hourlyPromptCounts, selectedMonthKey),
    [selectedMonthKey, studentSignals.dailyPeakHours, studentSignals.hourlyPromptCounts],
  );
  const monthLabel = formatMonthLabel(selectedMonthKey);
  const previousDisabled = selectedMonthIndex <= 0;
  const nextDisabled = selectedMonthIndex >= availableMonths.length - 1;

  const topHour = useMemo(() => {
    const counts = filteredHourlyCounts ?? [];
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
  }, [filteredHourlyCounts]);

  const uniqueStudents = useMemo(() => {
    const ids = new Set<string>();
    for (const row of classData) {
      if ("userId" in row) ids.add(String((row as AnalyticsRow & { userId?: string }).userId));
    }
    return ids.size;
  }, [classData]);

  const averageDailyStudyMinutes =
    filteredProductivity.activeDays > 0
      ? Math.round((filteredProductivity.totalStudySeconds / filteredProductivity.activeDays) / 60)
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
          <StatItem label="Avg study/day" value={`${averageDailyStudyMinutes}m`} subtitle={monthLabel} />
          <StatItem label="Preferred model" value={formatModelName(studentSignals.preferredModel)} subtitle={studentSignals.preferredModelCount > 0 ? `${studentSignals.preferredModelCount} routed responses` : "No routed responses yet"} />
        </div>
      </div>

      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] xl:col-span-2">
        <ChartToolbar
          monthLabel={monthLabel}
          onPrevious={() => setSelectedMonthIndex((value) => Math.max(0, value - 1))}
          onNext={() => setSelectedMonthIndex((value) => Math.min(availableMonths.length - 1, value + 1))}
          previousDisabled={previousDisabled}
          nextDisabled={nextDisabled}
        />
        <ActivityAndTimeChart activity={dailyActivity} studyTime={dailyStudyTime} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]">
          <ChartToolbar
            monthLabel={monthLabel}
            onPrevious={() => setSelectedMonthIndex((value) => Math.max(0, value - 1))}
            onNext={() => setSelectedMonthIndex((value) => Math.min(availableMonths.length - 1, value + 1))}
            previousDisabled={previousDisabled}
            nextDisabled={nextDisabled}
          />
          <QuizTrendChart trend={filteredQuizTrend} />
        </section>
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]">
          <ChartToolbar
            monthLabel={monthLabel}
            onPrevious={() => setSelectedMonthIndex((value) => Math.max(0, value - 1))}
            onNext={() => setSelectedMonthIndex((value) => Math.min(availableMonths.length - 1, value + 1))}
            previousDisabled={previousDisabled}
            nextDisabled={nextDisabled}
          />
          <ModelLeaderboard rows={filteredStudentData} />
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]">
          <ChartToolbar
            monthLabel={monthLabel}
            onPrevious={() => setSelectedMonthIndex((value) => Math.max(0, value - 1))}
            onNext={() => setSelectedMonthIndex((value) => Math.min(availableMonths.length - 1, value + 1))}
            previousDisabled={previousDisabled}
            nextDisabled={nextDisabled}
          />
          <TimeOfDayChart hourlyCounts={filteredHourlyCounts} dailyPeaks={filteredDailyPeaks} />
        </section>
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]">
          <ChartToolbar
            monthLabel={monthLabel}
            onPrevious={() => setSelectedMonthIndex((value) => Math.max(0, value - 1))}
            onNext={() => setSelectedMonthIndex((value) => Math.min(availableMonths.length - 1, value + 1))}
            previousDisabled={previousDisabled}
            nextDisabled={nextDisabled}
          />
          <ModeBreakdown modeCounts={filteredModeCounts} />
        </section>
      </div>

      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]">
        <ChartToolbar
          monthLabel={monthLabel}
          onPrevious={() => setSelectedMonthIndex((value) => Math.max(0, value - 1))}
          onNext={() => setSelectedMonthIndex((value) => Math.min(availableMonths.length - 1, value + 1))}
          previousDisabled={previousDisabled}
          nextDisabled={nextDisabled}
        />
        <ProductivityInsights productivity={filteredProductivity} />
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
          <div className="mt-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 text-sm text-[var(--text-secondary)]">
            {filteredClassData.length > 0
              ? `Month focus for ${monthLabel}: ${filteredClassData.length} active class day${filteredClassData.length === 1 ? "" : "s"} recorded.`
              : `No class activity recorded in ${monthLabel}.`}
          </div>
        </div>
      ) : null}

      <div className="p-2 text-xs text-[var(--text-secondary)]">
        Most active study window in {monthLabel}: <span className="font-medium text-[var(--text-primary)]">{formatHour(topHour)} UTC</span>
      </div>
    </div>
  );
}
