import { z } from "zod";
import type { WorkCapability } from "../work/registry";
import type { ArtifactEmbedInteraction } from "../../../../shared/artifact-embed";
import type { CapabilityDefinition } from "./types";

const none = z.null();
const idParam = z.object({ id: z.string().min(1).max(180) }).strict();
const questionIdParam = z
  .object({ questionId: z.string().min(1).max(180) })
  .strict();

type QuizSpec = {
  localId: string;
  description: string;
  params?: z.ZodType;
  requires?: WorkCapability;
  embed?: readonly ArtifactEmbedInteraction[];
  exposed?: boolean;
  manifest?: string;
  refusal?: string;
};

/** The original 23 ids are stable; attempts, embeds and preferences use them. */
const LEGACY_SPECS: readonly QuizSpec[] = [
  { localId: "preview", description: "Preview this quiz as a learner." },
  { localId: "build", description: "Return to building this quiz." },
  { localId: "settings", description: "Open quiz settings." },
  { localId: "questions", description: "Show or hide the question list." },
  {
    localId: "question-details",
    description: "Show or hide details for the current question.",
  },
  { localId: "cohort", description: "Show cohort responses." },
  { localId: "attempts", description: "Show your attempts." },
  {
    localId: "attempt.answer",
    description: "Answer the current quiz question.",
    requires: "attempt",
    embed: ["interact", "edit"],
  },
  {
    localId: "attempt.navigate",
    description: "Move between quiz questions.",
    requires: "attempt",
    embed: ["interact", "edit"],
  },
  {
    localId: "attempt.submit",
    description: "Submit this quiz attempt.",
    requires: "submit",
    embed: ["interact", "edit"],
  },
  {
    localId: "import",
    description: "Import questions.",
    requires: "edit",
  },
  {
    localId: "unpublish",
    description: "Stop new attempts on this quiz.",
    requires: "edit",
  },
  ...[
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
  ].map((localId): QuizSpec => ({
    localId,
    description: `Apply ${localId.replaceAll(".", " ")} to the focused field.`,
    requires: "edit",
  })),
];

/** Question construction and answer-model depth (18). */
const QUESTION_SPECS: readonly QuizSpec[] = [
  ["question.add", "Add a quiz question.", "add_questions", none],
  [
    "question.duplicate",
    "Duplicate the selected question.",
    "add_questions",
    questionIdParam,
  ],
  [
    "question.remove",
    "Remove the selected question.",
    "remove_questions",
    questionIdParam,
  ],
  [
    "question.reorder",
    "Reorder quiz questions without changing their identity.",
    "reorder_questions",
    z
      .object({
        questionId: z.string(),
        toIndex: z.number().int().nonnegative(),
      })
      .strict(),
  ],
  [
    "question.type",
    "Change the selected question type while preserving compatible content.",
    "configure_question",
    z.object({ questionId: z.string(), type: z.string() }).strict(),
  ],
  [
    "question.prompt",
    "Write or revise a question prompt.",
    "rewrite_field",
    questionIdParam,
  ],
  [
    "question.explanation",
    "Write the released explanation for a question.",
    "write_explanation",
    questionIdParam,
  ],
  [
    "question.media",
    "Add or remove question media.",
    "configure_question",
    questionIdParam,
  ],
  [
    "question.media-alt",
    "Write useful alternative text for question media.",
    "check_accessibility",
    questionIdParam,
  ],
  [
    "question.options",
    "Add, revise, remove, or reorder stable answer options.",
    "configure_answer_model",
    questionIdParam,
  ],
  [
    "question.correct-answer",
    "Configure the formative answer key.",
    "configure_answer_model",
    questionIdParam,
  ],
  [
    "question.numeric-tolerance",
    "Configure an absolute numeric tolerance.",
    "configure_answer_model",
    questionIdParam,
  ],
  [
    "question.accepted-answers",
    "Configure accepted fill-in answer variants.",
    "configure_answer_model",
    questionIdParam,
  ],
  [
    "question.matching-pairs",
    "Configure stable matching pairs and choices.",
    "configure_answer_model",
    questionIdParam,
  ],
  [
    "question.hotspot-regions",
    "Configure keyboard-selectable hotspot regions.",
    "configure_answer_model",
    questionIdParam,
  ],
  [
    "question.parts",
    "Configure ordered parts under a shared question prompt.",
    "configure_answer_model",
    questionIdParam,
  ],
  [
    "question.rubric",
    "Write advisory long-response review guidance.",
    "write_formative_rubric",
    questionIdParam,
  ],
  [
    "question.metadata",
    "Configure difficulty, taxonomy, standards, tags, sources, and section.",
    "configure_question",
    questionIdParam,
  ],
].map(([localId, description, manifest, params]) => ({
  localId: localId as string,
  description: description as string,
  manifest: manifest as string,
  params: params as z.ZodType,
  requires: "edit" as const,
  exposed: true,
}));

/** Banks, pools, randomization, timing and delivery settings (17). */
const DELIVERY_SPECS: readonly QuizSpec[] = [
  [
    "bank.create",
    "Create a named question bank.",
    "configure_banks",
    z.object({ name: z.string().min(1).max(500) }).strict(),
  ],
  ["bank.rename", "Rename a question bank.", "configure_banks", idParam],
  [
    "bank.remove",
    "Remove a bank and safely unassign its questions.",
    "configure_banks",
    idParam,
  ],
  [
    "bank.assign",
    "Assign a question to a bank.",
    "configure_banks",
    z
      .object({ questionId: z.string(), bankId: z.string().nullable() })
      .strict(),
  ],
  [
    "pool.create",
    "Create a deterministic random-draw pool.",
    "configure_pools",
    z
      .object({
        name: z.string().min(1).max(500),
        drawCount: z.number().int().min(1).max(100),
      })
      .strict(),
  ],
  ["pool.rename", "Rename a random-draw pool.", "configure_pools", idParam],
  [
    "pool.remove",
    "Remove a pool and safely unassign its questions.",
    "configure_pools",
    idParam,
  ],
  [
    "pool.assign",
    "Assign a question to a random-draw pool.",
    "configure_pools",
    z
      .object({ questionId: z.string(), poolId: z.string().nullable() })
      .strict(),
  ],
  [
    "pool.draw-count",
    "Set how many questions a pool draws per pinned attempt.",
    "configure_pools",
    z
      .object({
        poolId: z.string(),
        drawCount: z.number().int().min(1).max(100),
      })
      .strict(),
  ],
  [
    "shuffle.questions",
    "Shuffle question order deterministically per attempt.",
    "configure_delivery",
    z.boolean(),
  ],
  [
    "shuffle.options",
    "Shuffle answer options while preserving stable identity.",
    "configure_delivery",
    z.boolean(),
  ],
  [
    "timing.quiz",
    "Configure an untimed quiz, countdown, or deadline.",
    "configure_timing",
    none,
  ],
  [
    "timing.question",
    "Configure and enforce per-question time limits.",
    "configure_timing",
    questionIdParam,
  ],
  [
    "timing.multiplier",
    "Set a safe learner time multiplier.",
    "configure_timing",
    z.number().min(1).max(3),
  ],
  [
    "attempt.limit",
    "Configure the number of formative attempts.",
    "configure_attempts",
    z.union([z.literal("unlimited"), z.number().int().min(1).max(100)]),
  ],
  [
    "attempt.resume",
    "Allow or prevent resuming an in-progress attempt.",
    "configure_attempts",
    z.boolean(),
  ],
  [
    "delivery.instructions",
    "Write learner instructions for this quiz.",
    "configure_delivery",
    z.string().max(100000),
  ],
].map(([localId, description, manifest, params]) => ({
  localId: localId as string,
  description: description as string,
  manifest: manifest as string,
  params: params as z.ZodType,
  requires: "edit" as const,
  exposed: true,
}));

/** Scoring, feedback, review, analytics, publishing and interchange (15). */
const REVIEW_SPECS: readonly QuizSpec[] = [
  [
    "scoring.points",
    "Set positive formative points for a question.",
    "configure_scoring",
    questionIdParam,
  ],
  [
    "scoring.partial-credit",
    "Configure proportional partial credit where supported.",
    "configure_scoring",
    questionIdParam,
  ],
  [
    "scoring.penalty",
    "Configure a bounded incorrect-answer penalty.",
    "configure_scoring",
    questionIdParam,
  ],
  [
    "feedback.correct",
    "Write feedback for a correct response.",
    "configure_feedback",
    questionIdParam,
  ],
  [
    "feedback.incorrect",
    "Write feedback for an incorrect response.",
    "configure_feedback",
    questionIdParam,
  ],
  [
    "feedback.answer",
    "Write feedback tied to a stable option, pair, region, or part.",
    "configure_feedback",
    questionIdParam,
  ],
  [
    "review.release",
    "Configure when formative answers may be released.",
    "configure_review",
    none,
  ],
  [
    "review.contents",
    "Choose whether review shows score, correctness, answers, feedback, and explanations.",
    "configure_review",
    none,
  ],
  [
    "review.results-visibility",
    "Choose whether results belong to the learner, owner, or both.",
    "configure_review",
    none,
  ],
  [
    "accessibility.policy",
    "Require keyboard-safe interactions and visible timer warnings.",
    "check_accessibility",
    none,
  ],
  [
    "analytics.cohort",
    "Inspect anonymous cohort score, timing, and question aggregates.",
    "inspect_results",
    none,
  ],
  [
    "analytics.export",
    "Export an aggregate-only cohort report.",
    "export_aggregate_results",
    z.enum(["csv"]),
  ],
  [
    "publish.validate",
    "Validate answer models, accessibility, banks, and pools before publishing.",
    "validate_formative",
    none,
  ],
  [
    "publish.practice",
    "Publish an immutable formative practice version.",
    "publish_practice",
    none,
  ],
  [
    "export.interchange",
    "Export supported quiz interchange with explicit fidelity notes.",
    "export_interchange",
    z.enum(["qti-2.2", "csv", "spectra-json", "print"]),
  ],
].map(([localId, description, manifest, params]) => ({
  localId: localId as string,
  description: description as string,
  manifest: manifest as string,
  params: params as z.ZodType,
  requires: "edit" as const,
  exposed: true,
}));

/** Product-scope refusals stay visible and carry one sentence on every plane. */
const REFUSAL_SPECS: readonly QuizSpec[] = [
  [
    "refuse.live-game",
    "Live game hosting is not part of this formative quiz. Share a published practice link instead.",
    "refuse_live_game",
  ],
  [
    "refuse.proctoring",
    "Spectra does not monitor or lock a learner’s device.",
    "refuse_proctoring",
  ],
  [
    "refuse.grades",
    "This quiz is formative practice and does not write grades.",
    "refuse_grades",
  ],
  [
    "refuse.manual-grading",
    "Manual grading is outside formative practice. Use advisory rubric feedback instead.",
    "refuse_manual_grading",
  ],
  [
    "refuse.rosters",
    "Class assignment and moderation are not available in the formative quiz studio.",
    "refuse_rosters",
  ],
].map(([localId, refusal, manifest]) => ({
  localId: localId as string,
  description: refusal as string,
  refusal: refusal as string,
  manifest: manifest as string,
  params: none,
  exposed: true,
}));

const QUIZ_SPECS: readonly QuizSpec[] = [
  ...LEGACY_SPECS,
  ...QUESTION_SPECS,
  ...DELIVERY_SPECS,
  ...REVIEW_SPECS,
  ...REFUSAL_SPECS,
];

export const QUIZ_REFUSAL_REASONS = Object.freeze(
  Object.fromEntries(
    REFUSAL_SPECS.map((spec) => [
      `quiz.${spec.localId.replaceAll(/[^a-zA-Z0-9]+/g, ".")}`,
      spec.refusal!,
    ]),
  ),
);

export const QUIZ_WORKBAR_LOCAL_IDS = [
  "preview",
  "build",
  "settings",
  "questions",
  "question-details",
  "question.add",
  "bank.create",
  "pool.create",
  "cohort",
  "attempts",
  "analytics.export",
  "import",
  "export.interchange",
  "unpublish",
] as const;

export const QUIZ_CAPABILITIES: readonly CapabilityDefinition[] =
  QUIZ_SPECS.map((spec) => {
    const id =
      `quiz.${spec.localId.replaceAll(/[^a-zA-Z0-9]+/g, ".")}` as const;
    return {
      id,
      params: spec.params ?? none,
      scope: "artifact",
      availability: (ctx) => {
        if (spec.refusal)
          return { state: "disabled" as const, reason: spec.refusal };
        if (spec.requires && !ctx.can(spec.requires))
          return { state: "hidden" as const };
        return { state: "enabled" as const };
      },
      // The generic reference presents the refusal; it cannot mutate quiz
      // state. Keeping a reference also preserves the global no-ghost gate.
      execute: spec.refusal ? { editor: "capability.refusal" } : { editor: id },
      ai: {
        exposed: spec.exposed ?? false,
        description: spec.description,
        riskClass: "safe",
      },
      choreography: { target: "workbar-command", region: id },
      ...(spec.embed ? { embed: { levels: spec.embed } } : {}),
      ...(spec.requires ? { requires: spec.requires } : {}),
      ...(spec.manifest ? { manifestOperation: spec.manifest } : {}),
    } satisfies CapabilityDefinition;
  });

if (QUIZ_CAPABILITIES.length !== 78)
  throw new Error(
    `QUIZ_CAPABILITY_CENSUS: expected 78, received ${QUIZ_CAPABILITIES.length}`,
  );
