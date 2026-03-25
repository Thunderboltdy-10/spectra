"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { useSidebar } from "@/context/sidebar-context";

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

type AnalyticsResponse = {
  role: "student" | "teacher" | "admin";
  student: AnalyticsRow[];
  studentSignals: {
    hourlyPromptCounts: number[];
    dailyPromptCounts: Array<{ day: string; count: number }>;
    dailyPeakHours: Array<{ day: string; hour: number; count: number }>;
    preferredModel?: string;
    preferredModelCount: number;
  };
  enhanced: {
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
  cost: {
    daily: Array<{
      day: string;
      free: number;
      cheap: number;
      mid: number;
      premium: number;
      total: number;
    }>;
    byModel: Array<{
      modelId: string;
      requestCount: number;
      totalTokens: number;
      totalCostCents: number;
    }>;
    estimatedMonthCostCents: number;
    monthKey: string;
  };
  class: AnalyticsRow[];
};

export type AnalyticsRangePreset = "current_month" | "last_7_days" | "last_30_days" | "custom";
export type AnalyticsRange = {
  preset: AnalyticsRangePreset;
  startDate: string;
  endDate: string;
};

function toIsoDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

function defaultCurrentMonthRange(): AnalyticsRange {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return {
    preset: "current_month",
    startDate: toIsoDay(monthStart),
    endDate: toIsoDay(now),
  };
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export default function AnalyticsPage() {
  const { isSuperAdmin } = useSidebar();
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<AnalyticsRange>(defaultCurrentMonthRange());
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    async function load() {
      const initialLoad = !hasLoadedRef.current;
      try {
        if (!initialLoad) setRefreshing(true);
        const params = new URLSearchParams({
          startDate: range.startDate,
          endDate: range.endDate,
        });
        const response = await fetch(`/api/analytics?${params.toString()}`);
        if (!response.ok) throw new Error(await response.text());
        const json = (await response.json()) as AnalyticsResponse;
        setData(json);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load analytics");
      } finally {
        setLoading(false);
        setRefreshing(false);
        hasLoadedRef.current = true;
      }
    }
    void load();
  }, [range.endDate, range.startDate]);

  return (
    <AppShell fullBleed contentClassName="2xl:px-14">
      <div data-tour="analytics-header" className="mb-6">
        <h1 className="font-display text-3xl">Analytics</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Track your study progress and learning patterns</p>
      </div>

      {loading ? (
        <AnalyticsSkeleton />
      ) : data ? (
        <AnalyticsDashboard
          role={data.role}
          studentData={data.student}
          studentSignals={data.studentSignals}
          enhanced={data.enhanced}
          cost={data.cost}
          showCostDetails={isSuperAdmin}
          classData={data.class}
          range={range}
          onRangeChange={setRange}
          refreshing={refreshing}
        />
      ) : (
        <div className="rounded-[var(--radius-container)] border border-dashed border-[var(--border-default)] p-8 text-center text-[var(--text-secondary)]">
          Start chatting to see your analytics here
        </div>
      )}
    </AppShell>
  );
}
