import { z } from "zod";
import type { ArtifactBlueprint } from "../../core";
import {
  FLASHCARD_DECK_SCHEMA_VERSION,
  FLASHCARD_PRESETS,
} from "../../flashcards/model";

const schedulerSchema = z
  .object({
    preset: z.enum(["gentle", "balanced", "intensive"]),
    desiredRetention: z.number().min(0.7).max(0.97),
    newCardsPerDay: z.number().int().min(0).max(9_999),
    reviewsPerDay: z.number().int().min(0).max(99_999),
    learningStepsMinutes: z
      .array(z.number().int().min(1).max(43_200))
      .min(1)
      .max(8),
    relearningStepsMinutes: z
      .array(z.number().int().min(1).max(43_200))
      .min(1)
      .max(8),
    maximumIntervalDays: z.number().int().min(1).max(36_500),
    leechThreshold: z.number().int().min(2).max(64),
  })
  .passthrough();

export const flashcardDeckContentSchema = z
  .object({
    cards: z
      .array(
        z
          .object({
            id: z.string().trim().min(1),
            variant: z.enum(["basic", "cloze", "image_occlusion"]).optional(),
            front: z.string().max(100_000),
            back: z.string().max(100_000),
            hint: z.string().optional(),
            explanation: z.string().max(100_000).optional(),
            acceptedAlternatives: z
              .array(z.string().max(2_000))
              .max(50)
              .optional(),
            sourceRefs: z.array(z.string()).optional(),
            tags: z.array(z.string().trim().min(1).max(48)).max(50).optional(),
            confidence: z
              .enum(["unknown", "weak", "medium", "strong"])
              .optional(),
            difficulty: z.enum(["easy", "medium", "hard"]).optional(),
            learningObjective: z.string().max(2_000).optional(),
            language: z.string().max(80).optional(),
            bidirectional: z.boolean().optional(),
            media: z
              .object({
                assetId: z.string().trim().min(1),
                name: z.string().trim().min(1).max(240),
                mediaType: z.enum([
                  "image/png",
                  "image/jpeg",
                  "image/webp",
                  "image/gif",
                ]),
                altText: z.string().max(2_000).optional(),
                placement: z.enum(["front", "back"]).optional(),
              })
              .optional(),
            occlusions: z
              .array(
                z.object({
                  id: z.string().trim().min(1),
                  x: z.number().min(0).max(1),
                  y: z.number().min(0).max(1),
                  width: z.number().positive().max(1),
                  height: z.number().positive().max(1),
                  label: z.string().max(500).optional(),
                }),
              )
              .max(64)
              .optional(),
            section: z.string().trim().min(1).max(656).optional(),
          })
          .passthrough(),
      )
      .min(1),
    settings: z
      .object({
        shuffle: z.boolean().optional(),
        revealMode: z.enum(["click", "type"]).optional(),
        showHints: z.boolean().optional(),
        scheduler: schedulerSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const flashcardDeckBlueprint: ArtifactBlueprint = {
  key: "flashcard_deck",
  name: "Flashcard Deck",
  description: "A study deck stored as one artifact, regardless of card count.",
  version: FLASHCARD_DECK_SCHEMA_VERSION,
  schema: flashcardDeckContentSchema,
  defaultContent: {
    cards: [
      {
        id: "card-1",
        variant: "basic",
        front: "",
        back: "",
        section: "Section 1",
        confidence: "unknown",
        difficulty: "medium",
      },
    ],
    settings: {
      shuffle: true,
      revealMode: "click",
      showHints: true,
      scheduler: FLASHCARD_PRESETS.balanced,
    },
  },
  rendererKey: "flashcard_deck",
  operations: [
    "create",
    "generate_from_sources",
    "add_cards",
    "remove_cards",
    "improve_cards",
    "add_to_workspace",
  ],
  searchableFields: ["cards.front", "cards.back", "cards.hint"],
};
