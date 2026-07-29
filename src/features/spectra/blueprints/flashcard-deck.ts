import { z } from "zod";
import type { ArtifactBlueprint } from "../core";

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
            tags: z.array(z.string().trim().min(1).max(48)).max(8).optional(),
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
            section: z.string().optional(),
            review: z
              .object({
                state: z
                  .enum(["new", "learning", "review", "mastered"])
                  .optional(),
                correctStreak: z.number().int().min(0).optional(),
                lastReviewedAt: z.number().nullable().optional(),
                nextReviewAt: z.number().nullable().optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .min(1),
    settings: z
      .object({
        shuffle: z.boolean().optional(),
        revealMode: z.enum(["click", "type"]).optional(),
        showHints: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const flashcardDeckBlueprint: ArtifactBlueprint = {
  key: "flashcard_deck",
  name: "Flashcard Deck",
  description: "A study deck stored as one artifact, regardless of card count.",
  version: 3,
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
    settings: { shuffle: true, revealMode: "click" },
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
