import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { MODEL_CONFIG } from "@/lib/model-config";
import { openRouterChatCompletion } from "@/lib/openrouter";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { recordOpenRouterUsage } from "@/lib/usage-tracking";

type StudyPlanTimelineItem = {
  day: string;
  focus: string;
  mode?: string;
  durationMinutes?: number;
  activities: string[];
};

type StudyPlanRecommendation = {
  mode: string;
  reason: string;
  target?: string;
};

type StudyPlanPayload = {
  topic: string;
  title: string;
  summary: string;
  timeline: StudyPlanTimelineItem[];
  recommendations: StudyPlanRecommendation[];
  checkpoints: string[];
};

type AnalyticsRow = {
  modesUsed?: string[];
};

type QuizHistoryRow = {
  score: number;
  total: number;
  questions?: Array<{
    prompt?: string;
    isCorrect?: boolean;
  }>;
};

type DeckRow = {
  _id: string;
  title: string;
  cardCount: number;
  dueCount: number;
};

type Snapshot = {
  avgQuizPercent?: number;
  quizAttempts: number;
  dueFlashcards: number;
  totalDecks: number;
  strongestModes: string[];
  weakTopics: string[];
};

const VALID_MODES = new Set([
  "auto",
  "tutor",
  "marker",
  "exam",
  "draft_coach",
  "quiz",
  "flashcard",
  "research",
  "explain",
  "general",
  "image",
]);

function sanitizeMode(value: unknown) {
  const clean = String(value ?? "").trim().toLowerCase();
  return VALID_MODES.has(clean) ? clean : undefined;
}

function toStringArray(value: unknown, max = 8) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function clip(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function buildFallbackPlan(topic: string, snapshot: Snapshot): StudyPlanPayload {
  const weaker = snapshot.avgQuizPercent !== undefined && snapshot.avgQuizPercent < 60;
  const dueLoad = snapshot.dueFlashcards;

  return {
    topic,
    title: `${topic} 7-Day Study Sprint`,
    summary:
      weaker
        ? `Start with fundamentals, then ramp difficulty using short daily quizzes and flashcard reviews.`
        : `Use mixed retrieval + application blocks to keep momentum while increasing depth.`,
    timeline: [
      {
        day: "Day 1",
        focus: "Baseline and weak-topic diagnosis",
        mode: "quiz",
        durationMinutes: 35,
        activities: [
          "Take a short baseline quiz on core concepts.",
          "List mistakes and convert each into a quick learning objective.",
          "Review the top 3 weak points in Learn mode.",
        ],
      },
      {
        day: "Day 2",
        focus: "Concept rebuild",
        mode: "tutor",
        durationMinutes: 45,
        activities: [
          "Re-study difficult concepts with step-by-step explanations.",
          "Create 8-12 targeted flashcards from weak areas.",
          "Write a short self-explanation for each tricky concept.",
        ],
      },
      {
        day: "Day 3",
        focus: "Retention loop",
        mode: "flashcard",
        durationMinutes: dueLoad > 0 ? 40 : 30,
        activities: [
          `Review due flashcards (${dueLoad} currently due).`,
          "Rate cards honestly to calibrate SM-2 intervals.",
          "Add 5 new cards for concepts missed yesterday.",
        ],
      },
      {
        day: "Day 4",
        focus: "Applied practice",
        mode: "exam",
        durationMinutes: 45,
        activities: [
          "Run a timed mini-practice set.",
          "Mark your answers and identify recurring error patterns.",
          "Revise using concise correction notes.",
        ],
      },
      {
        day: "Day 5",
        focus: "Hard-mode retrieval",
        mode: "quiz",
        durationMinutes: 35,
        activities: [
          "Take a harder quiz variant.",
          "For each wrong answer, explain why the correct option is right.",
          "Capture 3 transfer questions to test deeper understanding.",
        ],
      },
      {
        day: "Day 6",
        focus: "Targeted research and synthesis",
        mode: "research",
        durationMinutes: 40,
        activities: [
          "Research one advanced subtopic with source-backed notes.",
          "Summarize findings into a one-page concept map.",
          "Generate 4 challenge questions from the summary.",
        ],
      },
      {
        day: "Day 7",
        focus: "Final checkpoint and next-cycle plan",
        mode: "quiz",
        durationMinutes: 30,
        activities: [
          "Complete a final mixed quiz.",
          "Compare score trend from Day 1 to Day 7.",
          "Decide next week's priorities from remaining weak areas.",
        ],
      },
    ],
    recommendations: [
      {
        mode: "quiz",
        reason: "Best for tracking retrieval performance and score trend.",
        target: "Daily 10-15 question checks.",
      },
      {
        mode: "flashcard",
        reason: "Maintains long-term memory through spaced repetition.",
        target: "Review all due cards each day.",
      },
      {
        mode: weaker ? "tutor" : "exam",
        reason: weaker
          ? "Rebuilds core understanding before moving to harder tasks."
          : "Converts understanding into timed performance.",
        target: weaker ? "20 minutes concept rebuild daily." : "2 timed sessions this week.",
      },
    ],
    checkpoints: [
      "Hit at least 80% on final quiz.",
      "Clear due flashcards daily.",
      "Reduce recurring mistake categories to 2 or fewer.",
    ],
  };
}

function normalizePlan(candidate: unknown, fallback: StudyPlanPayload): StudyPlanPayload {
  if (!candidate || typeof candidate !== "object") {
    return fallback;
  }

  const raw = candidate as Partial<StudyPlanPayload>;
  const timeline = Array.isArray(raw.timeline)
    ? raw.timeline
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const row = item as Partial<StudyPlanTimelineItem>;
          const day = clip(String(row.day ?? "").trim(), 28);
          const focus = clip(String(row.focus ?? "").trim(), 120);
          const activities = toStringArray(row.activities, 5).map((entry) => clip(entry, 160));
          if (!day || !focus || activities.length === 0) return null;
          const duration = Number(row.durationMinutes);
          return {
            day,
            focus,
            mode: sanitizeMode(row.mode),
            durationMinutes: Number.isFinite(duration) ? Math.min(180, Math.max(10, Math.round(duration))) : undefined,
            activities,
          } satisfies StudyPlanTimelineItem;
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .slice(0, 10)
    : [];

  const recommendations = Array.isArray(raw.recommendations)
    ? raw.recommendations
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const row = item as Partial<StudyPlanRecommendation>;
          const mode = sanitizeMode(row.mode);
          const reason = clip(String(row.reason ?? "").trim(), 180);
          if (!mode || !reason) return null;
          const target = clip(String(row.target ?? "").trim(), 140);
          return {
            mode,
            reason,
            target: target || undefined,
          } satisfies StudyPlanRecommendation;
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .slice(0, 6)
    : [];

  const title = clip(String(raw.title ?? "").trim(), 90);
  const summary = clip(String(raw.summary ?? "").trim(), 320);
  const checkpoints = toStringArray(raw.checkpoints, 6).map((entry) => clip(entry, 180));

  return {
    topic: fallback.topic,
    title: title || fallback.title,
    summary: summary || fallback.summary,
    timeline: timeline.length > 0 ? timeline : fallback.timeline,
    recommendations: recommendations.length > 0 ? recommendations : fallback.recommendations,
    checkpoints: checkpoints.length > 0 ? checkpoints : fallback.checkpoints,
  };
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json().catch(() => null)) as { topic?: string } | null;
    const topic = body?.topic?.trim();

    if (!topic) {
      return NextResponse.json({ error: "Topic is required" }, { status: 400 });
    }

    const [analyticsRows, quizHistory, dueCards, decks] = await Promise.all([
      convexQuery("analytics:getStudentAnalytics", {
        actorClerkId: actor.clerkId,
        days: 30,
      }) as Promise<AnalyticsRow[]>,
      convexQuery("quizzes:getQuizHistory", {
        actorClerkId: actor.clerkId,
        limit: 25,
      }) as Promise<QuizHistoryRow[]>,
      convexQuery("flashcards:getDueCards", {
        actorClerkId: actor.clerkId,
        limit: 200,
      }) as Promise<Array<{ cardHash: string }>>,
      convexQuery("flashcards:listDecks", {
        actorClerkId: actor.clerkId,
        limit: 30,
      }) as Promise<DeckRow[]>,
    ]);

    const modeCounts = new Map<string, number>();
    for (const row of analyticsRows ?? []) {
      for (const mode of row.modesUsed ?? []) {
        modeCounts.set(mode, (modeCounts.get(mode) ?? 0) + 1);
      }
    }
    const strongestModes = [...modeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([mode]) => mode);

    const quizPercents = (quizHistory ?? [])
      .filter((item) => Number.isFinite(item.score) && Number.isFinite(item.total) && item.total > 0)
      .map((item) => (item.score / item.total) * 100);
    const avgQuizPercent =
      quizPercents.length > 0
        ? Number((quizPercents.reduce((sum, value) => sum + value, 0) / quizPercents.length).toFixed(1))
        : undefined;

    const weakTopicCounts = new Map<string, number>();
    for (const result of quizHistory ?? []) {
      for (const question of result.questions ?? []) {
        if (question.isCorrect) continue;
        const key = clip(String(question.prompt ?? "").replace(/\s+/g, " ").trim(), 80);
        if (!key) continue;
        weakTopicCounts.set(key, (weakTopicCounts.get(key) ?? 0) + 1);
      }
    }
    const weakTopics = [...weakTopicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([topicLabel]) => topicLabel);

    const snapshot: Snapshot = {
      avgQuizPercent,
      quizAttempts: quizPercents.length,
      dueFlashcards: (dueCards ?? []).length,
      totalDecks: (decks ?? []).length,
      strongestModes,
      weakTopics,
    };

    const fallback = buildFallbackPlan(topic, snapshot);

    try {
      const completion = await openRouterChatCompletion({
        model: MODEL_CONFIG.glmAir,
        fallbackModels: [MODEL_CONFIG.tutorFast],
        temperature: 0.2,
        maxTokens: 1400,
        messages: [
          {
            role: "system",
            content: `You are an AI study planner for students.
Return ONLY valid JSON with this exact shape:
{
  "title": "string",
  "summary": "string",
  "timeline": [
    {
      "day": "Day 1",
      "focus": "string",
      "mode": "tutor|quiz|flashcard|research|exam|marker|draft_coach|explain|general|auto|image",
      "durationMinutes": 30,
      "activities": ["string", "string"]
    }
  ],
  "recommendations": [
    {
      "mode": "tutor|quiz|flashcard|research|exam|marker|draft_coach|explain|general|auto|image",
      "reason": "string",
      "target": "string"
    }
  ],
  "checkpoints": ["string", "string"]
}
Rules:
- 5 to 8 timeline days.
- Activities must be concrete and measurable.
- Personalize using provided performance data.
- Do not include markdown fences, comments, or extra text.`,
          },
          {
            role: "user",
            content: `Create a study plan for topic: "${topic}".
Performance snapshot:
${JSON.stringify(snapshot, null, 2)}`,
          },
        ],
      });
      await recordOpenRouterUsage({
        actorClerkId: actor.clerkId,
        model: completion.model ?? MODEL_CONFIG.glmAir,
        usage: completion.usage,
      }).catch(() => {});

      const raw = completion.choices?.[0]?.message?.content?.trim() ?? "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return NextResponse.json({ plan: fallback });
      }

      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      const normalized = normalizePlan(parsed, fallback);
      return NextResponse.json({ plan: normalized });
    } catch {
      return NextResponse.json({ plan: fallback });
    }
  });
}
