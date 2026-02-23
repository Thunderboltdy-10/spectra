"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import { Skeleton } from "@/components/ui/skeleton";

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
  class: AnalyticsRow[];
};

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
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("/api/analytics");
        if (!response.ok) throw new Error(await response.text());
        const json = (await response.json()) as AnalyticsResponse;
        setData(json);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load analytics");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <AppShell fullBleed contentClassName="2xl:px-14">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Track your study progress and learning patterns
        </p>
      </div>

      {loading ? (
        <AnalyticsSkeleton />
      ) : data ? (
        <AnalyticsDashboard
          role={data.role}
          studentData={data.student}
          studentSignals={data.studentSignals}
          enhanced={data.enhanced}
          classData={data.class}
        />
      ) : (
        <div className="rounded-[var(--radius-container)] border border-dashed border-[var(--border-default)] p-8 text-center text-[var(--text-secondary)]">
          Start chatting to see your analytics here
        </div>
      )}
    </AppShell>
  );
}
