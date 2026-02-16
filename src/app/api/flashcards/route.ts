import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

type FlashcardInput = {
  front: string;
  back: string;
  cardHash?: string;
};

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const action = request.nextUrl.searchParams.get("action") ?? "list";
    const chatId = request.nextUrl.searchParams.get("chatId") ?? undefined;
    const parsedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 50;

    if (action === "due") {
      const cards = await convexQuery("flashcards:getDueCards", {
        actorClerkId: actor.clerkId,
        limit,
      });
      return ok({ cards });
    }

    const decks = await convexQuery("flashcards:listDecks", {
      actorClerkId: actor.clerkId,
      chatId,
      limit,
    });
    return ok({ decks });
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as
      | {
          action?: "save_deck";
          chatId?: string;
          sourceMessageId?: string;
          title?: string;
          cards?: FlashcardInput[];
        }
      | {
          action: "rate_card";
          cardHash?: string;
          quality?: number;
        };

    if (body.action === "rate_card") {
      if (!body.cardHash || typeof body.quality !== "number") {
        throw new Error("Missing card rating payload");
      }
      const result = await convexMutation("flashcards:rateCard", {
        actorClerkId: actor.clerkId,
        cardHash: body.cardHash,
        quality: body.quality,
      });
      return ok(result);
    }

    if (!body.chatId || !Array.isArray(body.cards)) {
      throw new Error("Missing flashcard deck payload");
    }

    const result = await convexMutation("flashcards:saveDeck", {
      actorClerkId: actor.clerkId,
      chatId: body.chatId,
      sourceMessageId: body.sourceMessageId,
      title: body.title ?? "Untitled deck",
      cards: body.cards.map((card) => ({
        front: card.front,
        back: card.back,
        cardHash: card.cardHash,
      })),
    });
    return ok(result);
  });
}
