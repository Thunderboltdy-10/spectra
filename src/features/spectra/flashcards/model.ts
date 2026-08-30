export const FLASHCARD_DECK_SCHEMA_VERSION = 4;

export type FlashcardVariant = "basic" | "cloze" | "image_occlusion";
export type FlashcardDifficulty = "easy" | "medium" | "hard";
export type FlashcardConfidence = "unknown" | "weak" | "medium" | "strong";
export type FlashcardDeckPreset = "gentle" | "balanced" | "intensive";

export type FlashcardOcclusion = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
};

export type FlashcardCard = {
  id: string;
  variant?: FlashcardVariant;
  front: string;
  back: string;
  hint?: string;
  explanation?: string;
  acceptedAlternatives?: string[];
  section?: string;
  confidence?: FlashcardConfidence;
  difficulty?: FlashcardDifficulty;
  learningObjective?: string;
  language?: string;
  bidirectional?: boolean;
  media?: {
    assetId: string;
    name: string;
    mediaType: string;
    altText?: string;
    placement?: "front" | "back";
  };
  occlusions?: FlashcardOcclusion[];
  sourceRefs?: string[];
  tags?: string[];
  [key: string]: unknown;
};

export type FlashcardSchedulerOptions = {
  preset: FlashcardDeckPreset;
  desiredRetention: number;
  newCardsPerDay: number;
  reviewsPerDay: number;
  learningStepsMinutes: number[];
  relearningStepsMinutes: number[];
  maximumIntervalDays: number;
  leechThreshold: number;
};

export type FlashcardDeckSettings = {
  shuffle: boolean;
  revealMode: "click" | "type";
  showHints: boolean;
  scheduler: FlashcardSchedulerOptions;
  [key: string]: unknown;
};

export type FlashcardDeckContent = {
  cards: FlashcardCard[];
  settings: FlashcardDeckSettings;
  [key: string]: unknown;
};

export const FLASHCARD_PRESETS: Readonly<
  Record<FlashcardDeckPreset, FlashcardSchedulerOptions>
> = {
  gentle: {
    preset: "gentle",
    desiredRetention: 0.86,
    newCardsPerDay: 10,
    reviewsPerDay: 100,
    learningStepsMinutes: [1, 10],
    relearningStepsMinutes: [10],
    maximumIntervalDays: 36_500,
    leechThreshold: 8,
  },
  balanced: {
    preset: "balanced",
    desiredRetention: 0.9,
    newCardsPerDay: 20,
    reviewsPerDay: 200,
    learningStepsMinutes: [1, 10],
    relearningStepsMinutes: [10],
    maximumIntervalDays: 36_500,
    leechThreshold: 8,
  },
  intensive: {
    preset: "intensive",
    desiredRetention: 0.94,
    newCardsPerDay: 40,
    reviewsPerDay: 400,
    learningStepsMinutes: [1, 6],
    relearningStepsMinutes: [5],
    maximumIntervalDays: 18_250,
    leechThreshold: 6,
  },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function bounded(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const number =
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function integer(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  return Math.round(bounded(value, fallback, minimum, maximum));
}

function numberList(value: unknown, fallback: readonly number[]) {
  const source = Array.isArray(value) ? value : fallback;
  const normalized = source
    .flatMap((entry) =>
      typeof entry === "number" && Number.isFinite(entry)
        ? [Math.max(1, Math.min(43_200, Math.round(entry)))]
        : [],
    )
    .slice(0, 8);
  return normalized.length ? normalized : [...fallback];
}

function stringList(value: unknown, maximum: number, itemMaximum = 2_000) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const item = entry.trim().slice(0, itemMaximum);
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key) || seen.size >= maximum) return [];
    seen.add(key);
    return [item];
  });
}

/** Anki's `Parent::Child` syntax is also Spectra's portable nested-deck path. */
export function normalizeFlashcardDeckPath(
  value: unknown,
  fallback = "Section 1",
) {
  const source = text(value, fallback)
    .replaceAll(/\s*(?:\/|\\|>{1,2})\s*/g, "::")
    .split("::")
    .map((part) => part.trim().replaceAll(/\s+/g, " ").slice(0, 80))
    .filter(Boolean)
    .slice(0, 8)
    .join("::");
  return source || fallback;
}

export function normalizeFlashcardSchedulerOptions(
  value: unknown,
): FlashcardSchedulerOptions {
  const source = asRecord(value);
  const preset: FlashcardDeckPreset =
    source.preset === "gentle" || source.preset === "intensive"
      ? source.preset
      : "balanced";
  const defaults = FLASHCARD_PRESETS[preset];
  return {
    preset,
    desiredRetention: bounded(
      source.desiredRetention,
      defaults.desiredRetention,
      0.7,
      0.97,
    ),
    newCardsPerDay: integer(
      source.newCardsPerDay,
      defaults.newCardsPerDay,
      0,
      9_999,
    ),
    reviewsPerDay: integer(
      source.reviewsPerDay,
      defaults.reviewsPerDay,
      0,
      99_999,
    ),
    learningStepsMinutes: numberList(
      source.learningStepsMinutes,
      defaults.learningStepsMinutes,
    ),
    relearningStepsMinutes: numberList(
      source.relearningStepsMinutes,
      defaults.relearningStepsMinutes,
    ),
    maximumIntervalDays: integer(
      source.maximumIntervalDays,
      defaults.maximumIntervalDays,
      1,
      36_500,
    ),
    leechThreshold: integer(
      source.leechThreshold,
      defaults.leechThreshold,
      2,
      64,
    ),
  };
}

function normalizeOcclusions(value: unknown, cardIndex: number) {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry, maskIndex): FlashcardOcclusion[] => {
      const mask = asRecord(entry);
      const rawX = Number(mask.x);
      const rawY = Number(mask.y);
      const rawWidth = Number(mask.width);
      const rawHeight = Number(mask.height);
      if (
        ![rawX, rawY, rawWidth, rawHeight].every(Number.isFinite) ||
        rawWidth <= 0 ||
        rawHeight <= 0
      )
        return [];
      const x = Math.max(0, Math.min(0.99, rawX));
      const y = Math.max(0, Math.min(0.99, rawY));
      return [
        {
          id: text(mask.id, `mask-${cardIndex + 1}-${maskIndex + 1}`).trim(),
          x,
          y,
          width: Math.max(0.01, Math.min(1 - x, rawWidth)),
          height: Math.max(0.01, Math.min(1 - y, rawHeight)),
          ...(typeof mask.label === "string"
            ? { label: mask.label.slice(0, 500) }
            : {}),
        },
      ];
    })
    .slice(0, 64);
}

function normalizeCard(value: unknown, index: number): FlashcardCard {
  const source = asRecord(value);
  const media = asRecord(source.media);
  const variant: FlashcardVariant =
    source.variant === "cloze" || source.variant === "image_occlusion"
      ? source.variant
      : "basic";
  const card: FlashcardCard = {
    ...source,
    id: text(source.id, `card-${index + 1}`).trim() || `card-${index + 1}`,
    variant,
    front: text(
      source.front,
      text(source.question, text(source.term, text(source.title))),
    ).trim(),
    back: text(
      source.back,
      text(source.answer, text(source.definition, text(source.explanation))),
    ).trim(),
    hint: text(source.hint, text(source.cue)).slice(0, 100_000),
    explanation: text(source.explanation).slice(0, 100_000),
    acceptedAlternatives: stringList(source.acceptedAlternatives, 50),
    section: normalizeFlashcardDeckPath(source.section ?? source.group),
    confidence:
      source.confidence === "weak" ||
      source.confidence === "medium" ||
      source.confidence === "strong"
        ? source.confidence
        : "unknown",
    difficulty:
      source.difficulty === "easy" || source.difficulty === "hard"
        ? source.difficulty
        : "medium",
    learningObjective: text(source.learningObjective).slice(0, 2_000),
    language: text(source.language).slice(0, 80),
    bidirectional: variant === "basic" && source.bidirectional === true,
    occlusions:
      variant === "image_occlusion"
        ? normalizeOcclusions(source.occlusions, index)
        : [],
    sourceRefs: stringList(source.sourceRefs, 100),
    tags: stringList(source.tags, 50, 48),
  };
  if (
    typeof media.assetId === "string" &&
    typeof media.name === "string" &&
    typeof media.mediaType === "string"
  ) {
    card.media = {
      assetId: media.assetId.trim(),
      name: media.name.trim().slice(0, 240),
      mediaType: media.mediaType,
      altText: text(media.altText).slice(0, 2_000),
      placement: media.placement === "back" ? "back" : "front",
    };
  } else {
    delete card.media;
  }
  // These legacy fields are personal state. They must never survive in the
  // collaborative authored deck (§11B).
  delete card.review;
  delete card.studyState;
  delete card.progress;
  return card;
}

function ensureUniqueCardIds(cards: FlashcardCard[]) {
  const seen = new Set<string>();
  return cards.map((card, index) => {
    const root = card.id || `card-${index + 1}`;
    let id = root;
    let suffix = 2;
    while (seen.has(id)) id = `${root}-${suffix++}`;
    seen.add(id);
    return id === card.id ? card : { ...card, id };
  });
}

/**
 * Deterministic v1-v3 to v4 normalization. It is deliberately idempotent so
 * collaboration, AI, import, and schema validation can all use the same path.
 */
export function normalizeFlashcardDeckContent(
  value: unknown,
): FlashcardDeckContent {
  const source = asRecord(value);
  const incomingCards = Array.isArray(source.cards) ? source.cards : [];
  const cards = ensureUniqueCardIds(incomingCards.map(normalizeCard));
  const settings = asRecord(source.settings);
  return {
    ...source,
    cards: cards.length
      ? cards
      : [
          normalizeCard(
            {
              id: "card-1",
              front: "",
              back: "",
              section: "Section 1",
            },
            0,
          ),
        ],
    settings: {
      ...settings,
      shuffle: settings.shuffle !== false,
      revealMode: settings.revealMode === "type" ? "type" : "click",
      showHints: settings.showHints !== false,
      scheduler: normalizeFlashcardSchedulerOptions(settings.scheduler),
    },
  };
}

export function flashcardDeckPaths(content: FlashcardDeckContent) {
  return [
    ...new Set(
      content.cards.map((card) => normalizeFlashcardDeckPath(card.section)),
    ),
  ];
}
