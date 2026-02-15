import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

type QuizQuestionResult = {
  id: string;
  prompt: string;
  selected?: string;
  correct?: string;
  isCorrect: boolean;
  explanation?: string;
};

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const chatId = request.nextUrl.searchParams.get("chatId") ?? undefined;
    const parsedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "25");
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 25;

    const history = await convexQuery("quizzes:getQuizHistory", {
      actorClerkId: actor.clerkId,
      chatId,
      limit,
    });

    return ok({ history });
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as {
      chatId?: string;
      messageId?: string;
      questions?: QuizQuestionResult[];
      score?: number;
      total?: number;
    };

    if (!body.chatId || !body.messageId || !Array.isArray(body.questions)) {
      throw new Error("Missing quiz payload");
    }

    const saved = await convexMutation("quizzes:saveQuizResult", {
      actorClerkId: actor.clerkId,
      chatId: body.chatId,
      messageId: body.messageId,
      questions: body.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        selected: question.selected,
        correct: question.correct,
        isCorrect: Boolean(question.isCorrect),
        explanation: question.explanation,
      })),
      score: Number(body.score ?? 0),
      total: Number(body.total ?? body.questions.length),
    });

    return ok(saved);
  });
}
