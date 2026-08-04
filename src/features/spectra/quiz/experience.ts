/**
 * The quiz experience contract (§11C).
 *
 * A quiz is one piece of authored content that can be used in very different
 * ways: a practice set someone runs three times before bed, a set task with a
 * deadline, a timed assessment. Those differences are configuration, not
 * separate work types — so they live here as one explicit contract rather than
 * as scattered boolean settings whose combinations nobody has thought about.
 *
 * Everything in this module is a pure decision over the contract plus observable
 * attempt state. Nothing here reads the clock on its own: callers pass `now`, so
 * the same decision can be made on the server, in the browser, and in a test.
 */

export type QuizPersistence = "ephemeral" | "personal" | "submitted";
export type QuizIdentity = "anonymous" | "signed_in" | "assigned";
export type QuizTiming = "untimed" | "countdown" | "deadline";
export type QuizAttemptAllowance = number | "unlimited";
export type QuizRevealPolicy =
  | "immediate"
  | "after_submit"
  | "after_deadline"
  | "never";
export type QuizResultsVisibility = "learner" | "teacher" | "both";

export type QuizExperience = {
  persistence: QuizPersistence;
  identity: QuizIdentity;
  timing: QuizTiming;
  attempts: QuizAttemptAllowance;
  revealAnswers: QuizRevealPolicy;
  resultsVisibility: QuizResultsVisibility;
  /** Seconds on the clock when `timing` is "countdown". */
  countdownSeconds?: number;
  /** Epoch milliseconds the quiz closes when `timing` is "deadline". */
  deadlineAt?: number;
};

/**
 * Presets carry the advanced configuration so most people never open it. Each
 * one is a coherent whole — changing a single field afterwards is allowed, but
 * `validateQuizExperience` will say so if the result stops making sense.
 */
export type QuizPresetId = "practice" | "assigned" | "timed_assessment";

export type QuizPreset = {
  id: QuizPresetId;
  name: string;
  summary: string;
  experience: QuizExperience;
};

export const QUIZ_PRESETS: readonly QuizPreset[] = Object.freeze([
  {
    id: "practice",
    name: "Practice",
    summary: "Unlimited tries, answers shown straight away, nothing submitted.",
    experience: {
      persistence: "personal",
      identity: "signed_in",
      timing: "untimed",
      attempts: "unlimited",
      revealAnswers: "immediate",
      resultsVisibility: "learner",
    },
  },
  {
    id: "assigned",
    name: "Assigned quiz",
    summary:
      "One submitted attempt per person, answers after the deadline, results shared with the teacher.",
    experience: {
      persistence: "submitted",
      identity: "assigned",
      timing: "deadline",
      attempts: 1,
      revealAnswers: "after_deadline",
      resultsVisibility: "both",
    },
  },
  {
    id: "timed_assessment",
    name: "Timed assessment",
    summary:
      "A single timed attempt. The clock keeps running through a refresh, and answers stay hidden.",
    experience: {
      persistence: "submitted",
      identity: "assigned",
      timing: "countdown",
      countdownSeconds: 45 * 60,
      attempts: 1,
      revealAnswers: "never",
      resultsVisibility: "teacher",
    },
  },
]);

export const DEFAULT_QUIZ_EXPERIENCE: QuizExperience =
  QUIZ_PRESETS[0]!.experience;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function positiveInt(value: unknown, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.min(max, Math.floor(value))
    : undefined;
}

/**
 * Reads an experience out of stored quiz settings, including settings written
 * before this contract existed. Older quizzes stored a handful of booleans;
 * those still describe a real intent, so they are translated rather than
 * discarded.
 */
export function normalizeQuizExperience(value: unknown): QuizExperience {
  const settings = object(value);
  const stored = object(settings.experience);
  const hasContract = Object.keys(stored).length > 0;

  if (!hasContract) {
    const timed = settings.timed === true;
    const limit = positiveInt(settings.maxAttempts, 100);
    return finalizeQuizExperience({
      persistence: settings.published === true ? "submitted" : "personal",
      identity: "signed_in",
      timing: timed ? "countdown" : "untimed",
      ...(timed
        ? {
            countdownSeconds:
              positiveInt(settings.timeLimitSeconds, 6 * 60 * 60) ?? 30 * 60,
          }
        : {}),
      attempts: limit ?? "unlimited",
      revealAnswers:
        settings.showAnswersImmediately === true ? "immediate" : "after_submit",
      resultsVisibility: "learner",
    });
  }

  const timing = oneOf<QuizTiming>(
    stored.timing,
    ["untimed", "countdown", "deadline"],
    "untimed",
  );
  return finalizeQuizExperience({
    persistence: oneOf<QuizPersistence>(
      stored.persistence,
      ["ephemeral", "personal", "submitted"],
      "personal",
    ),
    identity: oneOf<QuizIdentity>(
      stored.identity,
      ["anonymous", "signed_in", "assigned"],
      "signed_in",
    ),
    timing,
    ...(timing === "countdown"
      ? {
          countdownSeconds:
            positiveInt(stored.countdownSeconds, 12 * 60 * 60) ?? 30 * 60,
        }
      : {}),
    ...(timing === "deadline"
      ? {
          deadlineAt:
            typeof stored.deadlineAt === "number" &&
            Number.isFinite(stored.deadlineAt)
              ? stored.deadlineAt
              : undefined,
        }
      : {}),
    attempts:
      stored.attempts === "unlimited"
        ? "unlimited"
        : (positiveInt(stored.attempts, 100) ?? 1),
    revealAnswers: oneOf<QuizRevealPolicy>(
      stored.revealAnswers,
      ["immediate", "after_submit", "after_deadline", "never"],
      "after_submit",
    ),
    resultsVisibility: oneOf<QuizResultsVisibility>(
      stored.resultsVisibility,
      ["learner", "teacher", "both"],
      "learner",
    ),
  });
}

/**
 * Repairs combinations that cannot mean anything, so a stored quiz can never
 * put a learner in a state the interface would have to explain away.
 */
export function finalizeQuizExperience(
  experience: QuizExperience,
): QuizExperience {
  const next: QuizExperience = { ...experience };
  // Nothing is kept, so nothing can be submitted or shown to a teacher later.
  if (next.persistence === "ephemeral") {
    next.attempts = "unlimited";
    if (next.resultsVisibility !== "learner") next.resultsVisibility = "learner";
    if (next.revealAnswers === "after_deadline")
      next.revealAnswers = "after_submit";
  }
  // An anonymous learner has no record to attach a limit or a teacher view to.
  if (next.identity === "anonymous") {
    next.attempts = "unlimited";
    if (next.resultsVisibility !== "learner") next.resultsVisibility = "learner";
  }
  if (next.timing !== "countdown") delete next.countdownSeconds;
  if (next.timing !== "deadline") delete next.deadlineAt;
  // Answers cannot wait for a deadline the quiz does not have.
  if (next.revealAnswers === "after_deadline" && next.timing !== "deadline")
    next.revealAnswers = "after_submit";
  if (typeof next.attempts === "number")
    next.attempts = Math.max(1, Math.min(100, Math.floor(next.attempts)));
  return next;
}

export type QuizExperienceIssue = { field: keyof QuizExperience; message: string };

/** What a creator is told before the configuration is saved. */
export function validateQuizExperience(
  experience: QuizExperience,
): readonly QuizExperienceIssue[] {
  const issues: QuizExperienceIssue[] = [];
  if (experience.persistence === "ephemeral" && experience.attempts !== "unlimited")
    issues.push({
      field: "attempts",
      message: "Attempts cannot be limited when nothing is kept.",
    });
  if (experience.identity === "anonymous" && experience.resultsVisibility !== "learner")
    issues.push({
      field: "resultsVisibility",
      message: "Anonymous responses cannot be shown to a teacher.",
    });
  if (experience.timing === "countdown" && !experience.countdownSeconds)
    issues.push({ field: "timing", message: "Set how long the attempt lasts." });
  if (experience.timing === "deadline" && !experience.deadlineAt)
    issues.push({ field: "timing", message: "Set the date this quiz closes." });
  if (experience.revealAnswers === "after_deadline" && experience.timing !== "deadline")
    issues.push({
      field: "revealAnswers",
      message: "There is no deadline to reveal answers after.",
    });
  if (
    experience.persistence !== "submitted" &&
    experience.resultsVisibility === "teacher"
  )
    issues.push({
      field: "resultsVisibility",
      message: "Nothing is submitted, so a teacher has nothing to review.",
    });
  return issues;
}

export function matchQuizPreset(
  experience: QuizExperience,
): QuizPreset | undefined {
  return QUIZ_PRESETS.find((preset) =>
    (
      [
        "persistence",
        "identity",
        "timing",
        "attempts",
        "revealAnswers",
        "resultsVisibility",
      ] as const
    ).every((field) => preset.experience[field] === experience[field]),
  );
}

/** One line describing the configuration, for the collapsed advanced section. */
export function describeQuizExperience(experience: QuizExperience) {
  const preset = matchQuizPreset(experience);
  if (preset) return preset.summary;
  const attempts =
    experience.attempts === "unlimited"
      ? "unlimited tries"
      : experience.attempts === 1
        ? "one attempt"
        : `${experience.attempts} attempts`;
  const timing =
    experience.timing === "countdown"
      ? `${Math.round((experience.countdownSeconds ?? 0) / 60)} minutes`
      : experience.timing === "deadline"
        ? "closes at a deadline"
        : "no time limit";
  const reveal =
    experience.revealAnswers === "immediate"
      ? "answers shown as you go"
      : experience.revealAnswers === "after_submit"
        ? "answers after you submit"
        : experience.revealAnswers === "after_deadline"
          ? "answers after the deadline"
          : "answers stay hidden";
  return `${attempts}, ${timing}, ${reveal}.`;
}

// ---------------------------------------------------------------- attempts

export type QuizAttemptView = {
  status: "in_progress" | "submitted" | "expired";
  startedAt: number;
  submittedAt?: number;
  /** Attempts this person has already started, including this one. */
  attemptNumber: number;
};

export type QuizViewerRole = "learner" | "teacher";

/**
 * The clock is derived from the server's `startedAt`, never from a countdown
 * held in the tab. Refreshing, reconnecting or reopening the quiz therefore
 * resumes the same attempt with the time that has actually passed.
 */
export function quizTimeRemainingMs(
  experience: QuizExperience,
  attempt: Pick<QuizAttemptView, "startedAt" | "submittedAt">,
  now: number,
): number | null {
  if (experience.timing === "countdown") {
    const total = (experience.countdownSeconds ?? 0) * 1000;
    if (!total) return null;
    const reference = attempt.submittedAt ?? now;
    return Math.max(0, attempt.startedAt + total - reference);
  }
  if (experience.timing === "deadline") {
    if (!experience.deadlineAt) return null;
    const reference = attempt.submittedAt ?? now;
    return Math.max(0, experience.deadlineAt - reference);
  }
  return null;
}

export function quizAttemptHasExpired(
  experience: QuizExperience,
  attempt: Pick<QuizAttemptView, "startedAt" | "submittedAt">,
  now: number,
) {
  if (attempt.submittedAt) return false;
  const remaining = quizTimeRemainingMs(experience, attempt, now);
  return remaining !== null && remaining <= 0;
}

export type QuizStartDecision =
  | { allowed: true; attemptNumber: number }
  | { allowed: false; reason: string };

/**
 * Whether another attempt may begin. The reason is written for the learner,
 * because it is what the surface shows when the button is not there.
 */
export function canStartQuizAttempt(
  experience: QuizExperience,
  input: { attemptsUsed: number; now: number },
): QuizStartDecision {
  if (
    experience.timing === "deadline" &&
    experience.deadlineAt &&
    input.now > experience.deadlineAt
  )
    return { allowed: false, reason: "This quiz closed at its deadline." };
  if (experience.attempts !== "unlimited" && input.attemptsUsed >= experience.attempts)
    return {
      allowed: false,
      reason:
        experience.attempts === 1
          ? "You have already used your one attempt."
          : `You have used all ${experience.attempts} attempts.`,
    };
  return { allowed: true, attemptNumber: input.attemptsUsed + 1 };
}

/**
 * Whether correct answers and explanations may be shown yet. This is the single
 * decision every surface, export and AI response goes through — an answer that
 * has not been released is never sent to the client at all.
 */
export function canRevealQuizAnswers(
  experience: QuizExperience,
  input: {
    attempt?: Pick<QuizAttemptView, "status" | "submittedAt">;
    viewer: QuizViewerRole;
    now: number;
  },
) {
  if (input.viewer === "teacher") return true;
  switch (experience.revealAnswers) {
    case "immediate":
      return true;
    case "after_submit":
      return input.attempt?.status === "submitted";
    case "after_deadline":
      return Boolean(
        experience.deadlineAt && input.now > experience.deadlineAt,
      );
    case "never":
      return false;
  }
}

export function canViewQuizResults(
  experience: QuizExperience,
  viewer: QuizViewerRole,
) {
  if (experience.persistence === "ephemeral") return viewer === "learner";
  return experience.resultsVisibility === "both"
    ? true
    : experience.resultsVisibility === viewer;
}

/** Whether a learner's responses are kept once the tab closes. */
export function quizResponsesArePersisted(experience: QuizExperience) {
  return experience.persistence !== "ephemeral";
}

// ------------------------------------------------------------------- modes

export type QuizMode =
  | "build"
  | "preview"
  | "attempt"
  | "responses"
  | "results";

/**
 * Only the modes this person can actually use, given their access and the
 * quiz's own configuration. A learner never sees Build; a teacher never sees
 * Responses on a quiz where nothing is submitted.
 */
export function availableQuizModes(
  experience: QuizExperience,
  input: { canEdit: boolean; viewer: QuizViewerRole; hasSubmittedAttempt: boolean },
): readonly QuizMode[] {
  const modes: QuizMode[] = [];
  if (input.canEdit) modes.push("build", "preview");
  modes.push("attempt");
  if (input.canEdit && experience.persistence === "submitted")
    modes.push("responses");
  if (
    canViewQuizResults(experience, input.viewer) &&
    (input.hasSubmittedAttempt || input.canEdit)
  )
    modes.push("results");
  return modes;
}

// --------------------------------------------------------------- AI safety

export type QuizQuestionSecrets = {
  correctAnswer?: unknown;
  correctAnswers?: readonly unknown[];
  explanation?: string;
  rubric?: string;
  matchingPairs?: readonly unknown[];
};

/**
 * What an assistant is allowed to see while helping someone sit a quiz.
 *
 * Explaining a concept is useful; handing over an answer that has not been
 * released is not, and no phrasing of the request changes that. The secrets are
 * removed from the material before the model sees it, so the boundary is not a
 * instruction the model could be talked out of (§11C, INV-18).
 */
export function redactQuizQuestionForAI<T extends QuizQuestionSecrets>(
  question: T,
  experience: QuizExperience,
  input: {
    attempt?: Pick<QuizAttemptView, "status" | "submittedAt">;
    viewer: QuizViewerRole;
    now: number;
  },
): { question: Omit<T, keyof QuizQuestionSecrets> & QuizQuestionSecrets; redacted: boolean } {
  if (canRevealQuizAnswers(experience, input))
    return { question, redacted: false };
  const {
    correctAnswer: _correctAnswer,
    correctAnswers: _correctAnswers,
    explanation: _explanation,
    rubric: _rubric,
    matchingPairs,
    ...rest
  } = question;
  return {
    question: {
      ...(rest as Omit<T, keyof QuizQuestionSecrets>),
      // Matching prompts are the question, so the pairs stay — with their
      // right-hand sides emptied, which is the part that gives the answer away.
      ...(matchingPairs
        ? {
            matchingPairs: matchingPairs.map((pair) => {
              const entry = object(pair);
              return { id: entry.id, left: entry.left, right: "" };
            }),
          }
        : {}),
    },
    redacted: true,
  };
}

/** The line the assistant is told, so it explains the limit rather than stalling. */
export function quizAiBoundaryNote(experience: QuizExperience) {
  switch (experience.revealAnswers) {
    case "after_submit":
      return "Answers for this quiz are released after the learner submits. Help them reason it through; do not state the answer.";
    case "after_deadline":
      return "Answers for this quiz are released after its deadline. Help them reason it through; do not state the answer.";
    case "never":
      return "Answers for this quiz are never released to learners. Help them reason it through; do not state the answer.";
    default:
      return "Answers for this quiz are already visible to the learner.";
  }
}
