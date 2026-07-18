import { z } from "zod";
import type { ArtifactBlueprint } from "../core";

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
    ]),
    options: z.array(z.string()).optional(),
    optionIds: z.array(z.string().trim().min(1).max(180)).max(100).optional(),
    correctAnswer: z.string().max(100_000),
    correctAnswers: z.array(z.string().max(100_000)).max(100).optional(),
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
      .min(2)
      .max(100)
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
  .passthrough()
  .superRefine((question, ctx) => {
    if (
      question.type === "short_answer" ||
      question.type === "numeric" ||
      question.type === "fill_blank" ||
      question.type === "long_response"
    )
      return;
    if (question.type === "matching") {
      if ((question.matchingPairs ?? []).length < 2)
        ctx.addIssue({
          code: "custom",
          path: ["matchingPairs"],
          message: "Matching questions require at least two complete pairs",
        });
      return;
    }
    const options = (question.options ?? [])
      .map((option) => option.trim())
      .filter(Boolean);
    if (options.length < 2)
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "Choice and ordering questions require at least two options",
      });
    if (
      (question.type === "multiple_choice" || question.type === "true_false") &&
      options.length > 0 &&
      !options.includes(question.correctAnswer)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["correctAnswer"],
        message: "The correct answer must match one of the options",
      });
    }
    if (question.type === "select_all") {
      const answers = question.correctAnswers ?? [];
      if (answers.some((answer) => !options.includes(answer))) {
        ctx.addIssue({
          code: "custom",
          path: ["correctAnswers"],
          message: "Every correct answer must match an option",
        });
      }
    }
  });

export const quizContentSchema = z
  .object({
    questions: z.array(quizQuestionSchema).min(1),
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
        passingScore: z.number().min(0).max(100).optional(),
        targetScore: z.number().min(0).max(100).optional(),
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
  version: 3,
  schema: quizContentSchema,
  defaultContent: {
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
      },
    ],
    settings: {
      instructions: "",
      showAnswersImmediately: false,
      feedbackRelease: "after_submission",
      timed: false,
      shuffleQuestions: false,
      shuffleOptions: false,
      allowResume: true,
      defaultTimeMultiplier: 1,
      targetScore: 70,
    },
    published: false,
  },
  rendererKey: "quiz",
  operations: [
    "create",
    "generate_from_sources",
    "answer",
    "review_practice",
    "explain_answers",
    "validate_ambiguity",
    "check_accessibility",
    "import",
    "export",
    "publish_practice",
    "add_to_workspace",
  ],
  searchableFields: [
    "questions.prompt",
    "questions.options",
    "questions.explanation",
  ],
};
