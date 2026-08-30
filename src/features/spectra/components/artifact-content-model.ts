import {
  normalizeQuizExperience,
  type QuizExperience,
} from "../quiz/experience";

export type DeckCard = {
  id: string;
  variant?: "basic" | "cloze" | "image_occlusion";
  front: string;
  back: string;
  hint?: string;
  explanation?: string;
  acceptedAlternatives?: string[];
  section?: string;
  confidence?: "unknown" | "weak" | "medium" | "strong";
  difficulty?: "easy" | "medium" | "hard";
  learningObjective?: string;
  language?: string;
  bidirectional?: boolean;
  media?: {
    assetId: string;
    name: string;
    mediaType: string;
    altText?: string;
    placement?: "front" | "back";
  };
  occlusions?: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
  }>;
  sourceRefs?: string[];
  tags?: string[];
  review?: {
    state?: "new" | "learning" | "review" | "mastered";
    correctStreak?: number;
    lastReviewedAt?: number | null;
    nextReviewAt?: number | null;
  };
};

export type DeckStudyDirection = "forward" | "reverse";
export type DeckStudyItem = { cardId: string; direction: DeckStudyDirection };

export function deckStudyKey(cardId: string, direction: DeckStudyDirection) {
  return `${cardId}:${direction}`;
}

export function clozeParts(value: string) {
  return [...value.matchAll(/\{\{c(\d+)::([\s\S]*?)(?:::(.*?))?\}\}/gi)].map(
    (match) => ({
      index: Number(match[1]),
      answer: match[2] ?? "",
      hint: match[3] ?? "",
      source: match[0],
    }),
  );
}

export function clozePrompt(value: string) {
  return value.replace(
    /\{\{c\d+::([\s\S]*?)(?:::(.*?))?\}\}/gi,
    (_source, _answer: string, hint: string | undefined) =>
      hint?.trim() ? `[${hint.trim()}]` : "[…]",
  );
}

export function clozeAnswer(value: string) {
  return value.replace(
    /\{\{c\d+::([\s\S]*?)(?:::(.*?))?\}\}/gi,
    (_source, answer: string) => answer,
  );
}

export type QuizQuestion = {
  id: string;
  prompt: string;
  type:
    | "multiple_choice"
    | "short_answer"
    | "true_false"
    | "select_all"
    | "ordering"
    | "numeric"
    | "fill_blank"
    | "long_response"
    | "matching";
  options: string[];
  optionIds: string[];
  correctAnswer?: string;
  correctAnswers?: string[];
  numericTolerance?: number;
  rubric?: string;
  matchingPairs?: Array<{ id: string; left: string; right?: string }>;
  matchingChoices?: string[];
  explanation?: string;
  difficulty?: "easy" | "medium" | "hard";
  points?: number;
  timeLimitSeconds?: number;
  sourceRefs?: string[];
  feedback?: string;
  bloomLevel?:
    "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
  standards?: string[];
  tags?: string[];
  poolId?: string;
  poolDrawCount?: number;
  section?: string;
  media?: {
    assetId: string;
    name: string;
    mediaType: string;
    altText?: string;
  };
};

export type QuizSettings = {
  instructions: string;
  showAnswersImmediately: boolean;
  feedbackRelease: "after_submission" | "on_each_response";
  timed: boolean;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  targetScore: number;
  maxAttempts?: number;
  allowResume: boolean;
  defaultTimeMultiplier: number;
  experience: QuizExperience;
};

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object",
      )
    : [];
}

export function id(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function quizSettingsFromContent(content: unknown): QuizSettings {
  const settings = record(record(content).settings);
  const experience = normalizeQuizExperience(settings);
  return {
    instructions:
      typeof settings.instructions === "string" ? settings.instructions : "",
    showAnswersImmediately: experience.revealAnswers === "immediate",
    feedbackRelease:
      experience.revealAnswers === "immediate"
        ? "on_each_response"
        : "after_submission",
    timed: experience.timing !== "untimed",
    shuffleQuestions: settings.shuffleQuestions === true,
    shuffleOptions: settings.shuffleOptions === true,
    targetScore:
      typeof settings.targetScore === "number"
        ? settings.targetScore
        : typeof settings.passingScore === "number"
          ? settings.passingScore
          : 70,
    maxAttempts:
      experience.attempts === "unlimited" ? undefined : experience.attempts,
    allowResume: settings.allowResume !== false,
    defaultTimeMultiplier:
      typeof settings.defaultTimeMultiplier === "number"
        ? Math.max(1, Math.min(3, settings.defaultTimeMultiplier))
        : 1,
    experience,
  };
}
