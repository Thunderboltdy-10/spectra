import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { withRouteErrorHandling } from "@/lib/route-handler";

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

type PromptSignals = {
  hourlyPromptCounts: number[];
  dailyPromptCounts: Array<{ day: string; count: number }>;
  dailyPeakHours: Array<{ day: string; hour: number; count: number }>;
  preferredModel?: string;
  preferredModelCount: number;
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

type CostAnalytics = {
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

function sanitizeDay(value: string | null) {
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

export async function GET(request: Request) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const { searchParams } = new URL(request.url);
    const startDay = sanitizeDay(searchParams.get("startDate"));
    const endDay = sanitizeDay(searchParams.get("endDate"));
    const daysParam = Number.parseInt(searchParams.get("days") ?? "", 10);
    const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : undefined;

    const isTeacherOrAdmin = actor.role === "admin" || actor.role === "teacher";

    const studentRows = (await convexQuery("analytics:getStudentAnalytics", {
      actorClerkId: actor.clerkId,
      days,
      startDay,
      endDay,
    })) as AnalyticsRow[];
    const studentSignals = (await convexQuery("analytics:getStudentPromptSignals", {
      actorClerkId: actor.clerkId,
      days,
      startDay,
      endDay,
    })) as PromptSignals;
    const enhanced = (await convexQuery("analytics:getStudentEnhancedAnalytics", {
      actorClerkId: actor.clerkId,
      days,
      startDay,
      endDay,
    })) as EnhancedAnalytics;
    const cost = (await convexQuery("analytics:getStudentCostAnalytics", {
      actorClerkId: actor.clerkId,
      days,
      startDay,
      endDay,
    })) as CostAnalytics;

    let classRows: AnalyticsRow[] = [];
    if (isTeacherOrAdmin) {
      classRows = (await convexQuery("analytics:getClassAnalytics", {
        actorClerkId: actor.clerkId,
        days,
        startDay,
        endDay,
      })) as AnalyticsRow[];
    }

    return NextResponse.json({
      role: actor.role,
      student: studentRows,
      studentSignals,
      enhanced,
      cost,
      class: classRows,
    });
  });
}
