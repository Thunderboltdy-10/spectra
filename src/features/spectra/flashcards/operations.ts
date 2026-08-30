import {
  FLASHCARD_PRESETS,
  normalizeFlashcardDeckContent,
  normalizeFlashcardDeckPath,
  normalizeFlashcardSchedulerOptions,
  type FlashcardCard,
  type FlashcardDeckContent,
  type FlashcardDeckPreset,
  type FlashcardDifficulty,
  type FlashcardOcclusion,
  type FlashcardSchedulerOptions,
} from "./model";

export type FlashcardBulkPatch = Partial<
  Pick<
    FlashcardCard,
    "section" | "difficulty" | "hint" | "explanation" | "bidirectional"
  >
>;

function uniqueId(cards: readonly FlashcardCard[], requested: string) {
  const ids = new Set(cards.map((card) => card.id));
  let candidate = requested;
  let suffix = 2;
  while (ids.has(candidate)) candidate = `${requested}-${suffix++}`;
  return candidate;
}

function selected(ids: readonly string[]) {
  return new Set(ids.map((id) => id.trim()).filter(Boolean));
}

export function updateFlashcard(
  value: unknown,
  cardId: string,
  patch: Partial<FlashcardCard>,
) {
  const deck = normalizeFlashcardDeckContent(value);
  return normalizeFlashcardDeckContent({
    ...deck,
    cards: deck.cards.map((card) =>
      card.id === cardId ? { ...card, ...patch, id: card.id } : card,
    ),
  });
}

export function duplicateFlashcard(
  value: unknown,
  cardId: string,
  requestedId: string,
) {
  const deck = normalizeFlashcardDeckContent(value);
  const index = deck.cards.findIndex((card) => card.id === cardId);
  if (index < 0) return deck;
  const source = deck.cards[index]!;
  const duplicate = structuredClone(source);
  duplicate.id = uniqueId(
    deck.cards,
    requestedId.trim() || `${source.id}-copy`,
  );
  const cards = [...deck.cards];
  cards.splice(index + 1, 0, duplicate);
  return { ...deck, cards };
}

export function deleteFlashcards(value: unknown, cardIds: readonly string[]) {
  const deck = normalizeFlashcardDeckContent(value);
  const ids = selected(cardIds);
  const cards = deck.cards.filter((card) => !ids.has(card.id));
  return normalizeFlashcardDeckContent({ ...deck, cards });
}

export function bulkUpdateFlashcards(
  value: unknown,
  cardIds: readonly string[],
  patch: FlashcardBulkPatch,
) {
  const deck = normalizeFlashcardDeckContent(value);
  const ids = selected(cardIds);
  const normalizedPatch = {
    ...patch,
    ...(patch.section !== undefined
      ? { section: normalizeFlashcardDeckPath(patch.section) }
      : {}),
  };
  return normalizeFlashcardDeckContent({
    ...deck,
    cards: deck.cards.map((card) =>
      ids.has(card.id) ? { ...card, ...normalizedPatch } : card,
    ),
  });
}

export function bulkTagFlashcards(
  value: unknown,
  cardIds: readonly string[],
  add: readonly string[],
  remove: readonly string[],
) {
  const deck = normalizeFlashcardDeckContent(value);
  const ids = selected(cardIds);
  const removals = new Set(remove.map((tag) => tag.trim().toLocaleLowerCase()));
  return normalizeFlashcardDeckContent({
    ...deck,
    cards: deck.cards.map((card) => {
      if (!ids.has(card.id)) return card;
      return {
        ...card,
        tags: [
          ...(card.tags ?? []).filter(
            (tag) => !removals.has(tag.toLocaleLowerCase()),
          ),
          ...add,
        ],
      };
    }),
  });
}

export function insertFlashcardCloze(
  value: unknown,
  cardId: string,
  answer: string,
  index: number,
  hint = "",
) {
  const deck = normalizeFlashcardDeckContent(value);
  const target = deck.cards.find((card) => card.id === cardId);
  if (!target) return deck;
  const safeIndex = Math.max(1, Math.min(99, Math.round(index)));
  const selectedAnswer = answer.trim() || "answer";
  const marker = `{{c${safeIndex}::${selectedAnswer}${hint.trim() ? `::${hint.trim()}` : ""}}}`;
  const front = target.front.includes(selectedAnswer)
    ? target.front.replace(selectedAnswer, marker)
    : `${target.front}${target.front ? " " : ""}${marker}`;
  return updateFlashcard(deck, cardId, {
    variant: "cloze",
    bidirectional: false,
    front,
  });
}

export function setFlashcardClozeHint(
  value: unknown,
  cardId: string,
  index: number,
  hint: string,
) {
  const deck = normalizeFlashcardDeckContent(value);
  const card = deck.cards.find((entry) => entry.id === cardId);
  if (!card) return deck;
  const pattern = new RegExp(
    `\\{\\{c${Math.max(1, Math.round(index))}::([\\s\\S]*?)(?:::(.*?))?\\}\\}`,
    "gi",
  );
  return updateFlashcard(deck, cardId, {
    front: card.front.replace(
      pattern,
      (_source, answer: string) =>
        `{{c${Math.max(1, Math.round(index))}::${answer}${hint.trim() ? `::${hint.trim()}` : ""}}}`,
    ),
  });
}

export function setFlashcardOcclusions(
  value: unknown,
  cardId: string,
  occlusions: readonly FlashcardOcclusion[],
) {
  return updateFlashcard(value, cardId, {
    variant: "image_occlusion",
    bidirectional: false,
    occlusions: [...occlusions],
  });
}

export function createNestedFlashcardDeck(
  value: unknown,
  parent: string,
  name: string,
  requestedCardId: string,
) {
  const deck = normalizeFlashcardDeckContent(value);
  const section = normalizeFlashcardDeckPath(
    `${normalizeFlashcardDeckPath(parent)}::${name}`,
  );
  return {
    ...deck,
    cards: [
      ...deck.cards,
      {
        id: uniqueId(deck.cards, requestedCardId || "card"),
        variant: "basic" as const,
        front: "",
        back: "",
        section,
        confidence: "unknown" as const,
        difficulty: "medium" as const,
      },
    ],
  };
}

export function renameFlashcardDeckPath(
  value: unknown,
  from: string,
  to: string,
) {
  const deck = normalizeFlashcardDeckContent(value);
  const source = normalizeFlashcardDeckPath(from);
  const destination = normalizeFlashcardDeckPath(to);
  return normalizeFlashcardDeckContent({
    ...deck,
    cards: deck.cards.map((card) => {
      const path = normalizeFlashcardDeckPath(card.section);
      if (path !== source && !path.startsWith(`${source}::`)) return card;
      return { ...card, section: `${destination}${path.slice(source.length)}` };
    }),
  });
}

export function renameFlashcardTag(value: unknown, from: string, to: string) {
  return mergeFlashcardTags(value, [from], to);
}

export function mergeFlashcardTags(
  value: unknown,
  from: readonly string[],
  to: string,
) {
  const deck = normalizeFlashcardDeckContent(value);
  const sources = new Set(from.map((tag) => tag.trim().toLocaleLowerCase()));
  return normalizeFlashcardDeckContent({
    ...deck,
    cards: deck.cards.map((card) => ({
      ...card,
      tags: [
        ...(card.tags ?? []).filter(
          (tag) => !sources.has(tag.toLocaleLowerCase()),
        ),
        ...(to.trim() &&
        (card.tags ?? []).some((tag) => sources.has(tag.toLocaleLowerCase()))
          ? [to.trim()]
          : []),
      ],
    })),
  });
}

export function applyFlashcardDeckPreset(
  value: unknown,
  preset: FlashcardDeckPreset,
) {
  const deck = normalizeFlashcardDeckContent(value);
  return {
    ...deck,
    settings: { ...deck.settings, scheduler: { ...FLASHCARD_PRESETS[preset] } },
  } satisfies FlashcardDeckContent;
}

export function updateFlashcardDeckOptions(
  value: unknown,
  patch: Partial<FlashcardSchedulerOptions>,
) {
  const deck = normalizeFlashcardDeckContent(value);
  return {
    ...deck,
    settings: {
      ...deck.settings,
      scheduler: normalizeFlashcardSchedulerOptions({
        ...deck.settings.scheduler,
        ...patch,
      }),
    },
  } satisfies FlashcardDeckContent;
}

export function setFlashcardDifficulty(
  value: unknown,
  cardIds: readonly string[],
  difficulty: FlashcardDifficulty,
) {
  return bulkUpdateFlashcards(value, cardIds, { difficulty });
}
