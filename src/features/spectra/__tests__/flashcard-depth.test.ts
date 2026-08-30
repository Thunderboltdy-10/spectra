import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { flashcardDeckBlueprint } from "../artifacts/schema/flashcard-deck";
import { requireArtifactTypeManifest } from "../artifacts/registry";
import {
  FLASHCARD_CAPABILITIES,
  flashcardCapability,
} from "../capabilities/studio-flashcards";
import {
  FSRS_ALGORITHM,
  FSRS_ALGORITHM_VERSION,
  previewFsrsRatings,
  scheduleFsrsReview,
} from "../flashcards/fsrs";
import {
  FLASHCARD_DECK_SCHEMA_VERSION,
  FLASHCARD_PRESETS,
  normalizeFlashcardDeckContent,
} from "../flashcards/model";
import {
  bulkTagFlashcards,
  createNestedFlashcardDeck,
  insertFlashcardCloze,
  mergeFlashcardTags,
  renameFlashcardDeckPath,
} from "../flashcards/operations";
import { planWorkbarOverflow } from "../components/workbar-overflow";

describe("P12.I2 flashcard depth", () => {
  it("moves the complete typed capability baseline into the per-type IR", () => {
    expect(FLASHCARD_CAPABILITIES).toHaveLength(63);
    expect(new Set(FLASHCARD_CAPABILITIES.map((entry) => entry.id)).size).toBe(
      63,
    );
    expect(
      FLASHCARD_CAPABILITIES.every(
        (entry) => entry.execute.editor || entry.execute.server,
      ),
    ).toBe(true);
    expect(
      FLASHCARD_CAPABILITIES.filter((entry) => entry.ai.exposed).length,
    ).toBeGreaterThan(20);

    for (const localId of [
      "card.bulk-update",
      "cloze.hint",
      "occlusion.update",
      "deck.child.rename",
      "deck.options",
      "study.rate",
      "study.leech",
      "stats.retention",
      "stats.forecast",
      "stats.heatmap",
      "import.preview",
      "import.commit",
      "export-package",
    ]) {
      expect(flashcardCapability(localId).id).toBe(
        `flashcard_deck.${localId.replaceAll(/[^a-zA-Z0-9]+/g, ".")}`,
      );
    }
    expect(
      flashcardCapability("deck.options").params.safeParse({
        desiredRetention: 1.2,
      }).success,
    ).toBe(false);
    expect(
      flashcardCapability("study.rate").params.safeParse({
        cardId: "c1",
        direction: "forward",
        rating: "perfect",
        clientReviewId: "review-123",
      }).success,
    ).toBe(false);

    const manifest = requireArtifactTypeManifest("flashcard_deck");
    expect(manifest.schemas.currentVersion).toBe(FLASHCARD_DECK_SCHEMA_VERSION);
    expect(
      FLASHCARD_CAPABILITIES.flatMap((entry) =>
        entry.manifestOperation ? [entry.manifestOperation] : [],
      ).every((operation) => manifest.operations.includes(operation)),
    ).toBe(true);
  });

  it("uses deterministic FSRS-family transitions with monotonic rating intervals", () => {
    const now = Date.UTC(2026, 7, 30, 9);
    const options = FLASHCARD_PRESETS.balanced;
    const first = previewFsrsRatings(null, now, options);
    expect(first.again.nextDueAt).toBeLessThan(first.hard.nextDueAt);
    expect(first.hard.nextDueAt).toBeLessThan(first.good.nextDueAt);
    expect(first.good.nextDueAt).toBeLessThan(first.easy.nextDueAt);

    const state = {
      attempts: 12,
      stabilityDays: 24,
      difficulty: 5.2,
      lapses: 1,
      lastReviewedAt: now - 8 * 86_400_000,
      memoryState: "review" as const,
      learningStep: 0,
    };
    const projected = previewFsrsRatings(state, now, options);
    expect(projected.again.nextDueAt).toBeLessThan(projected.hard.nextDueAt);
    expect(projected.hard.nextDueAt).toBeLessThan(projected.good.nextDueAt);
    expect(projected.good.nextDueAt).toBeLessThan(projected.easy.nextDueAt);
    expect(projected.good.algorithm).toBe(FSRS_ALGORITHM);
    expect(projected.good.algorithmVersion).toBe(FSRS_ALGORITHM_VERSION);
    expect(scheduleFsrsReview(state, "good", now, options)).toEqual(
      scheduleFsrsReview(state, "good", now, options),
    );
  });

  it("shortens intervals for higher desired retention and derives leeches from lapses", () => {
    const now = Date.UTC(2026, 7, 30, 9);
    const state = {
      attempts: 20,
      stabilityDays: 50,
      difficulty: 6,
      lapses: 5,
      lastReviewedAt: now - 25 * 86_400_000,
      memoryState: "review" as const,
    };
    const lower = scheduleFsrsReview(state, "good", now, {
      ...FLASHCARD_PRESETS.balanced,
      desiredRetention: 0.82,
    });
    const higher = scheduleFsrsReview(state, "good", now, {
      ...FLASHCARD_PRESETS.balanced,
      desiredRetention: 0.95,
    });
    expect(higher.scheduledDays).toBeLessThan(lower.scheduledDays);

    const leech = scheduleFsrsReview(
      { ...state, lapses: 7 },
      "again",
      now,
      FLASHCARD_PRESETS.balanced,
    );
    expect(leech.lapses).toBe(8);
    expect(leech.leech).toBe(true);
    expect(leech.memoryState).toBe("relearning");
  });

  it("migrates legacy decks to deterministic v4 content without shared study state", () => {
    const legacy = {
      cards: [
        {
          id: "same",
          term: "ATP",
          definition: "Energy carrier",
          group: "Biology / Cells",
          tags: ["Exam", "exam", " metabolism "],
          review: { nextReviewAt: 123 },
        },
        { id: "same", question: "Where?", answer: "Mitochondria" },
      ],
      settings: { shuffle: false },
    };
    const migrated = normalizeFlashcardDeckContent(legacy);
    expect(migrated.cards.map((card) => card.id)).toEqual(["same", "same-2"]);
    expect(migrated.cards[0]).toMatchObject({
      front: "ATP",
      back: "Energy carrier",
      section: "Biology::Cells",
      tags: ["Exam", "metabolism"],
    });
    expect(migrated.cards[0]).not.toHaveProperty("review");
    expect(migrated.settings.scheduler).toEqual(FLASHCARD_PRESETS.balanced);
    expect(normalizeFlashcardDeckContent(migrated)).toEqual(migrated);
    expect(flashcardDeckBlueprint.version).toBe(FLASHCARD_DECK_SCHEMA_VERSION);
  });

  it("applies nested-deck, bulk-tag, and multi-cloze operations without touching other cards", () => {
    const base = normalizeFlashcardDeckContent({
      cards: [
        {
          id: "a",
          front: "Water moves by osmosis",
          back: "Across a membrane",
          section: "Biology",
          tags: ["old"],
        },
        { id: "b", front: "ATP", back: "Energy", section: "Biology", tags: [] },
      ],
    });
    const child = createNestedFlashcardDeck(base, "Biology", "Cells", "c");
    expect(child.cards.at(-1)).toMatchObject({
      id: "c",
      section: "Biology::Cells",
    });
    const renamed = renameFlashcardDeckPath(child, "Biology", "Life science");
    expect(
      renamed.cards.every((card) => card.section?.startsWith("Life science")),
    ).toBe(true);
    const tagged = bulkTagFlashcards(renamed, ["a", "b"], ["exam"], ["old"]);
    const merged = mergeFlashcardTags(tagged, ["exam"], "final");
    expect(merged.cards.find((card) => card.id === "a")?.tags).toEqual([
      "final",
    ]);
    expect(merged.cards.find((card) => card.id === "c")?.tags).toEqual([]);
    const cloze = insertFlashcardCloze(merged, "a", "osmosis", 2, "process");
    expect(cloze.cards[0]?.front).toContain("{{c2::osmosis::process}}");
    expect(cloze.cards[0]?.variant).toBe("cloze");
    expect(cloze.cards[1]).toEqual(merged.cards[1]);
  });

  it("keeps the expanded Flashcards bar inside the shared narrow-width overflow algorithm", () => {
    const plan = planWorkbarOverflow(
      [
        { id: "add-card", priority: "essential", fullWidth: 96, iconWidth: 32 },
        { id: "rail", priority: "essential", fullWidth: 76, iconWidth: 32 },
        { id: "browse", priority: "secondary", fullWidth: 96, iconWidth: 32 },
        {
          id: "card.bulk-select",
          priority: "secondary",
          fullWidth: 104,
          iconWidth: 32,
        },
        {
          id: "deck.options",
          priority: "secondary",
          fullWidth: 100,
          iconWidth: 32,
        },
        { id: "import", priority: "secondary", fullWidth: 88, iconWidth: 32 },
        {
          id: "export-package",
          priority: "advanced",
          fullWidth: 130,
          iconWidth: 32,
        },
      ],
      180,
    );
    expect(plan.overflowIds).toContain("export-package");
    expect(plan.overflowIds).toContain("deck.options");
    expect(plan.overflowIds).not.toContain("add-card");
  });

  it("keeps study ratings keyboard-first and every private action capability-addressable", () => {
    const source = readFileSync(
      new URL("../components/flashcard-studio.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('["1", "2", "3", "4"]');
    expect(source).toContain('event.key === " "');
    expect(source).toContain('flashcardCapability("study.bury").id');
    expect(source).toContain('flashcardCapability("study.suspend").id');
    expect(source).toContain('flashcardCapability("study.undo").id');
  });

  it("refreshes private analytics after reviews and study management", () => {
    const source = readFileSync(
      new URL("../components/flashcard-studio.tsx", import.meta.url),
      "utf8",
    );
    const ratingHandler = source.slice(
      source.indexOf("async function rateStudyCard"),
      source.indexOf("const activeStudyPreviews"),
    );
    const managementHandler = source.slice(
      source.indexOf("async function applyPrivateStudyAction"),
      source.indexOf("async function resetPrivateDeckProgress"),
    );

    expect(ratingHandler).toContain("await refreshPrivateStudy");
    expect(managementHandler).toContain("await refreshPrivateStudy");
    expect(managementHandler).toContain("return true");
    expect(source).not.toContain(").then(skipStudyCard)");
  });
});
