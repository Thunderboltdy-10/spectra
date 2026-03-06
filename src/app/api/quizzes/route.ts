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
    const messageId = request.nextUrl.searchParams.get("messageId") ?? undefined;
    const parsedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "25");
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 25;

    if (messageId) {
      const state = await convexQuery("quizzes:getQuizStateByMessage", {
        actorClerkId: actor.clerkId,
        messageId,
      });
      return ok(state);
    }

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
      action?: "session" | "submit";
      chatId?: string;
      messageId?: string;
      questions?: QuizQuestionResult[];
      score?: number;
      total?: number;
      answers?: Array<{ questionId: string; selected: string }>;
    };

    if (body.action === "session") {
      if (!body.messageId || !Array.isArray(body.answers)) {
        throw new Error("Missing quiz session payload");
      }

      const saved = await convexMutation("quizzes:saveQuizSession", {
        actorClerkId: actor.clerkId,
        messageId: body.messageId,
        answers: body.answers.map((answer) => ({
          questionId: answer.questionId,
          selected: answer.selected,
        })),
      });

      return ok(saved);
    }

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
