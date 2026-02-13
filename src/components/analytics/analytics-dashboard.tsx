"use client";

import { useMemo } from "react";
import { Activity, BookOpen, Brain, Clock3, MessageSquare, Trophy, Users } from "lucide-react";
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
  classData: AnalyticsRow[];
};

function formatHour(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const normalized = hour % 12 === 0 ? 12 : hour % 12;
  return `${normalized} ${suffix}`;
}

function formatModelName(modelId?: string) {
  if (!modelId) return "—";
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
    for (const m of row.modesUsed) modeCounts[m] = (modeCounts[m] ?? 0) + 1;
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

  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ day: key, count: map.get(key) ?? 0 });
  }
  return days;
}

function calculateStreak(rows: AnalyticsRow[]) {
  const days = new Set(rows.map((r) => r.day));
  let streak = 0;
  const now = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (days.has(key)) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

export function AnalyticsDashboard({ role, studentData, studentSignals, classData }: AnalyticsDashboardProps) {
  const student = useMemo(() => aggregateRows(studentData), [studentData]);
  const classAgg = useMemo(() => aggregateRows(classData), [classData]);
  const dailyActivity = useMemo(() => buildDailyActivity(studentData), [studentData]);
  const classDailyActivity = useMemo(() => buildDailyActivity(classData), [classData]);
  const streak = useMemo(() => calculateStreak(studentData), [studentData]);
  const topHour = useMemo(() => {
    const counts = studentSignals.hourlyPromptCounts ?? [];
    if (counts.length === 0) return 0;
    let idx = 0;
    let max = -1;
    for (let i = 0; i < counts.length; i += 1) {
      if ((counts[i] ?? 0) > max) {
        max = counts[i] ?? 0;
        idx = i;
      }
    }
    return idx;
  }, [studentSignals.hourlyPromptCounts]);
  const isTeacher = role === "admin" || role === "teacher";

  const uniqueStudents = useMemo(() => {
    const ids = new Set<string>();
    for (const row of classData) {
      if ("userId" in row) ids.add(String(row.userId));
    }
    return ids.size;
  }, [classData]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 text-lg font-semibold">Your Study Stats</h2>
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
            value={student.avgScore !== null ? `${student.avgScore}%` : "—"}
            subtitle={student.avgScore !== null ? "across all quizzes" : "No quizzes yet"}
            color="#f59e0b"
          />
          <StatsCard
            icon={Clock3}
            label="Most active time"
            value={formatHour(topHour)}
            subtitle="UTC based on prompt timestamps"
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
        <ModeBreakdown modeCounts={student.modeCounts} />
        <TimeOfDayChart hourlyCounts={studentSignals.hourlyPromptCounts} dailyPeaks={studentSignals.dailyPeakHours} />
      </div>

      <TopicCloud topics={student.topics} />

      {isTeacher && classData.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Class Overview</h2>
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
              value={classAgg.avgScore !== null ? `${classAgg.avgScore}%` : "—"}
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
    </div>
  );
}
