import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";

function hashCard(front: string, back: string) {
  const input = `${front.trim().toLowerCase()}::${back.trim().toLowerCase()}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return `fc_${(hash >>> 0).toString(16)}`;
}

function normalizeDeckTitle(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function calculateNextReview(
  quality: number,
  easeFactor: number,
  interval: number,
  repetitions: number,
  now = Date.now(),
) {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  let ef = Math.max(1.3, easeFactor);
  let reps = Math.max(0, repetitions);
  let ivl = Math.max(0, interval);

  if (q < 3) {
    reps = 0;
    ivl = 1;
  } else {
    if (reps === 0) ivl = 1;
    else if (reps === 1) ivl = 6;
    else ivl = Math.round(ivl * ef);
    reps += 1;
  }

  ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  ef = Math.max(1.3, Number(ef.toFixed(2)));

  return {
    easeFactor: ef,
    interval: ivl,
    repetitions: reps,
    nextReviewAt: now + ivl * 24 * 60 * 60 * 1000,
  };
}

export const saveDeck = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
    sourceMessageId: v.optional(v.id("messages")),
    title: v.string(),
    cards: v.array(
      v.object({
        front: v.string(),
        back: v.string(),
        cardHash: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.ownerUserId !== actor._id || chat.orgId !== actor.orgId || chat.deletedAt) {
      throw new Error("Chat not found");
    }

    const cards = args.cards
      .map((card) => ({
        front: card.front.trim(),
        back: card.back.trim(),
        cardHash: card.cardHash?.trim() || hashCard(card.front, card.back),
      }))
      .filter((card) => card.front.length > 0 && card.back.length > 0);

    if (cards.length === 0) {
      throw new Error("Deck is empty");
    }

    const now = Date.now();
    const normalizedTitle = normalizeDeckTitle(args.title || "Untitled deck");
    const existingDecks = await ctx.db
      .query("flashcardDecks")
      .withIndex("by_user_updated", (q) => q.eq("userId", actor._id))
      .collect();

    const existing = existingDecks.find((deck) => {
      if (deck.chatId !== chat._id) return false;
      if (args.sourceMessageId && deck.sourceMessageId) {
        return deck.sourceMessageId === args.sourceMessageId;
      }
      return normalizeDeckTitle(deck.title) === normalizedTitle;
    });

    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title.trim() || existing.title || "Untitled deck",
        sourceMessageId: args.sourceMessageId ?? existing.sourceMessageId,
        cards,
        updatedAt: now,
      });
      return { deckId: existing._id, cardCount: cards.length, updated: true };
    }

    const deckId = await ctx.db.insert("flashcardDecks", {
      userId: actor._id,
      orgId: actor.orgId,
      chatId: chat._id,
      sourceMessageId: args.sourceMessageId,
      title: args.title.trim() || "Untitled deck",
      cards,
      createdAt: now,
      updatedAt: now,
      lastReviewedAt: undefined,
    });

    return { deckId, cardCount: cards.length, created: true };
  },
});

export const listDecks = query({
  args: {
    actorClerkId: v.string(),
    chatId: v.optional(v.id("chats")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const limit = Math.min(100, Math.max(1, args.limit ?? 50));
    const decks = await ctx.db
      .query("flashcardDecks")
      .withIndex("by_user_updated", (q) => q.eq("userId", actor._id))
      .collect();

    const now = Date.now();
    const filtered = decks
      .filter((deck) => (args.chatId ? deck.chatId === args.chatId : true))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);

    return await Promise.all(
      filtered.map(async (deck) => {
        let dueCount = 0;
        for (const card of deck.cards) {
          const progress = await ctx.db
            .query("flashcardProgress")
            .withIndex("by_user_card", (q) => q.eq("userId", actor._id).eq("cardHash", card.cardHash))
            .unique();
          if (!progress || progress.nextReviewAt <= now) {
            dueCount += 1;
          }
        }

        return {
          ...deck,
          dueCount,
          cardCount: deck.cards.length,
          nextReviewAt: dueCount > 0 ? now : undefined,
        };
      }),
    );
  },
});

export const getDueCards = query({
  args: {
    actorClerkId: v.string(),
    limit: v.optional(v.number()),
    deckId: v.optional(v.id("flashcardDecks")),
    includeAll: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const now = Date.now();
    const limit = Math.min(200, Math.max(1, args.limit ?? 50));
    const decks = await ctx.db
      .query("flashcardDecks")
      .withIndex("by_user_updated", (q) => q.eq("userId", actor._id))
      .collect();
    const scopedDecks = args.deckId ? decks.filter((deck) => deck._id === args.deckId) : decks;

    const out: Array<{
      deckId: string;
      deckTitle: string;
      chatId: string;
      front: string;
      back: string;
      cardHash: string;
      progress: {
        easeFactor: number;
        interval: number;
        repetitions: number;
        nextReviewAt: number;
      } | null;
    }> = [];

    for (const deck of scopedDecks) {
      for (const card of deck.cards) {
        const progress = await ctx.db
          .query("flashcardProgress")
          .withIndex("by_user_card", (q) => q.eq("userId", actor._id).eq("cardHash", card.cardHash))
          .unique();
        const isDue = !progress || progress.nextReviewAt <= now;
        if (isDue || args.includeAll) {
          out.push({
            deckId: deck._id,
            deckTitle: deck.title,
            chatId: deck.chatId,
            front: card.front,
            back: card.back,
            cardHash: card.cardHash,
            progress: progress
              ? {
                  easeFactor: progress.easeFactor,
                  interval: progress.interval,
                  repetitions: progress.repetitions,
                  nextReviewAt: progress.nextReviewAt,
                }
              : null,
          });
        }
      }
    }

    return out.slice(0, limit);
  },
});

export const getDeck = query({
  args: {
    actorClerkId: v.string(),
    deckId: v.id("flashcardDecks"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const deck = await ctx.db.get(args.deckId);
    if (!deck || deck.userId !== actor._id || deck.orgId !== actor.orgId) {
      throw new Error("Deck not found");
    }

    return deck;
  },
});

export const deleteDeck = mutation({
  args: {
    actorClerkId: v.string(),
    deckId: v.id("flashcardDecks"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const deck = await ctx.db.get(args.deckId);
    if (!deck || deck.userId !== actor._id || deck.orgId !== actor.orgId) {
      throw new Error("Deck not found");
    }

    await ctx.db.delete(deck._id);
    return { ok: true };
  },
});

export const rateCard = mutation({
  args: {
    actorClerkId: v.string(),
    cardHash: v.string(),
    quality: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const cardHash = args.cardHash.trim();
    if (!cardHash) throw new Error("Invalid card hash");

    const existing = await ctx.db
      .query("flashcardProgress")
      .withIndex("by_user_card", (q) => q.eq("userId", actor._id).eq("cardHash", cardHash))
      .unique();

    const next = calculateNextReview(
      args.quality,
      existing?.easeFactor ?? 2.5,
      existing?.interval ?? 0,
      existing?.repetitions ?? 0,
      Date.now(),
    );

    if (existing) {
      await ctx.db.patch(existing._id, {
        easeFactor: next.easeFactor,
        interval: next.interval,
        repetitions: next.repetitions,
        nextReviewAt: next.nextReviewAt,
      });
    } else {
      await ctx.db.insert("flashcardProgress", {
        userId: actor._id,
        orgId: actor.orgId,
        cardHash,
        easeFactor: next.easeFactor,
        interval: next.interval,
        repetitions: next.repetitions,
        nextReviewAt: next.nextReviewAt,
      });
    }

    const decks = await ctx.db
      .query("flashcardDecks")
      .withIndex("by_user_updated", (q) => q.eq("userId", actor._id))
      .collect();
    const touchedDeck = decks.find((deck) => deck.cards.some((card) => card.cardHash === cardHash));
    if (touchedDeck) {
      await ctx.db.patch(touchedDeck._id, {
        updatedAt: Date.now(),
        lastReviewedAt: Date.now(),
      });
    }

    return next;
  },
});
