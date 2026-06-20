import { z } from "zod";
import type { ArtifactBlueprint } from "../core";

const quizQuestionSchema = z.object({
    id: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    type: z.enum(["multiple_choice", "short_answer"]),
    options: z.array(z.string()).optional(),
    correctAnswer: z.string().trim().min(1),
    explanation: z.string().optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    sourceRefs: z.array(z.string()).optional(),
    points: z.number().positive().optional(),
    timeLimitSeconds: z.number().positive().optional(),
  }).passthrough().superRefine((question, ctx) => {
    if (question.type !== "multiple_choice") return;
    const options = (question.options ?? []).map((option) => option.trim()).filter(Boolean);
    if (options.length < 2) ctx.addIssue({ code: "custom", path: ["options"], message: "Multiple-choice questions require at least two options" });
    if (options.length > 0 && !options.includes(question.correctAnswer)) {
      ctx.addIssue({ code: "custom", path: ["correctAnswer"], message: "The correct answer must match one of the options" });
    }
  });

export const quizContentSchema = z.object({
  questions: z.array(quizQuestionSchema).min(1),
  settings: z.object({
    showAnswersImmediately: z.boolean().optional(),
    timed: z.boolean().optional(),
  }).passthrough().optional(),
}).passthrough();

export const quizBlueprint: ArtifactBlueprint = {
  key: "quiz",
  name: "Quiz",
  description: "A real question set with answer and review state.",
  version: 1,
  schema: quizContentSchema,
  defaultContent: {
    questions: [],
    settings: { showAnswersImmediately: true, timed: false },
  },
  rendererKey: "quiz",
  operations: ["create", "generate_from_sources", "answer", "grade", "explain_answers", "add_to_workspace"],
  searchableFields: ["questions.prompt", "questions.options", "questions.explanation"],
};
