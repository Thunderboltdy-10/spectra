import { z } from "zod";
import type { ArtifactBlueprint } from "../core";

export const flashcardDeckContentSchema = z.object({
  cards: z.array(z.object({
    id: z.string(),
    front: z.string(),
    back: z.string(),
    hint: z.string().optional(),
    sourceRefs: z.array(z.string()).optional(),
    confidence: z.enum(["unknown", "weak", "medium", "strong"]).optional(),
  })),
  settings: z.object({
    shuffle: z.boolean().optional(),
    revealMode: z.enum(["click", "type"]).optional(),
  }).optional(),
});

export const flashcardDeckBlueprint: ArtifactBlueprint = {
  key: "flashcard_deck",
  name: "Flashcard Deck",
  description: "A study deck stored as one artifact, regardless of card count.",
  version: 1,
  schema: flashcardDeckContentSchema,
  defaultContent: {
    cards: [],
    settings: { shuffle: true, revealMode: "click" },
  },
  rendererKey: "flashcard_deck",
  operations: ["create", "generate_from_sources", "add_cards", "remove_cards", "improve_cards", "add_to_workspace"],
  searchableFields: ["cards.front", "cards.back", "cards.hint"],
};

