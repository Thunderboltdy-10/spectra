import { z } from "zod";
import type { ArtifactEmbedInteraction } from "../../../../shared/artifact-embed";
import type { WorkCapability } from "../work/registry";
import type { CapabilityDefinition } from "./types";

const none = z.null();
const cardId = z.string().trim().min(1).max(180);
const cardIds = z.array(cardId).min(1).max(10_000);
const deckPath = z.string().trim().min(1).max(656);
const rating = z.enum(["again", "hard", "good", "easy"]);
const direction = z.enum(["forward", "reverse"]);
const occlusion = z
  .object({
    id: z.string().trim().min(1).max(180),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
    label: z.string().max(500).optional(),
  })
  .strict();

type FlashcardCapabilitySpec = {
  localId: string;
  description: string;
  params?: z.ZodType;
  requires?: WorkCapability;
  embed?: readonly ArtifactEmbedInteraction[];
  exposed?: boolean;
  risk?: CapabilityDefinition["ai"]["riskClass"];
  server?: boolean;
  manifestOperation?: string;
};

const FLASHCARD_SPECS: readonly FlashcardCapabilitySpec[] = [
  {
    localId: "add-card",
    description: "Add a basic card to a nested deck path.",
    params: z.object({ section: deckPath.optional() }).strict(),
    requires: "edit",
    exposed: true,
    manifestOperation: "flashcard_deck.add.cards",
  },
  {
    localId: "card.update",
    description: "Update typed authored fields on one flashcard.",
    params: z
      .object({
        cardId,
        front: z.string().max(100_000).optional(),
        back: z.string().max(100_000).optional(),
        section: deckPath.optional(),
        hint: z.string().max(100_000).optional(),
        explanation: z.string().max(100_000).optional(),
        bidirectional: z.boolean().optional(),
      })
      .strict(),
    requires: "edit",
    exposed: true,
    manifestOperation: "flashcard_deck.rewrite.side",
  },
  {
    localId: "card.duplicate",
    description: "Duplicate a card with a new stable id.",
    params: z.object({ cardId, newCardId: cardId }).strict(),
    requires: "edit",
    exposed: true,
  },
  {
    localId: "card.delete",
    description:
      "Delete one authored card while preserving personal study history.",
    params: z.object({ cardId }).strict(),
    requires: "edit",
    exposed: true,
    risk: "destructive",
    manifestOperation: "flashcard_deck.remove.cards",
  },
  {
    localId: "card.bulk-select",
    description: "Select cards for a deck-browser bulk action.",
    params: z.object({ cardIds: z.array(cardId).max(10_000) }).strict(),
    requires: "edit",
  },
  {
    localId: "card.bulk-update",
    description: "Apply a typed authored-field patch to selected cards.",
    params: z
      .object({
        cardIds,
        section: deckPath.optional(),
        difficulty: z.enum(["easy", "medium", "hard"]).optional(),
        hint: z.string().max(100_000).optional(),
        explanation: z.string().max(100_000).optional(),
        bidirectional: z.boolean().optional(),
      })
      .strict(),
    requires: "edit",
    exposed: true,
  },
  {
    localId: "card.bulk-delete",
    description: "Delete selected authored cards in one operation.",
    params: z.object({ cardIds }).strict(),
    requires: "edit",
    exposed: true,
    risk: "destructive",
    manifestOperation: "flashcard_deck.remove.cards",
  },
  {
    localId: "card.bulk-tag",
    description: "Add and remove normalized tags on selected cards.",
    params: z
      .object({
        cardIds,
        add: z.array(z.string().trim().min(1).max(48)).max(50).default([]),
        remove: z.array(z.string().trim().min(1).max(48)).max(50).default([]),
      })
      .strict(),
    requires: "edit",
    exposed: true,
    manifestOperation: "flashcard_deck.tag.cards",
  },
  ...(["concept", "language", "formula"] as const).map(
    (template): FlashcardCapabilitySpec => ({
      localId: `template-${template}`,
      description: `Add the ${template} card preset.`,
      params: z.object({ section: deckPath.optional() }).strict(),
      requires: "edit",
      exposed: true,
      manifestOperation: "flashcard_deck.add.cards",
    }),
  ),
  {
    localId: "cloze.insert",
    description:
      "Insert a numbered cloze deletion without flattening other deletions.",
    params: z
      .object({
        cardId,
        answer: z.string().min(1).max(10_000),
        index: z.number().int().min(1).max(99),
        hint: z.string().max(2_000).optional(),
      })
      .strict(),
    requires: "edit",
    exposed: true,
    manifestOperation: "flashcard_deck.create.cloze",
  },
  {
    localId: "cloze.hint",
    description: "Set the hint for one numbered cloze deletion.",
    params: z
      .object({
        cardId,
        index: z.number().int().min(1).max(99),
        hint: z.string().max(2_000),
      })
      .strict(),
    requires: "edit",
    exposed: true,
    manifestOperation: "flashcard_deck.create.cloze",
  },
  {
    localId: "hint.edit",
    description: "Set or clear a card-level hint.",
    params: z.object({ cardId, hint: z.string().max(100_000) }).strict(),
    requires: "edit",
    exposed: true,
    manifestOperation: "flashcard_deck.rewrite.side",
  },
  {
    localId: "explanation.edit",
    description: "Set or clear a card explanation.",
    params: z.object({ cardId, explanation: z.string().max(100_000) }).strict(),
    requires: "edit",
    exposed: true,
    manifestOperation: "flashcard_deck.rewrite.side",
  },
  {
    localId: "reverse.toggle",
    description: "Enable or disable a separately scheduled reverse direction.",
    params: z.object({ cardId, enabled: z.boolean() }).strict(),
    requires: "edit",
    exposed: true,
    manifestOperation: "flashcard_deck.set.bidirectional",
  },
  {
    localId: "occlusion.create",
    description:
      "Create an image-occlusion card against an existing image asset.",
    params: z
      .object({
        cardId,
        assetId: z.string().trim().min(1),
        altText: z.string().max(2_000),
        occlusions: z.array(occlusion).min(1).max(64),
      })
      .strict(),
    requires: "edit",
    exposed: true,
    manifestOperation: "flashcard_deck.set.image.occlusion",
  },
  {
    localId: "occlusion.update",
    description: "Replace the normalized mask set on an image-occlusion card.",
    params: z
      .object({ cardId, occlusions: z.array(occlusion).max(64) })
      .strict(),
    requires: "edit",
    exposed: true,
    manifestOperation: "flashcard_deck.set.image.occlusion",
  },
  { localId: "rail", description: "Show or hide the card browser rail." },
  {
    localId: "browse",
    description: "Read the authored deck without changing its schedule.",
  },
  {
    localId: "add-section",
    description: "Add a top-level deck section and its first card.",
    params: z.object({ name: deckPath.optional() }).strict(),
    requires: "edit",
    exposed: true,
  },
  {
    localId: "deck.child.create",
    description: "Create a nested child deck path.",
    params: z
      .object({ parent: deckPath, name: z.string().trim().min(1).max(80) })
      .strict(),
    requires: "edit",
    exposed: true,
  },
  {
    localId: "deck.child.move",
    description: "Move selected cards to a nested deck path.",
    params: z.object({ cardIds, section: deckPath }).strict(),
    requires: "edit",
    exposed: true,
  },
  {
    localId: "deck.child.rename",
    description: "Rename a nested deck branch and all descendants.",
    params: z.object({ from: deckPath, to: deckPath }).strict(),
    requires: "edit",
    exposed: true,
  },
  {
    localId: "tag.rename",
    description: "Rename a tag throughout the deck.",
    params: z
      .object({
        from: z.string().trim().min(1).max(48),
        to: z.string().trim().min(1).max(48),
      })
      .strict(),
    requires: "edit",
    exposed: true,
  },
  {
    localId: "tag.merge",
    description: "Merge several tags into one normalized destination.",
    params: z
      .object({
        from: z.array(z.string().trim().min(1).max(48)).min(1).max(50),
        to: z.string().trim().min(1).max(48),
      })
      .strict(),
    requires: "edit",
    exposed: true,
  },
  {
    localId: "deck.options",
    description:
      "Set the deck's FSRS-family retention, limits, steps, interval, and leech threshold.",
    params: z
      .object({
        desiredRetention: z.number().min(0.7).max(0.97).optional(),
        newCardsPerDay: z.number().int().min(0).max(9_999).optional(),
        reviewsPerDay: z.number().int().min(0).max(99_999).optional(),
        learningStepsMinutes: z
          .array(z.number().int().min(1).max(43_200))
          .min(1)
          .max(8)
          .optional(),
        relearningStepsMinutes: z
          .array(z.number().int().min(1).max(43_200))
          .min(1)
          .max(8)
          .optional(),
        maximumIntervalDays: z.number().int().min(1).max(36_500).optional(),
        leechThreshold: z.number().int().min(2).max(64).optional(),
      })
      .strict(),
    requires: "edit",
    exposed: true,
    manifestOperation: "flashcard_deck.configure.scheduler",
  },
  {
    localId: "deck.preset",
    description: "Apply a gentle, balanced, or intensive deck-options preset.",
    params: z.enum(["gentle", "balanced", "intensive"]),
    requires: "edit",
    exposed: true,
    manifestOperation: "flashcard_deck.configure.scheduler",
  },
  {
    localId: "study.start",
    description: "Start a private due-card session using this deck's limits.",
    params: z.object({ includeAhead: z.boolean().optional() }).strict(),
    requires: "attempt",
    embed: ["interact", "edit"],
  },
  {
    localId: "study.reveal",
    description: "Reveal the current card without changing its schedule.",
    requires: "interact",
    embed: ["interact", "edit"],
  },
  {
    localId: "study.navigate",
    description: "Move within the active private study session.",
    params: z.enum(["previous", "next"]),
    requires: "interact",
    embed: ["interact", "edit"],
  },
  {
    localId: "study.rate",
    description: "Rate recall and advance the private FSRS-family schedule.",
    params: z
      .object({
        cardId,
        direction,
        rating,
        clientReviewId: z.string().trim().min(8).max(180),
        elapsedMs: z.number().int().min(0).max(3_600_000).optional(),
      })
      .strict(),
    requires: "submit",
    server: true,
  },
  ...(["undo", "bury", "suspend", "resume", "reset"] as const).map(
    (action): FlashcardCapabilitySpec => ({
      localId: `study.${action}`,
      description: `${action[0]!.toUpperCase()}${action.slice(1)} a card's private study state.`,
      params: z.object({ cardId, direction }).strict(),
      requires: "submit",
      server: true,
      risk: action === "reset" ? "destructive" : "safe",
    }),
  ),
  {
    localId: "study.reschedule",
    description: "Assign a new due instant to one private card state.",
    params: z
      .object({ cardId, direction, nextDueAt: z.number().int().nonnegative() })
      .strict(),
    requires: "submit",
    server: true,
  },
  {
    localId: "study.leech",
    description: "Clear or suspend a leech in private study state.",
    params: z
      .object({ cardId, direction, action: z.enum(["clear", "suspend"]) })
      .strict(),
    requires: "submit",
    server: true,
  },
  {
    localId: "progress",
    description: "Open private progress and scheduling statistics.",
    requires: "submit",
  },
  ...(["retention", "forecast", "heatmap", "leeches"] as const).map(
    (statistic): FlashcardCapabilitySpec => ({
      localId: `stats.${statistic}`,
      description: `Inspect private ${statistic} statistics for this deck.`,
      params: none,
      requires: "submit",
      server: true,
    }),
  ),
  {
    localId: "stats.reset",
    description:
      "Clear all private scheduling and review history for this deck.",
    params: z.object({ confirmation: z.literal("RESET") }).strict(),
    requires: "submit",
    server: true,
    risk: "always-confirm",
  },
  {
    localId: "import",
    description:
      "Open copy import for CSV, TSV, text, APKG, or a Spectra package.",
    requires: "edit",
  },
  {
    localId: "import.preview",
    description:
      "Parse and preview a normalized copy import with adaptation warnings.",
    params: z
      .object({
        format: z.enum(["csv", "tsv", "text", "apkg", "spectra-package"]),
        bytes: z.number().int().nonnegative(),
      })
      .strict(),
    requires: "edit",
    manifestOperation: "flashcard_deck.import.preview",
  },
  {
    localId: "import.commit",
    description:
      "Commit a reviewed card import by appending or replacing authored cards.",
    params: z
      .object({
        mode: z.enum(["append", "replace"]),
        cardCount: z.number().int().min(1).max(100_000),
      })
      .strict(),
    requires: "edit",
    risk: "confirm",
    manifestOperation: "flashcard_deck.import.commit",
  },
  ...(["csv", "tsv"] as const).map((format): FlashcardCapabilitySpec => ({
    localId: `export-${format}`,
    description: `Export authored cards as UTF-8 ${format.toUpperCase()}.`,
    manifestOperation: `flashcard_deck.export.${format}`,
  })),
  {
    localId: "export-package",
    description: "Export a versioned Spectra portable deck copy.",
    manifestOperation: "flashcard_deck.export.package",
  },
  {
    localId: "print",
    description: "Open the deck print layout for printing or Save as PDF.",
    manifestOperation: "flashcard_deck.print",
  },
];

const FIELD_FORMAT_LOCAL_IDS = [
  "format.bold",
  "format.italic",
  "format.underline",
  "format.strike",
  "format.bulletList",
  "format.orderedList",
  "format.quote",
  "format.code",
  "insert.link",
  "insert.equation",
  "insert.blockEquation",
] as const;

const formatSpecs: readonly FlashcardCapabilitySpec[] =
  FIELD_FORMAT_LOCAL_IDS.map((localId) => ({
    localId,
    description: `Apply ${localId.replaceAll(".", " ")} to the focused card field.`,
    requires: "edit",
  }));

function capabilityId(localId: string) {
  return `flashcard_deck.${localId.replaceAll(/[^a-zA-Z0-9]+/g, ".")}` as const;
}

export const FLASHCARD_CAPABILITIES: readonly CapabilityDefinition<"flashcard_deck">[] =
  [...FLASHCARD_SPECS, ...formatSpecs].map((spec) => {
    const id = capabilityId(spec.localId);
    return {
      id,
      params: spec.params ?? none,
      scope: "artifact",
      availability: (ctx) => {
        if (spec.requires && !ctx.can(spec.requires))
          return { state: "hidden" as const };
        return { state: "enabled" as const };
      },
      execute: spec.server ? { server: id } : { editor: id },
      ai: {
        exposed: spec.exposed ?? false,
        description: spec.description,
        riskClass: spec.risk ?? "safe",
      },
      choreography: { target: "workbar-command", region: id },
      ...(spec.embed ? { embed: { levels: spec.embed } } : {}),
      ...(spec.requires ? { requires: spec.requires } : {}),
      ...(spec.manifestOperation
        ? { manifestOperation: spec.manifestOperation }
        : {}),
    } satisfies CapabilityDefinition<"flashcard_deck">;
  });

export function flashcardCapability(localId: string) {
  const id = capabilityId(localId);
  const definition = FLASHCARD_CAPABILITIES.find(
    (candidate) => candidate.id === id,
  );
  if (!definition) throw new Error(`FLASHCARD_CAPABILITY_MISSING: ${id}`);
  return definition;
}
