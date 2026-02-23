import { requireActor } from "@/lib/auth-server";
import { convexMutation } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

const MIN_TIMER_SECONDS = 60;
const MAX_TIMER_SECONDS = 4 * 60 * 60;

type TimerBody = {
  chatId?: string;
  sessionType?: "pomodoro" | "free";
  startedAt?: number;
  endedAt?: number;
  totalSeconds?: number;
};

export async function POST(request: Request) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json().catch(() => null)) as TimerBody | null;
    if (!body) {
      return badRequest("Request body must be valid JSON.");
    }

    const totalSeconds = Number(body.totalSeconds);
    if (!Number.isFinite(totalSeconds)) {
      return badRequest("totalSeconds must be a valid number.");
    }

    const roundedTotalSeconds = Math.round(totalSeconds);
    if (roundedTotalSeconds < MIN_TIMER_SECONDS || roundedTotalSeconds > MAX_TIMER_SECONDS) {
      return badRequest(`totalSeconds must be between ${MIN_TIMER_SECONDS} and ${MAX_TIMER_SECONDS}.`);
    }

    const startedAt = typeof body.startedAt === "number" ? Math.round(body.startedAt) : undefined;
    const endedAt = typeof body.endedAt === "number" ? Math.round(body.endedAt) : undefined;
    if (startedAt !== undefined && startedAt < 0) {
      return badRequest("startedAt must be a positive timestamp.");
    }
    if (endedAt !== undefined && endedAt < 0) {
      return badRequest("endedAt must be a positive timestamp.");
    }
    if (startedAt !== undefined && endedAt !== undefined && endedAt < startedAt) {
      return badRequest("endedAt cannot be earlier than startedAt.");
    }

    const sessionType = body.sessionType === "free" ? "free" : "pomodoro";

    const result = await convexMutation<
      {
        actorClerkId: string;
        chatId?: string;
        sessionType: "pomodoro" | "free";
        startedAt?: number;
        endedAt?: number;
        totalSeconds: number;
      },
      {
        timerId: string;
        totalSeconds: number;
      }
    >("gamification:logStudyTimerSession", {
      actorClerkId: actor.clerkId,
      chatId: body.chatId,
      sessionType,
      startedAt,
      endedAt,
      totalSeconds: roundedTotalSeconds,
    });

    return ok({
      ok: true,
      timerId: result.timerId,
      totalSeconds: result.totalSeconds,
    });
  });
}
