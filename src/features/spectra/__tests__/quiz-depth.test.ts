import { describe, expect, it } from "vitest";
import {
  QUIZ_SCHEMA_VERSION,
  duplicateQuizQuestion,
  migrateQuizContent,
  normalizeQuizQuestion,
} from "../quiz/model";
import {
  gradeQuizQuestion,
  quizCohortResponseLabel,
  quizQuestionTimeRemainingMs,
  safeQuizQuestion,
  selectQuizAttempt,
} from "../quiz/operations";
import {
  quizExportFidelity,
  validateQuizForPublishing,
} from "../quiz/interchange";
import { quizContentSchema } from "../artifacts/schema/quiz";

describe("P12.I1 quiz depth", () => {
  it("migrates v3 content to one idempotent v4 model", () => {
    const legacy = {
      questions: [
        {
          id: "q1",
          prompt: "Choose both",
          type: "select_all",
          options: ["A", "B", "C"],
          optionIds: ["a", "b", "c"],
          correctAnswers: ["A", "C"],
          poolId: "pool-1",
          poolDrawCount: 2,
        },
      ],
      settings: { showAnswersImmediately: true },
    };
    const migrated = migrateQuizContent(legacy);
    expect(migrated.schemaVersion).toBe(QUIZ_SCHEMA_VERSION);
    expect(migrated.questions[0]?.correctOptionIds).toEqual(["a", "c"]);
    expect(migrated.pools).toEqual([
      { id: "pool-1", name: "pool-1", drawCount: 2 },
    ]);
    expect(migrateQuizContent(migrated)).toEqual(migrated);
    expect(
      quizContentSchema.safeParse({
        schemaVersion: 3,
        questions: [{ id: "draft", prompt: "", type: "short_answer" }],
      }).success,
    ).toBe(true);
  });

  it("awards proportional multi-answer credit and applies bounded penalties", () => {
    const question = normalizeQuizQuestion({
      id: "q1",
      type: "select_all",
      options: ["A", "B", "C"],
      optionIds: ["a", "b", "c"],
      correctOptionIds: ["a", "c"],
      points: 4,
      scoring: { partialCredit: "proportional", penaltyPoints: 0.5 },
      answerFeedback: { a: "A is one of the two supporting facts." },
    });
    expect(gradeQuizQuestion(question, ["a"]).awardedPoints).toBe(1.5);
    expect(gradeQuizQuestion(question, ["a"]).answerFeedback).toEqual([
      "A is one of the two supporting facts.",
    ]);
    expect(gradeQuizQuestion(question, ["b"]).awardedPoints).toBe(0);
  });

  it("grades hotspot regions without exposing correctness in attempt projection", () => {
    const question = normalizeQuizQuestion({
      id: "map",
      type: "hotspot",
      points: 3,
      scoring: { partialCredit: "proportional" },
      hotspot: {
        allowMultiple: true,
        regions: [
          {
            id: "north",
            label: "North",
            x: 0,
            y: 0,
            width: 0.5,
            height: 0.5,
            correct: true,
          },
          {
            id: "south",
            label: "South",
            x: 0,
            y: 0.5,
            width: 0.5,
            height: 0.5,
            correct: true,
          },
        ],
      },
    });
    expect(gradeQuizQuestion(question, ["north"]).awardedPoints).toBe(1.5);
    expect(safeQuizQuestion(question).hotspot?.regions).toEqual([
      { id: "north", label: "North", x: 0, y: 0, width: 0.5, height: 0.5 },
      { id: "south", label: "South", x: 0, y: 0.5, width: 0.5, height: 0.5 },
    ]);
  });

  it("aggregates multipart scoring from stable part ids", () => {
    const question = normalizeQuizQuestion({
      id: "stimulus",
      type: "multipart",
      points: 6,
      scoring: { partialCredit: "proportional" },
      parts: [
        {
          id: "p1",
          prompt: "First",
          type: "short_answer",
          correctAnswer: "yes",
          points: 1,
        },
        {
          id: "p2",
          prompt: "Second",
          type: "numeric",
          correctAnswer: "10",
          numericTolerance: 1,
          points: 2,
        },
      ],
    });
    const result = gradeQuizQuestion(question, { p1: "yes", p2: "20" });
    expect(result.partResults?.map((part) => part.correct)).toEqual([
      true,
      false,
    ]);
    expect(result.awardedPoints).toBe(2);
    expect(result.maxPoints).toBe(6);
  });

  it("selects pools and option orders deterministically", () => {
    const content = {
      questions: [
        { id: "a", type: "multiple_choice", options: ["1", "2"], poolId: "p" },
        { id: "b", type: "multiple_choice", options: ["1", "2"], poolId: "p" },
        { id: "c", type: "multiple_choice", options: ["1", "2"] },
      ],
      pools: [{ id: "p", name: "Pool", drawCount: 1 }],
      settings: { shuffleQuestions: true, shuffleOptions: true },
    };
    expect(selectQuizAttempt(content, "attempt-1")).toEqual(
      selectQuizAttempt(content, "attempt-1"),
    );
    expect(selectQuizAttempt(content, "attempt-1").questions).toHaveLength(2);
  });

  it("anchors enforced question timing to the persisted server start", () => {
    expect(
      quizQuestionTimeRemainingMs({
        question: { timeLimitSeconds: 30 },
        startedAt: 1_000,
        now: 11_000,
        multiplier: 1.5,
        enforce: true,
      }),
    ).toBe(35_000);
    expect(
      quizQuestionTimeRemainingMs({
        question: { timeLimitSeconds: 30 },
        startedAt: 1_000,
        now: 11_000,
        enforce: false,
      }),
    ).toBeNull();
  });

  it("duplicates nested identities without carrying stale feedback keys", () => {
    const source = normalizeQuizQuestion({
      id: "source",
      type: "multipart",
      parts: [
        {
          id: "part-old",
          prompt: "Choose",
          type: "multiple_choice",
          options: ["A", "B"],
          optionIds: ["a-old", "b-old"],
          correctOptionIds: ["a-old"],
          answerFeedback: { "a-old": "Good choice" },
        },
      ],
      answerFeedback: { "part-old": "Part feedback" },
    });
    const duplicate = duplicateQuizQuestion(source, "copy");
    expect(duplicate.parts[0]?.id).not.toBe("part-old");
    expect(duplicate.parts[0]?.optionIds).not.toContain("a-old");
    expect(Object.values(duplicate.parts[0]?.answerFeedback ?? {})).toContain(
      "Good choice",
    );
    expect(Object.values(duplicate.answerFeedback)).toContain("Part feedback");
  });

  it("validates hotspot and multipart publishing depth", () => {
    const hotspot = normalizeQuizQuestion({
      id: "hotspot",
      prompt: "Select the area",
      type: "hotspot",
      media: {
        assetId: "asset",
        name: "Map",
        mediaType: "image/png",
        altText: "A labeled map",
      },
      hotspot: {
        allowMultiple: false,
        regions: [
          {
            id: "region",
            label: "North",
            x: 0,
            y: 0,
            width: 0.5,
            height: 0.5,
            correct: true,
          },
        ],
      },
    });
    const multipart = normalizeQuizQuestion({
      id: "multipart",
      prompt: "Use the stimulus",
      type: "multipart",
      parts: [
        {
          id: "part",
          prompt: "Choose one",
          type: "multiple_choice",
          options: ["A", "B"],
          correctAnswer: "A",
        },
      ],
    });
    expect(validateQuizForPublishing([hotspot, multipart])).toEqual([]);
    expect(
      validateQuizForPublishing([
        normalizeQuizQuestion({
          id: "bad",
          prompt: "Bad hotspot",
          type: "hotspot",
          hotspot: { regions: [] },
        }),
      ]).map((issue) => issue.message),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("needs one image"),
        expect.stringContaining("needs at least one named hotspot region"),
      ]),
    );
    const malformedMultipart = normalizeQuizQuestion({
      id: "malformed-multipart",
      prompt: "Use the stimulus",
      type: "multipart",
      parts: [
        {
          id: "duplicate-part",
          prompt: "Incomplete choice",
          type: "multiple_choice",
          options: ["Only one"],
        },
        {
          id: "duplicate-part",
          prompt: "Incomplete match",
          type: "matching",
          matchingPairs: [
            { id: "pair", left: "A", right: "B" },
            { id: "pair", left: "C", right: "D" },
          ],
        },
      ],
    });
    expect(
      validateQuizForPublishing([malformedMultipart]).map(
        (issue) => issue.message,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("unique stable identity"),
        expect.stringContaining("at least two complete options"),
        expect.stringContaining("unique stable identity per matching pair"),
      ]),
    );
    const ambiguousHotspot = normalizeQuizQuestion({
      ...hotspot,
      id: "ambiguous-hotspot",
      hotspot: {
        allowMultiple: false,
        regions: [
          ...(hotspot.hotspot?.regions ?? []),
          {
            id: "region-2",
            label: "South",
            x: 0,
            y: 0.5,
            width: 0.5,
            height: 0.5,
            correct: true,
          },
        ],
      },
    });
    expect(
      validateQuizForPublishing([ambiguousHotspot]).map(
        (issue) => issue.message,
      ),
    ).toContain(
      "Question 1 allows one selection, so exactly one hotspot region can be correct.",
    );
  });

  it("validates configured timers and bank/pool identities before publish", () => {
    const question = normalizeQuizQuestion({
      id: "timed",
      prompt: "Timed prompt",
      type: "short_answer",
      correctAnswer: "Answer",
    });
    expect(
      validateQuizForPublishing([question], {
        enforceQuestionTimeLimits: true,
        banks: [
          { id: "bank", name: "Bank one" },
          { id: "bank", name: "Bank two" },
        ],
        pools: [{ id: "pool", name: "Pool", drawCount: 0 }],
      }).map((issue) => issue.message),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("needs a question time limit"),
        expect.stringContaining("Question bank"),
        expect.stringContaining("positive whole-number draw count"),
      ]),
    );
    const staleMarkedAnswer = {
      ...normalizeQuizQuestion({
        id: "stale-answer",
        prompt: "Choose",
        type: "multiple_choice",
        options: ["A", "B"],
        correctAnswer: "A",
      }),
      correctOptionIds: ["removed-option"],
    };
    expect(
      validateQuizForPublishing([staleMarkedAnswer]).map(
        (issue) => issue.message,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("no longer matches an answer option"),
        expect.stringContaining("exactly one marked correct option"),
      ]),
    );
  });

  it("reports adapted interchange instead of claiming complex fidelity", () => {
    const questions = [
      normalizeQuizQuestion({
        id: "h",
        prompt: "Hotspot",
        type: "hotspot",
        hotspot: { regions: [] },
      }),
      normalizeQuizQuestion({
        id: "m",
        prompt: "Multipart",
        type: "multipart",
        parts: [],
      }),
    ];
    expect(quizExportFidelity(questions, "spectra-json").level).toBe("exact");
    const qti = quizExportFidelity(questions, "qti-2.2");
    expect(qti.level).toBe("adapted");
    expect(qti.notes.join(" ")).toMatch(/Hotspot|Multipart/);
    const simple = [
      normalizeQuizQuestion({
        id: "simple",
        prompt: "Choose",
        type: "multiple_choice",
        options: ["A", "B"],
        correctAnswer: "A",
      }),
    ];
    expect(quizExportFidelity(simple, "csv").level).toBe("adapted");
    expect(quizExportFidelity(simple, "qti-2.2").level).toBe("adapted");
    expect(quizExportFidelity(simple, "print").level).toBe("adapted");
  });

  it("never echoes free text or unknown values into cohort aggregates", () => {
    expect(
      quizCohortResponseLabel(
        normalizeQuizQuestion({ id: "essay", type: "long_response" }),
        "private reflection",
      ),
    ).toBeUndefined();
    const choice = normalizeQuizQuestion({
      id: "choice",
      type: "multiple_choice",
      options: ["Known", "Other"],
      optionIds: ["known", "other"],
    });
    expect(quizCohortResponseLabel(choice, "known")).toBe("Known");
    expect(
      quizCohortResponseLabel(choice, "injected private text"),
    ).toBeUndefined();
    const matching = normalizeQuizQuestion({
      id: "matching",
      type: "matching",
      matchingPairs: [
        { id: "matching:pair:1", left: "A", right: "One" },
        { id: "matching:pair:2", left: "B", right: "Two" },
      ],
      answerFeedback: {
        "matching:pair:1": "A belongs with One.",
      },
    });
    expect(quizCohortResponseLabel(matching, ["matching:pair:1:One"])).toBe(
      "A → One",
    );
    const matchingResult = gradeQuizQuestion(matching, [
      "matching:pair:1:One",
      "matching:pair:2:Two",
    ]);
    expect(matchingResult.correct).toBe(true);
    expect(matchingResult.answerFeedback).toContain("A belongs with One.");
    expect(
      gradeQuizQuestion(matching, [
        "matching:pair:1:One",
        "matching:pair:1:One",
        "matching:pair:1:One",
      ]).correct,
    ).toBe(false);
  });
});
