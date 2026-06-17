import { z } from "zod";
import type { ArtifactBlueprint } from "../core";

export const quizContentSchema = z.object({
  questions: z.array(z.object({
    id: z.string(),
    prompt: z.string(),
    type: z.enum(["multiple_choice", "short_answer"]),
    options: z.array(z.string()).optional(),
    correctAnswer: z.string().optional(),
    explanation: z.string().optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    sourceRefs: z.array(z.string()).optional(),
  })),
  settings: z.object({
    showAnswersImmediately: z.boolean().optional(),
    timed: z.boolean().optional(),
  }).optional(),
});

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

