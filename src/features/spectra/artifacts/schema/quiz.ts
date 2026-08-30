import { z } from "zod";
import type { ArtifactBlueprint } from "../../core";

const quizScoringSchema = z
  .object({
    partialCredit: z.enum(["none", "proportional"]),
    penaltyPoints: z.number().min(0).max(100),
  })
  .strict();

const quizHotspotSchema = z
  .object({
    allowMultiple: z.boolean(),
    regions: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(180),
            label: z.string().max(500),
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            width: z.number().min(0).max(1),
            height: z.number().min(0).max(1),
            correct: z.boolean(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

const quizPartSchema = z
  .object({
    id: z.string().trim().min(1).max(180),
    prompt: z.string().max(100_000),
    type: z.enum([
      "multiple_choice",
      "short_answer",
      "true_false",
      "select_all",
      "ordering",
      "numeric",
      "fill_blank",
      "long_response",
      "matching",
      "hotspot",
    ]),
    points: z.number().positive().max(100).optional(),
    options: z.array(z.string().max(100_000)).max(100).optional(),
    optionIds: z.array(z.string().trim().min(1).max(180)).max(100).optional(),
    correctAnswer: z.string().max(100_000).optional(),
    correctAnswers: z.array(z.string().max(100_000)).max(100).optional(),
    correctOptionIds: z
      .array(z.string().trim().min(1).max(180))
      .max(100)
      .optional(),
    numericTolerance: z.number().min(0).max(1_000_000_000).optional(),
    rubric: z.string().max(100_000).optional(),
    matchingPairs: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(180),
            left: z.string().max(10_000),
            right: z.string().max(10_000),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    hotspot: quizHotspotSchema.optional(),
    scoring: quizScoringSchema.optional(),
    correctFeedback: z.string().max(100_000).optional(),
    incorrectFeedback: z.string().max(100_000).optional(),
    answerFeedback: z
      .record(z.string().max(180), z.string().max(100_000))
      .optional(),
  })
  .passthrough();

const quizQuestionSchema = z
  .object({
    id: z.string().trim().min(1),
    prompt: z.string().max(100_000),
    type: z.enum([
      "multiple_choice",
      "short_answer",
      "true_false",
      "select_all",
      "ordering",
      "numeric",
      "fill_blank",
      "long_response",
      "matching",
      "hotspot",
      "multipart",
    ]),
    options: z.array(z.string()).optional(),
    optionIds: z.array(z.string().trim().min(1).max(180)).max(100).optional(),
    correctAnswer: z.string().max(100_000).optional(),
    correctAnswers: z.array(z.string().max(100_000)).max(100).optional(),
    correctOptionIds: z
      .array(z.string().trim().min(1).max(180))
      .max(100)
      .optional(),
    numericTolerance: z.number().min(0).max(1_000_000_000).optional(),
    rubric: z.string().max(100_000).optional(),
    matchingPairs: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(180),
            left: z.string().trim().min(1).max(10_000),
            right: z.string().trim().min(1).max(10_000),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    hotspot: quizHotspotSchema.optional(),
    parts: z.array(quizPartSchema).max(100).optional(),
    scoring: quizScoringSchema.optional(),
    correctFeedback: z.string().max(100_000).optional(),
    incorrectFeedback: z.string().max(100_000).optional(),
    answerFeedback: z
      .record(z.string().max(180), z.string().max(100_000))
      .optional(),
    explanation: z.string().optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    sourceRefs: z.array(z.string()).optional(),
    points: z.number().positive().optional(),
    timeLimitSeconds: z.number().positive().optional(),
    feedback: z.string().optional(),
    bloomLevel: z
      .enum([
        "remember",
        "understand",
        "apply",
        "analyze",
        "evaluate",
        "create",
      ])
      .optional(),
    standards: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
    tags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    bankId: z.string().trim().min(1).max(180).optional(),
    poolId: z.string().trim().min(1).max(180).optional(),
    poolDrawCount: z.number().int().min(1).max(100).optional(),
    section: z.string().trim().min(1).max(500).optional(),
    media: z
      .object({
        assetId: z.string().trim().min(1).max(180),
        name: z.string().max(500),
        mediaType: z.string().max(160),
        altText: z.string().max(2_000).optional(),
      })
      .strict()
      .optional(),
  })
  // Quiz artifacts are collaborative drafts. Incomplete options, answers, and
  // matching pairs must remain synchronizable while a human or AI is visibly
  // composing them. Publish-time completeness is enforced by
  // validateQuizForPublishing instead of rejecting intermediate live state.
  .passthrough();

export const quizContentSchema = z
  .object({
    schemaVersion: z.union([z.literal(3), z.literal(4)]).optional(),
    questions: z.array(quizQuestionSchema).max(5_000),
    banks: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(180),
            name: z.string().max(500),
            description: z.string().max(2_000).optional(),
          })
          .strict(),
      )
      .max(500)
      .optional(),
    pools: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(180),
            name: z.string().max(500),
            drawCount: z.number().int().min(1).max(100),
          })
          .strict(),
      )
      .max(500)
      .optional(),
    settings: z
      .object({
        showAnswersImmediately: z.boolean().optional(),
        instructions: z.string().max(100_000).optional(),
        feedbackRelease: z
          .enum(["after_submission", "on_each_response"])
          .optional(),
        timed: z.boolean().optional(),
        shuffleQuestions: z.boolean().optional(),
        shuffleOptions: z.boolean().optional(),
        maxAttempts: z.number().int().min(1).max(100).optional(),
        allowResume: z.boolean().optional(),
        defaultTimeMultiplier: z.number().min(1).max(3).optional(),
        enforceQuestionTimeLimits: z.boolean().optional(),
        reviewPolicy: z
          .object({
            showScore: z.boolean(),
            showCorrectness: z.boolean(),
            showCorrectAnswers: z.boolean(),
            showFeedback: z.boolean(),
            showExplanations: z.boolean(),
          })
          .strict()
          .optional(),
        accessibilityPolicy: z
          .object({
            keyboardSafeRequired: z.boolean(),
            showTimerWarnings: z.boolean(),
          })
          .strict()
          .optional(),
        passingScore: z.number().min(0).max(100).optional(),
        targetScore: z.number().min(0).max(100).optional(),
        // How this quiz is used (§11C). One coherent contract rather than a
        // pile of booleans whose combinations nobody has thought through. The
        // legacy booleans above remain readable so quizzes authored before this
        // contract keep working.
        experience: z
          .object({
            persistence: z.enum(["ephemeral", "personal", "submitted"]),
            identity: z.enum(["anonymous", "signed_in", "assigned"]),
            timing: z.enum(["untimed", "countdown", "deadline"]),
            attempts: z.union([
              z.literal("unlimited"),
              z.number().int().min(1).max(100),
            ]),
            revealAnswers: z.enum([
              "immediate",
              "after_submit",
              "after_deadline",
              "never",
            ]),
            resultsVisibility: z.enum(["learner", "teacher", "both"]),
            countdownSeconds: z
              .number()
              .int()
              .min(30)
              .max(12 * 60 * 60)
              .optional(),
            deadlineAt: z.number().optional(),
          })
          .optional(),
      })
      .passthrough()
      .optional(),
    published: z.boolean().optional(),
    publishedAt: z.number().optional(),
  })
  .passthrough();

export const quizBlueprint: ArtifactBlueprint = {
  key: "quiz",
  name: "Quiz",
  description: "A real question set with answer and review state.",
  version: 4,
  schema: quizContentSchema,
  defaultContent: {
    schemaVersion: 4,
    questions: [
      {
        id: "question-1",
        prompt: "",
        type: "multiple_choice",
        options: ["", "", "", ""],
        optionIds: [
          "question-1:option:1",
          "question-1:option:2",
          "question-1:option:3",
          "question-1:option:4",
        ],
        correctAnswer: "",
        difficulty: "medium",
        points: 1,
        timeLimitSeconds: 90,
        scoring: { partialCredit: "none", penaltyPoints: 0 },
        correctFeedback: "",
        incorrectFeedback: "",
        answerFeedback: {},
        parts: [],
      },
    ],
    banks: [],
    pools: [],
    settings: {
      instructions: "",
      showAnswersImmediately: false,
      feedbackRelease: "after_submission",
      timed: false,
      shuffleQuestions: false,
      shuffleOptions: false,
      allowResume: true,
      defaultTimeMultiplier: 1,
      enforceQuestionTimeLimits: false,
      reviewPolicy: {
        showScore: true,
        showCorrectness: true,
        showCorrectAnswers: true,
        showFeedback: true,
        showExplanations: true,
      },
      accessibilityPolicy: {
        keyboardSafeRequired: true,
        showTimerWarnings: true,
      },
      targetScore: 70,
      // Practice: unlimited tries, answers as you go, nothing submitted.
      experience: {
        persistence: "personal",
        identity: "signed_in",
        timing: "untimed",
        attempts: "unlimited",
        revealAnswers: "immediate",
        resultsVisibility: "learner",
      },
    },
    published: false,
  },
  rendererKey: "quiz",
  operations: [
    "create",
    "generate_from_sources",
    "add_questions",
    "remove_questions",
    "reorder_questions",
    "rewrite_field",
    "configure_question",
    "configure_answer_model",
    "configure_banks",
    "configure_pools",
    "configure_delivery",
    "configure_timing",
    "configure_attempts",
    "configure_scoring",
    "configure_feedback",
    "configure_review",
    "answer",
    "review_practice",
    "inspect_results",
    "export_aggregate_results",
    "explain_answers",
    "validate_ambiguity",
    "check_accessibility",
    "import",
    "export",
    "export_interchange",
    "publish_practice",
    "validate_formative",
    "refuse_live_game",
    "refuse_proctoring",
    "refuse_grades",
    "refuse_manual_grading",
    "refuse_rosters",
    "add_to_workspace",
  ],
  searchableFields: [
    "questions.prompt",
    "questions.options",
    "questions.explanation",
  ],
};
