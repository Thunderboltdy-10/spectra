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

function isAppendFlashcardRequest(value: string) {
  const normalized = value.toLowerCase();
  return /\b(add|append|more|extra|another|new)\b[\s\S]{0,40}\b(card|cards|flashcard|flashcards|deck)\b/.test(normalized)
    || /\bcontinue\b[\s\S]{0,20}\b(deck|flashcards?)\b/.test(normalized);
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
    let appendIntent = false;

    if (args.sourceMessageId) {
      const sourceMessage = await ctx.db.get(args.sourceMessageId);
      if (sourceMessage && sourceMessage.chatId === chat._id && sourceMessage.role === "assistant") {
        const history = await ctx.db
          .query("messages")
          .withIndex("by_chat", (q) => q.eq("chatId", chat._id))
          .collect();
        const sorted = history.sort((a, b) => a.createdAt - b.createdAt);
        const sourceIndex = sorted.findIndex((row) => row._id === sourceMessage._id);
        for (let i = sourceIndex - 1; i >= 0; i -= 1) {
          const row = sorted[i];
          if (row?.role !== "user") continue;
          appendIntent = isAppendFlashcardRequest(row.content);
          break;
        }
      }
    }

    if (appendIntent) {
      const latestDeck = await ctx.db
        .query("flashcardDecks")
        .withIndex("by_chat_updated", (q) => q.eq("chatId", chat._id))
        .order("desc")
        .first();
      if (latestDeck && latestDeck.userId === actor._id && latestDeck.orgId === actor.orgId) {
        const existingHashes = new Set(latestDeck.cards.map((card) => card.cardHash));
        const appendedCards = cards.filter((card) => !existingHashes.has(card.cardHash));
        const mergedCards = appendedCards.length > 0 ? [...latestDeck.cards, ...appendedCards] : latestDeck.cards;
        await ctx.db.patch(latestDeck._id, {
          title: latestDeck.title || args.title.trim() || "Untitled deck",
          sourceMessageId: args.sourceMessageId ?? latestDeck.sourceMessageId,
          cards: mergedCards,
          updatedAt: now,
        });
        return {
          deckId: latestDeck._id,
          cardCount: mergedCards.length,
          appended: appendedCards.length,
          updated: true,
        };
      }
    }

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

export const getLatestDeckForChat = query({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.ownerUserId !== actor._id || chat.orgId !== actor.orgId || chat.deletedAt) {
      throw new Error("Chat not found");
    }

    const deck = await ctx.db
      .query("flashcardDecks")
      .withIndex("by_chat_updated", (q) => q.eq("chatId", chat._id))
      .order("desc")
      .first();
    if (!deck || deck.userId !== actor._id || deck.orgId !== actor.orgId) {
      return null;
    }

    return deck;
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

export const editCard = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
    cardHash: v.string(),
    front: v.string(),
    back: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.ownerUserId !== actor._id || chat.orgId !== actor.orgId || chat.deletedAt) {
      throw new Error("Chat not found");
    }

    const cardHash = args.cardHash.trim();
    const front = args.front.trim();
    const back = args.back.trim();
    if (!cardHash || !front || !back) {
      throw new Error("Invalid flashcard payload");
    }

    const decks = await ctx.db
      .query("flashcardDecks")
      .withIndex("by_chat_updated", (q) => q.eq("chatId", chat._id))
      .collect();
    const scoped = decks
      .filter((deck) => deck.userId === actor._id && deck.orgId === actor.orgId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const target = scoped.find((deck) => deck.cards.some((card) => card.cardHash === cardHash));
    if (!target) {
      throw new Error("Deck not found");
    }

    const nextCards = target.cards.map((card) =>
      card.cardHash === cardHash
        ? {
            ...card,
            front,
            back,
          }
        : card,
    );
    await ctx.db.patch(target._id, {
      cards: nextCards,
      updatedAt: Date.now(),
    });

    return { ok: true, deckId: target._id };
  },
});
