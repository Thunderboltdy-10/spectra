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

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();

    const isTeacherOrAdmin = actor.role === "admin" || actor.role === "teacher";

    const studentRows = (await convexQuery("analytics:getStudentAnalytics", {
      actorClerkId: actor.clerkId,
      days: 30,
    })) as AnalyticsRow[];
    const studentSignals = (await convexQuery("analytics:getStudentPromptSignals", {
      actorClerkId: actor.clerkId,
      days: 30,
    })) as PromptSignals;
    const enhanced = (await convexQuery("analytics:getStudentEnhancedAnalytics", {
      actorClerkId: actor.clerkId,
      days: 30,
    })) as EnhancedAnalytics;

    let classRows: AnalyticsRow[] = [];
    if (isTeacherOrAdmin) {
      classRows = (await convexQuery("analytics:getClassAnalytics", {
        actorClerkId: actor.clerkId,
        days: 30,
      })) as AnalyticsRow[];
    }

    return NextResponse.json({
      role: actor.role,
      student: studentRows,
      studentSignals,
      enhanced,
      class: classRows,
    });
  });
}
