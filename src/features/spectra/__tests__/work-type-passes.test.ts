import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import {
  bibliographyFromNavigator,
  bibliographyNode,
  buildSourceNavigator,
  documentCitations,
  documentOutline,
  findInDocument,
  outlineEntryAt,
} from "../editor/document-navigation";
import type { SourceRecord } from "../sources/records/source-record";
import {
  checkDeckWrite,
  describeDeckUpdate,
  planStudyStateUpdates,
  reconcileDeckRevision,
  resetStudyState,
  sanitizeDeckCardWrite,
  type PersonalStudyState,
  type StudyCardShape,
} from "../flashcards/study-separation";
import {
  availableQuizModes,
  canRevealQuizAnswers,
  canStartQuizAttempt,
  canViewQuizResults,
  describeQuizExperience,
  DEFAULT_QUIZ_EXPERIENCE,
  finalizeQuizExperience,
  matchQuizPreset,
  normalizeQuizExperience,
  QUIZ_PRESETS,
  quizAttemptHasExpired,
  quizResponsesArePersisted,
  quizTimeRemainingMs,
  redactQuizQuestionForAI,
  validateQuizExperience,
  type QuizExperience,
} from "../quiz/experience";
import {
  applyBibliographySlides,
  BIBLIOGRAPHY_SLIDE_MARKER,
  collectDeckCitations,
  planBibliographySlides,
  removeBibliographySlides,
} from "../presentation/bibliography";
import {
  normalizePresentationContent,
  type PresentationContent,
} from "../presentation/model";
import {
  applyPlanBulkAction,
  planBoardView,
  planBulkAction,
  planFromDelimited,
  planListView,
  planScheduleEntries,
  planTimelineView,
  planToCsv,
  planToIcs,
  planViewTaskIds,
  reschedulePlanTask,
} from "../plan/projections";
import type { PlanContent, PlanTask } from "../plan/model";
import { runCrossTypeConsistency } from "../work/conformance/cross-type-consistency";

/**
 * Phase 11 work-type suites.
 *
 * The conformance suite proves every type honours the shared kernel; these
 * suites prove each type's own Phase 11 promises — the things that make a
 * document a writing environment, a deck a study tool, a quiz an assessment,
 * a deck-of-slides a cited presentation and a plan a plan.
 */

// ================================================================ Documents

const text = (content: string): JSONContent => ({
  type: "text",
  text: content,
});

const demoDoc: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1, blockId: "h1" },
      content: [text("Introduction")],
    },
    {
      type: "paragraph",
      content: [
        text("Spectra keeps every claim honest. "),
        {
          type: "spectraCitation",
          attrs: { id: "cite-1", sourceId: "src-1", label: "Doe" },
        },
        text(" The prism guides the work."),
      ],
    },
    {
      type: "heading",
      attrs: { level: 2, blockId: "h2" },
      content: [text("Method")],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [text("Results")],
    },
    {
      type: "paragraph",
      content: [text("Honest results, honestly reported. Honest work.")],
    },
  ],
};

const demoSources: SourceRecord[] = [
  {
    id: "src-1",
    title: "Connected Work",
    authors: ["Ada Doe"],
    publishedAt: "2024-02-01",
    accessedAt: "2026-01-01",
    sourceType: "paper",
    authority: "primary",
    verified: true,
  } as unknown as SourceRecord,
  {
    id: "src-2",
    title: "Unused reading",
    accessedAt: "2026-01-01",
    sourceType: "web",
    authority: "unknown",
    verified: true,
  } as unknown as SourceRecord,
];

describe("§11A document outline", () => {
  it("lists headings with level, stable ids and section weight", () => {
    const outline = documentOutline(demoDoc);
    expect(outline.map((entry) => entry.title)).toEqual([
      "Introduction",
      "Method",
      "Results",
    ]);
    expect(outline[0]).toMatchObject({ level: 1, blockId: "h1" });
    expect(outline[1]!.wordCount).toBe(0);
    // Six words under Results; the heading's own word is title, not weight.
    expect(outline[2]!.wordCount).toBe(6);
    expect(outline[0]!.wordCount).toBeGreaterThan(0);
  });

  it("answers which heading a position sits under", () => {
    const outline = documentOutline(demoDoc);
    expect(outlineEntryAt(outline, 0)?.title).toBe("Introduction");
    const mid = outline[2]!.position + 1;
    expect(outlineEntryAt(outline, mid)?.title).toBe("Results");
    const intro = outline[0]!.position + 3;
    expect(outlineEntryAt(outline, intro)?.title).toBe("Introduction");
  });
});

describe("§11A find and replace", () => {
  it("finds matches with editor positions and previews", () => {
    const matches = findInDocument(demoDoc, "honest");
    expect(matches.length).toBe(4);
    expect(matches[0]!.to).toBeGreaterThan(matches[0]!.from);
    expect(
      matches.every((match) => match.preview.toLowerCase().includes("honest")),
    ).toBe(true);
  });

  it("respects case sensitivity and whole-word matching", () => {
    expect(
      findInDocument(demoDoc, "Honest", { caseSensitive: true }).length,
    ).toBe(2);
    expect(findInDocument(demoDoc, "Hones").length).toBe(4);
    expect(findInDocument(demoDoc, "Hones", { wholeWord: true }).length).toBe(
      0,
    );
  });

  it("supports regular expressions and treats invalid ones as no matches", () => {
    expect(findInDocument(demoDoc, "honest\\w*", { regex: true }).length).toBe(
      4,
    );
    expect(findInDocument(demoDoc, "([", { regex: true })).toEqual([]);
    expect(findInDocument(demoDoc, "")).toEqual([]);
  });
});

describe("§11A source navigator and bibliography", () => {
  it("collects citations with their section and groups them by source", () => {
    const uses = documentCitations(demoDoc);
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatchObject({
      sourceId: "src-1",
      label: "Doe",
      section: "Introduction",
    });
    const navigator = buildSourceNavigator(demoDoc, demoSources);
    expect(navigator.entries).toHaveLength(1);
    expect(navigator.entries[0]!.source.id).toBe("src-1");
    expect(navigator.entries[0]!.sections).toEqual(["Introduction"]);
    expect(navigator.unresolved).toHaveLength(0);
    expect(navigator.uncited.map((source) => source.id)).toEqual(["src-2"]);
  });

  it("names citations whose source record is missing rather than hiding them", () => {
    const navigator = buildSourceNavigator(demoDoc, []);
    expect(navigator.unresolved).toHaveLength(1);
    expect(navigator.uncited).toHaveLength(0);
  });

  it("builds numeric and author-date bibliographies and a document block", () => {
    const navigator = buildSourceNavigator(demoDoc, demoSources);
    const numeric = bibliographyFromNavigator(navigator, "numeric");
    const authorDate = bibliographyFromNavigator(navigator, "author_date");
    expect(numeric[0]!.marker).toBe("[1]");
    expect(authorDate[0]!.marker).toBe("(Ada Doe, 2024)");
    expect(numeric[0]!.verified).toBe(true);
    const node = bibliographyNode(numeric);
    expect(node.content?.[0]).toMatchObject({ type: "heading" });
    expect(node.content).toHaveLength(1 + numeric.length);
    expect(bibliographyNode([]).content).toHaveLength(2);
  });
});

// =============================================================== Flashcards

const card = (
  partial: Partial<StudyCardShape> & { id: string },
): StudyCardShape => ({
  front: `front-${partial.id}`,
  back: `back-${partial.id}`,
  ...partial,
});

describe("§11B deck revision reconciliation", () => {
  it("keeps progress untouched when nothing about a card changed", () => {
    const before = [card({ id: "a" }), card({ id: "b" })];
    const result = reconcileDeckRevision(
      before,
      before,
      new Set(["a:forward"]),
    );
    expect(result.progressUntouched).toBe(true);
    expect(
      result.outcomes.every((outcome) => outcome.change === "unchanged"),
    ).toBe(true);
  });

  it("resets scheduling only when the answer itself changed, and only for studied directions", () => {
    const before = [card({ id: "a" }), card({ id: "b" })];
    const after = [
      card({ id: "a", back: "different answer" }),
      card({ id: "b" }),
    ];
    const result = reconcileDeckRevision(before, after, new Set(["a:forward"]));
    expect(result.resetCardIds).toEqual(["a"]);
    expect(result.progressUntouched).toBe(false);
    const outcome = result.outcomes.find((entry) => entry.cardId === "a")!;
    expect(outcome.change).toBe("rewritten");
    expect(outcome.keep).toEqual([]);
    expect(outcome.reset).toEqual(["forward"]);
  });

  it("resets only the directions the learner has actually studied", () => {
    const before = [card({ id: "a", bidirectional: true })];
    const after = [
      card({ id: "a", bidirectional: true, front: "new question" }),
    ];
    const result = reconcileDeckRevision(before, after, new Set(["a:reverse"]));
    expect(result.resetCardIds).toEqual(["a"]);
    const outcome = result.outcomes.find((entry) => entry.cardId === "a")!;
    expect(outcome.reset).toEqual(["reverse"]);
    // Forward was never studied, so it is not reset on the learner's behalf.
    expect(outcome.keep).toEqual([]);
  });

  it("treats hint and tag edits as refinements that keep progress", () => {
    const before = [card({ id: "a", hint: "old", tags: ["x"] })];
    const after = [card({ id: "a", hint: "new", tags: ["x", "y"] })];
    const result = reconcileDeckRevision(before, after, new Set(["a:forward"]));
    const outcome = result.outcomes[0]!;
    expect(outcome.change).toBe("refined");
    expect(outcome.keep).toEqual(["forward"]);
    expect(outcome.reset).toEqual([]);
    expect(result.progressUntouched).toBe(true);
  });

  it("retires removed cards and directions instead of deleting them", () => {
    const before = [
      card({ id: "a", bidirectional: true }),
      card({ id: "gone" }),
    ];
    const after = [card({ id: "a", bidirectional: false })];
    const result = reconcileDeckRevision(before, after);
    const switched = result.outcomes.find((outcome) => outcome.cardId === "a")!;
    expect(switched.retire).toEqual(["reverse"]);
    const removed = result.outcomes.find(
      (outcome) => outcome.cardId === "gone",
    )!;
    expect(removed.change).toBe("removed");
    expect(removed.retire).toEqual(["forward"]);
    expect([...result.retiredCardIds].sort()).toEqual(["a", "gone"]);
    expect(describeDeckUpdate(result)).toMatch(/progress is kept/i);
  });

  it("introduces newly added cards and newly enabled directions", () => {
    const before = [card({ id: "a" })];
    const after = [card({ id: "a", bidirectional: true }), card({ id: "new" })];
    const result = reconcileDeckRevision(before, after);
    expect(result.addedCardIds).toEqual(["new"]);
    const switched = result.outcomes.find((outcome) => outcome.cardId === "a")!;
    expect(switched.introduce).toEqual(["reverse"]);
  });

  it("speaks about the learner, not the author, in the update notice", () => {
    const result = reconcileDeckRevision(
      [card({ id: "a" })],
      [card({ id: "a", back: "changed" })],
      new Set(["a:forward"]),
    );
    expect(describeDeckUpdate(result)).toMatch(
      /you have studied changed answer/i,
    );
    expect(describeDeckUpdate(reconcileDeckRevision([], []))).toMatch(
      /unaffected/i,
    );
  });
});

describe("§11B applying reconciliation to personal study state", () => {
  const studied: PersonalStudyState = {
    cardId: "a",
    direction: "forward",
    attempts: 9,
    ease: 2.9,
    stabilityDays: 12,
    difficulty: 4,
    lapses: 1,
    nextDueAt: 50_000,
    lastReviewedAt: 10_000,
  };

  it("resets scheduling but keeps history and difficulty", () => {
    const reset = resetStudyState(studied, 77_000);
    expect(reset).toMatchObject({
      attempts: 9,
      lapses: 1,
      ease: 2.5,
      stabilityDays: 0,
      nextDueAt: 77_000,
      difficulty: 4,
    });
  });

  it("plans reset for existing states, retire for dropped directions and restore when they return", () => {
    const before = [card({ id: "a", bidirectional: true })];
    const off = [card({ id: "a" })];
    const first = reconcileDeckRevision(
      before,
      off,
      new Set(["a:forward", "a:reverse"]),
    );
    const existing = [
      { cardId: "a", direction: "forward" as const },
      { cardId: "a", direction: "reverse" as const },
    ];
    const planOne = planStudyStateUpdates(first, existing);
    expect(planOne).toContainEqual({
      cardId: "a",
      direction: "reverse",
      action: "retire",
    });

    const back = reconcileDeckRevision(
      off,
      before,
      new Set(["a:forward", "a:reverse"]),
    );
    const planTwo = planStudyStateUpdates(back, [
      existing[0]!,
      { ...existing[1]!, retired: true },
    ]);
    expect(planTwo).toContainEqual({
      cardId: "a",
      direction: "reverse",
      action: "restore",
    });
  });

  it("keeps deck writes out of personal progress and vice versa", () => {
    expect(
      checkDeckWrite("a", { front: "ok", review: { ease: 3 } }),
    ).toHaveLength(1);
    expect(checkDeckWrite("a", { attempts: 4 })[0]!.reason).toMatch(/not part/);
    expect(checkDeckWrite("a", { front: "ok" })).toEqual([]);
    expect(
      sanitizeDeckCardWrite({ front: "ok", review: { ease: 3 }, notes: 1 }),
    ).toEqual({
      front: "ok",
    });
  });
});

// ================================================================== Quizzes

const timedExperience: QuizExperience = {
  persistence: "submitted",
  identity: "assigned",
  timing: "countdown",
  attempts: 1,
  revealAnswers: "never",
  resultsVisibility: "teacher",
  countdownSeconds: 600,
};

describe("§11C quiz experience contract", () => {
  it("defaults to the practice preset and recognises presets back", () => {
    expect(DEFAULT_QUIZ_EXPERIENCE).toEqual(QUIZ_PRESETS[0]!.experience);
    // Preset recognition reads the six contract fields, not the clock length.
    expect(matchQuizPreset(timedExperience)?.id).toBe("timed_assessment");
    expect(
      matchQuizPreset({ ...timedExperience, attempts: 2 }),
    ).toBeUndefined();
    expect(matchQuizPreset(QUIZ_PRESETS[2]!.experience)?.id).toBe(
      "timed_assessment",
    );
    for (const preset of QUIZ_PRESETS) {
      const issues = validateQuizExperience(preset.experience);
      if (preset.experience.timing === "deadline") {
        // A deadline preset is a template: the closing date is the one field
        // the author still has to choose, and validation says exactly that.
        expect(issues.map((issue) => issue.field)).toEqual(["timing"]);
      } else {
        expect(issues).toEqual([]);
      }
    }
  });

  it("upgrades legacy boolean settings instead of discarding them", () => {
    const legacy = normalizeQuizExperience({
      timed: true,
      timeLimitSeconds: 120,
      maxAttempts: 3,
      published: true,
      showAnswersImmediately: true,
    });
    expect(legacy).toMatchObject({
      persistence: "submitted",
      timing: "countdown",
      countdownSeconds: 120,
      attempts: 3,
      revealAnswers: "immediate",
    });
    const defaulted = normalizeQuizExperience(undefined);
    expect(defaulted.timing).toBe("untimed");
  });

  it("repairs meaningless combinations and reports what remains invalid", () => {
    const fixed = finalizeQuizExperience({
      persistence: "ephemeral",
      identity: "anonymous",
      timing: "deadline",
      attempts: 2,
      revealAnswers: "after_deadline",
      resultsVisibility: "teacher",
      deadlineAt: 1000,
    });
    expect(fixed.attempts).toBe("unlimited");
    expect(fixed.resultsVisibility).toBe("learner");
    expect(fixed.revealAnswers).toBe("after_submit");

    expect(
      validateQuizExperience({
        ...timedExperience,
        countdownSeconds: undefined,
      }).map((issue) => issue.field),
    ).toContain("timing");
  });
});

describe("§11C attempt timing and resilience", () => {
  it("derives remaining time from the attempt record, not the tab clock", () => {
    const started = { startedAt: 10_000 };
    expect(quizTimeRemainingMs(timedExperience, started, 20_000)).toBe(
      10_000 + 600_000 - 20_000,
    );
    expect(
      quizTimeRemainingMs(timedExperience, started, 10_000 + 700_000),
    ).toBe(0);
  });

  it("stops counting once submitted and never expires a submitted attempt", () => {
    const submitted = { startedAt: 10_000, submittedAt: 100_000 };
    expect(quizTimeRemainingMs(timedExperience, submitted, 999_000)).toBe(
      10_000 + 600_000 - 100_000,
    );
    expect(quizAttemptHasExpired(timedExperience, submitted, 999_000_000)).toBe(
      false,
    );
    expect(
      quizAttemptHasExpired(timedExperience, { startedAt: 0 }, 601_000),
    ).toBe(true);
  });

  it("enforces attempt limits and closed deadlines with learner-facing reasons", () => {
    expect(
      canStartQuizAttempt(timedExperience, { attemptsUsed: 1, now: 0 }),
    ).toMatchObject({ allowed: false });
    expect(
      canStartQuizAttempt(timedExperience, { attemptsUsed: 0, now: 0 }),
    ).toEqual({
      allowed: true,
      attemptNumber: 1,
    });
    const deadline: QuizExperience = {
      ...timedExperience,
      timing: "deadline",
      deadlineAt: 5_000,
      countdownSeconds: undefined,
    };
    const late = canStartQuizAttempt(deadline, { attemptsUsed: 0, now: 6_000 });
    expect(late.allowed).toBe(false);
    if (!late.allowed) expect(late.reason).toMatch(/closed/i);
  });
});

describe("§11C answer reveal and AI secrecy boundaries", () => {
  const learner = { viewer: "learner" as const, now: 0 };

  it("keeps answers hidden until the configured release, for learners only", () => {
    expect(canRevealQuizAnswers(timedExperience, learner)).toBe(false);
    expect(canRevealQuizAnswers(QUIZ_PRESETS[0]!.experience, learner)).toBe(
      true,
    );
    expect(
      canRevealQuizAnswers(timedExperience, { ...learner, viewer: "teacher" }),
    ).toBe(true);

    const afterSubmit: QuizExperience = {
      ...timedExperience,
      revealAnswers: "after_submit",
    };
    expect(
      canRevealQuizAnswers(afterSubmit, {
        ...learner,
        attempt: { status: "in_progress" },
      }),
    ).toBe(false);
    expect(
      canRevealQuizAnswers(afterSubmit, {
        ...learner,
        attempt: { status: "submitted", submittedAt: 1 },
      }),
    ).toBe(true);
  });

  it("strips secrets before the model ever sees a question, and empties matching answers", () => {
    const question = {
      id: "q1",
      prompt: "Pair the forces",
      correctAnswer: "gravity",
      correctAnswers: ["a"],
      explanation: "because",
      rubric: "full marks when paired",
      matchingPairs: [{ id: "p1", left: "Gravity", right: "9.8" }],
    };
    const { question: redacted, redacted: was } = redactQuizQuestionForAI(
      question,
      timedExperience,
      learner,
    );
    expect(was).toBe(true);
    expect(redacted).not.toHaveProperty("correctAnswer");
    expect(redacted).not.toHaveProperty("explanation");
    expect(redacted.matchingPairs).toEqual([
      { id: "p1", left: "Gravity", right: "" },
    ]);

    const revealed = redactQuizQuestionForAI(
      question,
      QUIZ_PRESETS[0]!.experience,
      learner,
    );
    expect(revealed.redacted).toBe(false);
    expect(revealed.question).toBe(question);
  });

  it("offers only the modes a person can use", () => {
    const learnerModes = availableQuizModes(QUIZ_PRESETS[2]!.experience, {
      canEdit: false,
      viewer: "learner",
      hasSubmittedAttempt: false,
    });
    expect(learnerModes).not.toContain("build");
    expect(learnerModes).toContain("attempt");
    expect(learnerModes).not.toContain("results");

    const teacherModes = availableQuizModes(QUIZ_PRESETS[2]!.experience, {
      canEdit: true,
      viewer: "teacher",
      hasSubmittedAttempt: false,
    });
    expect(teacherModes).toContain("responses");
    expect(teacherModes).toContain("results");
  });

  it("keeps persistence policy and results visibility consistent", () => {
    expect(quizResponsesArePersisted(QUIZ_PRESETS[0]!.experience)).toBe(true);
    const ephemeral: QuizExperience = {
      ...QUIZ_PRESETS[0]!.experience,
      persistence: "ephemeral",
    };
    expect(quizResponsesArePersisted(ephemeral)).toBe(false);
    expect(canViewQuizResults(ephemeral, "teacher")).toBe(false);
    expect(finalizeQuizExperience(ephemeral).resultsVisibility).toBe("learner");
    expect(describeQuizExperience(timedExperience)).toMatch(
      /answers stay hidden/,
    );
  });
});

// ============================================================ Presentations

function citedDeck(): PresentationContent {
  return normalizePresentationContent({
    theme: { id: "t" },
    slides: [
      {
        id: "s1",
        title: "Intro",
        objects: [],
        citations: [
          {
            id: "c1",
            label: "Doe et al., Connected Work",
            url: "https://x.test/doe",
          },
          { id: "c2", label: "Unverified claim" },
        ],
      },
      {
        id: "s2",
        title: "Method",
        objects: [],
        citations: [
          {
            id: "c3",
            label: "Doe et al., Connected Work",
            url: "https://x.test/doe",
          },
        ],
      },
    ],
  });
}

describe("§11E bibliography slide generation", () => {
  it("collects citations in deck order, merging repeats across slides", () => {
    const citations = collectDeckCitations(citedDeck());
    expect(citations).toHaveLength(2);
    expect(citations[0]).toMatchObject({
      label: "Doe et al., Connected Work",
      url: "https://x.test/doe",
      slideNumbers: [1, 2],
      verified: true,
    });
    expect(citations[1]).toMatchObject({
      label: "Unverified claim",
      verified: false,
    });
  });

  it("builds a References slide with entry text, marks unverified entries", () => {
    const plan = planBibliographySlides(citedDeck());
    expect(plan.slides).toHaveLength(1);
    const slide = plan.slides[0]!;
    expect(slide.title).toBe("References");
    expect(slide.accessibility?.label).toBe(BIBLIOGRAPHY_SLIDE_MARKER);
    const entries = slide.objects.filter(
      (object) => object.type === "text" && object.id.includes(":entry-"),
    );
    expect(entries).toHaveLength(2);
    const first = entries[0]!;
    const second = entries[1]!;
    expect(String((first.content as { text: string }).text)).toContain(
      "slides 1, 2",
    );
    expect(String((second.content as { text: string }).text)).toContain(
      "slide 1",
    );
    expect(second.style?.italic).toBe(true);
    expect(second.altText).toMatch(/Unverified/);
    expect(first.readingOrder).toBeLessThan(second.readingOrder!);
  });

  it("regenerates in place: no duplicates, always last, stable through normalization", () => {
    const deck = citedDeck();
    applyBibliographySlides(deck);
    expect(planBibliographySlides(deck).replaces).toBe(1);
    applyBibliographySlides(deck);
    const generated = deck.slides.filter(
      (slide) => slide.accessibility?.label === BIBLIOGRAPHY_SLIDE_MARKER,
    );
    expect(generated).toHaveLength(1);
    expect(deck.slides.at(-1)!.accessibility?.label).toBe(
      BIBLIOGRAPHY_SLIDE_MARKER,
    );
    // Generated slides never feed back into the citation collection.
    expect(collectDeckCitations(deck)).toHaveLength(2);
    // The result still validates as a normal deck.
    const roundTrip = normalizePresentationContent(deck);
    expect(roundTrip.slides).toHaveLength(3);
    removeBibliographySlides(deck);
    expect(
      deck.slides.some(
        (slide) => slide.accessibility?.label === BIBLIOGRAPHY_SLIDE_MARKER,
      ),
    ).toBe(false);
  });

  it("stays honest when there is nothing to cite and paginates long lists", () => {
    const empty = normalizePresentationContent({
      theme: { id: "t" },
      slides: [{ id: "only", title: "Only", objects: [] }],
    });
    const plan = planBibliographySlides(empty);
    expect(plan.slides).toHaveLength(1);
    expect(
      plan.slides[0]!.objects.some((object) =>
        String((object.content as { text?: string }).text).includes(
          "Add a citation",
        ),
      ),
    ).toBe(true);

    const many = normalizePresentationContent({
      theme: { id: "t" },
      settings: { aspectRatio: "16:9" },
      slides: Array.from({ length: 5 }, (_unused, index) => ({
        id: `s${index}`,
        title: `S${index}`,
        objects: [],
        citations: Array.from({ length: 3 }, (_u, citationIndex) => ({
          id: `c${index}-${citationIndex}`,
          label: `Source ${index}-${citationIndex}`,
          url: `https://x.test/${index}-${citationIndex}`,
        })),
      })),
    });
    const paged = planBibliographySlides(many);
    expect(paged.slides.length).toBeGreaterThan(1);
    expect(paged.slides[1]!.title).toBe("References (2)");
  });
});

// =================================================================== Plans

function planTask(partial: Partial<PlanTask> & { id: string }): PlanTask {
  return {
    title: partial.id,
    description: "",
    dependencyIds: [],
    status: "todo",
    assigneeIds: [],
    referenceIds: [],
    sourceRefs: [],
    calendarBlockIds: [],
    checklist: [],
    order: 0,
    ...partial,
  };
}

function demoPlan(): PlanContent {
  return {
    version: 4,
    title: "Revision",
    description: "",
    sections: [{ id: "sec-1", title: "Week one", order: 0 }],
    milestones: [
      {
        id: "m1",
        title: "Draft due",
        dueAt: 20_000,
        status: "planned",
        order: 0,
      },
      { id: "m2", title: "No date", status: "planned", order: 1 },
    ],
    tasks: [
      planTask({
        id: "t1",
        title: "Read chapter",
        status: "doing",
        sectionId: "sec-1",
        dueAt: 10_000,
        order: 0,
      }),
      planTask({
        id: "t2",
        title: "Official essay deadline",
        status: "todo",
        dueAt: 30_000,
        officialDeadlineRef: "managebac:assignment:9",
        order: 1,
      }),
      planTask({
        id: "t3",
        title: "Unscheduled practise",
        status: "backlog",
        parentTaskId: "t1",
        dependencyIds: ["t1"],
        order: 2,
      }),
    ],
    views: [],
  };
}

describe("§11H plan view equivalence", () => {
  it("List, Board and Timeline show exactly the same tasks", () => {
    const plan = demoPlan();
    const ids = planViewTaskIds(plan);
    expect([...ids.list].sort()).toEqual(["t1", "t2", "t3"]);
    expect(ids.list).toEqual(ids.board);
    expect(ids.board).toEqual(ids.timeline);
    const filtered = planViewTaskIds(plan, { statuses: ["doing", "todo"] });
    expect([...filtered.list].sort()).toEqual(["t1", "t2"]);
    expect(filtered.list).toEqual(filtered.board);
    expect(filtered.board).toEqual(filtered.timeline);
  });

  it("keeps subtask depth, unfinished blockers and the unscheduled lane", () => {
    const plan = demoPlan();
    const sections = planListView(plan);
    const weekOne = sections.find((section) => section.id === "sec-1")!;
    expect(weekOne.rows[0]!.task.id).toBe("t1");
    const loose = sections.find((section) => section.id === "__unsectioned")!;
    const child = loose.rows.find((row) => row.task.id === "t3")!;
    expect(child.depth).toBe(1);
    expect(child.blockedBy).toEqual(["t1"]);

    const timeline = planTimelineView(plan);
    expect(timeline.unscheduled.map((task) => task.id)).toEqual(["t3"]);
    expect(timeline.bars.every((bar) => bar.inferred)).toBe(true);
    expect(timeline.milestones.map((milestone) => milestone.id)).toEqual([
      "m1",
    ]);
    expect(timeline.window?.from).toBeLessThan(timeline.window?.to ?? 0);

    const board = planBoardView(plan);
    expect(board).toHaveLength(5);
    expect(board.find((column) => column.status === "blocked")?.tasks).toEqual(
      [],
    );
  });
});

describe("§11H calendar linkage and official deadlines", () => {
  it("projects official deadlines, personal dues and work blocks distinctly", () => {
    const entries = planScheduleEntries(demoPlan());
    expect(entries).toContainEqual({
      kind: "official_deadline",
      taskId: "t2",
      at: 30_000,
      sourceRef: "managebac:assignment:9",
    });
    expect(entries).toContainEqual({
      kind: "personal_due",
      taskId: "t1",
      at: 10_000,
    });
  });

  it("refuses to move an official deadline but schedules personal work", () => {
    const plan = demoPlan();
    const refused = reschedulePlanTask(plan, { taskId: "t2", dueAt: 40_000 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toMatch(/school/i);

    const moved = reschedulePlanTask(plan, { taskId: "t1", dueAt: 40_000 });
    expect(moved.ok).toBe(true);
    if (moved.ok)
      expect(moved.plan.tasks.find((task) => task.id === "t1")?.dueAt).toBe(
        40_000,
      );
  });
});

describe("§11H bulk action safety", () => {
  it("expands deletion to subtasks, names dependents, and always confirms", () => {
    const plan = demoPlan();
    const bulk = planBulkAction(plan, ["t1"], { kind: "delete" });
    expect(bulk.requiresConfirmation).toBe(true);
    expect([...bulk.taskIds].sort()).toEqual(["t1", "t3"]);
    expect(bulk.confirmation?.body).toMatch(/subtask/i);

    const next = applyPlanBulkAction(plan, bulk, { kind: "delete" });
    expect(next.tasks.map((task) => task.id)).toEqual(["t2"]);
  });

  it("refuses to complete tasks whose dependencies are unfinished, without a dialog", () => {
    const plan = demoPlan();
    const bulk = planBulkAction(plan, ["t1", "t3"], {
      kind: "set_status",
      status: "done",
    });
    expect(bulk.requiresConfirmation).toBe(false);
    expect(bulk.taskIds).toEqual(["t1"]);
    expect(bulk.refusals[0]).toMatchObject({ taskId: "t3" });
    expect(bulk.refusals[0]!.reason).toMatch(/depends/i);

    const next = applyPlanBulkAction(plan, bulk, {
      kind: "set_status",
      status: "done",
    });
    expect(next.tasks.find((task) => task.id === "t1")?.status).toBe("done");
    expect(next.tasks.find((task) => task.id === "t3")?.status).toBe("backlog");
  });

  it("ignores ids that are no longer in the plan", () => {
    const bulk = planBulkAction(demoPlan(), ["gone"], {
      kind: "assign",
      assigneeId: "u1",
    });
    expect(bulk.taskIds).toEqual([]);
  });
});

// ===================================================== §11.10 cross-type

describe("§11.10 cross-type consistency", () => {
  it("holds the shared vocabulary, naming, read-only and renderer contracts", () => {
    const result = runCrossTypeConsistency();
    expect(
      result.issues,
      result.issues.map((issue) => issue.detail).join("\n"),
    ).toEqual([]);
  });
});

describe("§11H plan import and export", () => {
  it("round-trips CSV with quoting, statuses and dates intact", () => {
    const plan = demoPlan();
    const csv = planToCsv(plan);
    expect(csv).toContain("officialDeadline");
    expect(csv).toContain("managebac:assignment:9");

    const target: PlanContent = { ...plan, tasks: [] };
    const imported = planFromDelimited(target, csv);
    expect(imported.imported).toBe(3);
    expect(imported.warnings).toEqual([]);
    const official = imported.plan.tasks.find(
      (task) => task.title === "Official essay deadline",
    )!;
    expect(official).toMatchObject({ status: "todo", dueAt: 30_000 });
    // Imported rows can never claim to be official deadlines.
    expect(imported.plan.tasks.every((task) => !task.officialDeadlineRef)).toBe(
      true,
    );
  });

  it("warns about unreadable rows instead of failing the import", () => {
    const plan = demoPlan();
    expect(planFromDelimited(plan, "")).toMatchObject({
      imported: 0,
      warnings: ["The file was empty."],
    });
    const missing = planFromDelimited(plan, "note\nsomething");
    expect(missing.imported).toBe(0);
    expect(missing.warnings[0]).toMatch(/title column/i);
    const partial = planFromDelimited(plan, "title,status\n,doing\nGood one,x");
    expect(partial.imported).toBe(1);
    expect(partial.warnings[0]).toMatch(/no title/i);
  });

  it("exports ICS to-dos with the official-deadline distinction preserved", () => {
    const ics = planToIcs(demoPlan(), "Revision");
    expect(ics).toContain("BEGIN:VTODO");
    expect(ics).toContain("STATUS:IN-PROCESS");
    expect(ics).toMatch(
      /Official deadline from managebac:assignment:9\. Spectra does not move it/,
    );
    expect(ics).toMatch(/DUE:\d{8}T\d{6}Z/);
  });
});
