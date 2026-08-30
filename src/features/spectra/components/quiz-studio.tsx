"use client";

import { currentTimeMs } from "@/lib/unique-token";
import {
  AlertCircle,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Copy,
  Eye,
  EyeOff,
  History,
  ImageIcon,
  Import,
  List,
  Loader2,
  Pencil,
  PanelLeft,
  Plus,
  Radio,
  Shuffle,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SelectField } from "@/components/ui/select";
import { targetAttrs } from "../collaboration/target-attributes";
import {
  abortArtifactImportUpload,
  beginArtifactImportOriginal,
  completeArtifactImport,
  getArtifactAssets,
  getSpectraQuizPracticeAttempts,
  getSpectraQuizResponseSummary,
  revokeArtifactAsset,
  saveSpectraQuizPracticeResponse,
  startSpectraQuizPractice,
  submitSpectraQuizPractice,
  uploadArtifactAsset,
  uploadArtifactImportOriginal,
  visitSpectraQuizPracticeQuestion,
  type SpectraArtifactAsset,
  type SpectraQuizPracticeAttempt,
  type SpectraQuizResponseSummary,
} from "../data/api";
import {
  QUIZ_PRESETS,
  availableQuizModes,
  describeQuizExperience,
  finalizeQuizExperience,
  matchQuizPreset,
  validateQuizExperience,
  type QuizExperience,
  type QuizMode,
} from "../quiz/experience";
import {
  parseQuizImport,
  quizCsv,
  quizExportFidelity,
  quizJson,
  quizQtiPackage,
  validateQuizForPublishing,
  type PortableQuizQuestion,
} from "../quiz/interchange";

import { aiRegionAttr, pathTouches } from "./ai-region-path";
import { spectraBus } from "../events";
import {
  ArtifactRichTextEditor,
  Field,
  iconButtonClass,
  inputClass,
  plannerDescriptionText,
  smallActionClass,
  textareaClass,
} from "./artifact-studio";
import { id, record } from "./artifact-content-model";
import {
  newQuizQuestion,
  newQuizPart,
  duplicateQuizQuestion,
  normalizeQuizContent,
  normalizeQuizQuestion,
  quizQuestions,
  quizSettingsFromContent,
  type QuizQuestion,
  type QuizBank,
  type QuizPool,
  type QuizPart,
  type QuizResponse,
  type QuizResponseAtom,
  type QuizSettings,
} from "../quiz/model";
import { gradeQuizQuestion } from "../quiz/operations";
import { artifactBlobSha256 } from "./artifact-studio-file-utils";
import { formatShortDate } from "./spectra-view-model";
import {
  ArtifactWorkbar,
  WorkbarItemSelector,
  type CommandBinding,
} from "./artifact-workbar";
import { projectBindingsFromIr, QUIZ_REFUSAL_REASONS } from "../capabilities";
import { useStudioContract } from "./artifact-studio-shell";
import { StudioItemRail } from "./studio-item-rail";

/**
 * One name per question type, used by the type control, the question list and
 * the printed sheet, so a type is never called two things in one product.
 */
const QUIZ_TYPE_LABELS: Record<QuizQuestion["type"], string> = {
  multiple_choice: "Multiple choice",
  true_false: "True or false",
  select_all: "Select all that apply",
  ordering: "Ordering",
  short_answer: "Short answer",
  numeric: "Numeric",
  fill_blank: "Fill in the blank",
  long_response: "Long response",
  matching: "Matching",
  hotspot: "Hotspot",
  multipart: "Multipart",
};

const QUIZ_TYPE_OPTIONS = (
  Object.keys(QUIZ_TYPE_LABELS) as Array<QuizQuestion["type"]>
).map((type) => ({ value: type, label: QUIZ_TYPE_LABELS[type] }));

const MULTIPART_TYPE_OPTIONS = QUIZ_TYPE_OPTIONS.filter(({ value }) =>
  [
    "multiple_choice",
    "true_false",
    "select_all",
    "ordering",
    "short_answer",
    "numeric",
    "fill_blank",
    "matching",
  ].includes(value),
);

/**
 * `work/registry` mode ids to the quiz's own mode vocabulary. The registry is
 * the authority on which modes exist and who may enter them, so this map is the
 * only place the two names have to agree.
 */
const REGISTRY_QUIZ_MODES: Record<string, QuizMode> = {
  build: "build",
  preview_as_learner: "preview",
  attempt: "attempt",
  responses: "responses",
  results: "results",
};

/**
 * Matches `SelectField`'s own label, so a text input and a select sitting in the
 * same settings grid read as one control grammar rather than two.
 */
const settingLabelClass =
  "mb-1.5 block text-caption font-medium text-[var(--text-secondary)]";

function QuizExperienceSection({
  experience,
  onChange,
  readOnly,
}: {
  experience: QuizExperience;
  onChange: (patch: Partial<QuizExperience>) => void;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const preset = matchQuizPreset(experience);
  const issues = validateQuizExperience(experience);

  return (
    <section className="border-0 bg-transparent p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
          How this quiz is used
        </h3>
        <p className="text-[11px] text-[var(--text-secondary)]">
          {describeQuizExperience(experience)}
        </p>
      </div>

      <div
        className="mt-3 grid gap-2"
        style={{ gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}
      >
        {QUIZ_PRESETS.map((candidate) => {
          const active = preset?.id === candidate.id;
          return (
            <button
              key={candidate.id}
              type="button"
              disabled={readOnly}
              aria-pressed={active}
              onClick={() => onChange(candidate.experience)}
              className={`rounded-[10px] border p-3 text-left transition-colors disabled:opacity-45 ${
                active
                  ? "border-[var(--border-strong)] bg-[var(--bg-elevated)]"
                  : "border-[var(--border-default)] hover:border-[var(--border-strong)]"
              }`}
            >
              <span className="block text-[12px] font-semibold text-[var(--text-primary)]">
                {candidate.name}
              </span>
              <span className="mt-1 block text-micro leading-4 text-[var(--text-secondary)]">
                {candidate.summary}
              </span>
            </button>
          );
        })}
      </div>

      {issues.length ? (
        <ul className="mt-3 space-y-1 text-micro text-[var(--danger)]">
          {issues.map((issue) => (
            <li key={`${issue.field}:${issue.message}`}>{issue.message}</li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="mt-3 text-[11px] font-semibold text-[var(--text-secondary)] underline-offset-2 hover:underline"
      >
        {open ? "Hide detailed settings" : "Change individual settings"}
      </button>

      {open ? (
        <div
          className="mt-3 grid gap-3 border-t border-[var(--border-subtle)] pt-3"
          style={{ gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))" }}
        >
          <SelectField
            label="What is kept"
            size="sm"
            disabled={readOnly}
            value={experience.persistence}
            onChange={(value) =>
              onChange({
                persistence: value as QuizExperience["persistence"],
              })
            }
            options={[
              { value: "ephemeral", label: "Nothing, answers clear on exit" },
              { value: "personal", label: "Their own attempts" },
              { value: "submitted", label: "Submitted attempts" },
            ]}
          />

          <SelectField
            label="Who can sit it"
            size="sm"
            disabled={readOnly}
            value={experience.identity}
            onChange={(value) =>
              onChange({ identity: value as QuizExperience["identity"] })
            }
            options={[
              { value: "anonymous", label: "Anyone with the link" },
              { value: "signed_in", label: "Anyone signed in" },
              { value: "assigned", label: "People it is assigned to" },
            ]}
          />

          <SelectField
            label="Time"
            size="sm"
            disabled={readOnly}
            value={experience.timing}
            onChange={(value) =>
              onChange({ timing: value as QuizExperience["timing"] })
            }
            options={[
              { value: "untimed", label: "No time limit" },
              { value: "countdown", label: "A countdown per attempt" },
              { value: "deadline", label: "Closes at a deadline" },
            ]}
          />

          {experience.timing === "countdown" ? (
            <label className="block min-w-0">
              <span className={settingLabelClass}>Minutes per attempt</span>
              <input
                type="number"
                min={1}
                max={720}
                disabled={readOnly}
                value={
                  Math.round((experience.countdownSeconds ?? 0) / 60) || ""
                }
                onChange={(event) =>
                  onChange({
                    countdownSeconds:
                      Math.max(
                        1,
                        Math.min(720, Number(event.target.value) || 1),
                      ) * 60,
                  })
                }
                className={inputClass()}
              />
            </label>
          ) : experience.timing === "deadline" ? (
            <label className="block min-w-0">
              <span className={settingLabelClass}>Closes</span>
              <input
                type="datetime-local"
                disabled={readOnly}
                value={
                  experience.deadlineAt
                    ? new Date(
                        experience.deadlineAt -
                          new Date().getTimezoneOffset() * 60_000,
                      )
                        .toISOString()
                        .slice(0, 16)
                    : ""
                }
                onChange={(event) =>
                  onChange({
                    deadlineAt: event.target.value
                      ? new Date(event.target.value).getTime()
                      : undefined,
                  })
                }
                className={inputClass()}
              />
            </label>
          ) : (
            <div />
          )}

          <label className="block min-w-0">
            <span className={settingLabelClass}>Attempts</span>
            <input
              type="number"
              min={1}
              max={100}
              disabled={readOnly}
              value={
                experience.attempts === "unlimited" ? "" : experience.attempts
              }
              placeholder="Unlimited"
              onChange={(event) =>
                onChange({
                  attempts: event.target.value
                    ? Math.max(
                        1,
                        Math.min(100, Number(event.target.value) || 1),
                      )
                    : "unlimited",
                })
              }
              className={inputClass()}
            />
          </label>

          <SelectField
            label="Answers shown"
            size="sm"
            disabled={readOnly}
            value={experience.revealAnswers}
            onChange={(value) =>
              onChange({
                revealAnswers: value as QuizExperience["revealAnswers"],
              })
            }
            options={[
              { value: "immediate", label: "As they answer" },
              { value: "after_submit", label: "After they submit" },
              { value: "after_deadline", label: "After the deadline" },
              { value: "never", label: "Never" },
            ]}
          />

          <SelectField
            label="Results seen by"
            size="sm"
            disabled={readOnly}
            value={experience.resultsVisibility}
            onChange={(value) =>
              onChange({
                resultsVisibility: value as QuizExperience["resultsVisibility"],
              })
            }
            options={[
              { value: "learner", label: "The learner" },
              { value: "teacher", label: "The owner" },
              { value: "both", label: "Both" },
            ]}
          />
        </div>
      ) : null}
    </section>
  );
}

/** The five ways of being in a quiz (§11C), in the order they are offered. */
/** `1:04:09` for anything over an hour, `4:09` otherwise. */
function quizClockLabel(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`;
}

function quizDurationLabel(milliseconds: number) {
  return quizClockLabel(Math.max(0, Math.round(milliseconds / 1_000)));
}

function quizPracticeErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("QUIZ_ATTEMPT_TIME_ELAPSED"))
    return "Time ran out, so this answer was not recorded. Submit to see how you did.";
  if (message.includes("QUIZ_QUESTION_TIME_ELAPSED"))
    return "Time for this question has ended. Your earlier synchronized answer is safe; move to another question.";
  if (message.includes("QUIZ_PRACTICE_UNAVAILABLE")) {
    // The server already phrases why an attempt cannot start — a deadline that
    // has passed, an attempt allowance that is used up — so pass its own words
    // through rather than guessing at a second explanation.
    const reason = message.split("QUIZ_PRACTICE_UNAVAILABLE:")[1]?.trim();
    return reason || "This quiz is not open for attempts right now.";
  }
  if (message.includes("QUIZ_PRACTICE_ATTEMPT_LIMIT_REACHED"))
    return "You have reached this quiz’s configured practice-attempt limit.";
  if (message.includes("QUIZ_PRACTICE_NOT_PUBLISHED"))
    return "This practice version is no longer available. The author may be preparing an updated draft.";
  if (message.includes("QUIZ_ATTEMPT_NOT_EDITABLE"))
    return "This attempt is already submitted or no longer editable.";
  if (message.includes("QUIZ_QUESTION_UNAVAILABLE"))
    return "That question is unavailable in this version-pinned attempt.";
  if (message.includes("Artifact not found") || message.includes("ACCESS"))
    return "Your access changed while this practice was open. Your private responses were not exposed.";
  return message || fallback;
}

function QuizResultPie({
  correct,
  incorrect,
  pending,
}: {
  correct: number;
  incorrect: number;
  pending: number;
}) {
  const total = Math.max(1, correct + incorrect + pending);
  const correctDeg = (correct / total) * 360;
  const incorrectDeg = (incorrect / total) * 360;
  return (
    <div className="flex flex-wrap items-center gap-6 py-4">
      <div
        role="img"
        aria-label={`${correct} right, ${incorrect} wrong${pending ? `, ${pending} awaiting review` : ""}`}
        className="size-[148px] shrink-0 rounded-full"
        style={{
          background: `conic-gradient(var(--success) 0deg ${correctDeg}deg, color-mix(in oklab, var(--danger) 82%, var(--text-primary)) ${correctDeg}deg ${correctDeg + incorrectDeg}deg, var(--bg-secondary) ${correctDeg + incorrectDeg}deg 360deg)`,
        }}
      />
      <ul className="space-y-1.5 text-[13px] text-[var(--text-secondary)]">
        <li>
          <span className="font-semibold text-[var(--success)]">{correct}</span>
          {" · right"}
        </li>
        <li>
          <span className="font-semibold text-[var(--danger)]">
            {incorrect}
          </span>
          {" · wrong"}
        </li>
        {pending ? (
          <li>
            <span className="font-semibold text-[var(--text-primary)]">
              {pending}
            </span>
            {" · awaiting review"}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/**
 * Exported as a leaf, on the same terms as `DocumentStudio`: the landing story
 * shows the real quiz view, not a rebuild of it.
 */
export function QuizStudio({
  artifactId,
  mode,
  content,
  onChange,
  aiChangedPaths = [],
  readOnly = false,
  synchronizationReady = true,
}: {
  artifactId: string;
  mode: "split" | "tab";
  content: unknown;
  onChange: (content: unknown) => void;
  aiChangedPaths?: string[];
  readOnly?: boolean;
  synchronizationReady?: boolean;
}) {
  const [questions, setQuestions] = useState(() => quizQuestions(content));
  const [activeQuestionId, setActiveQuestionId] = useState(
    questions[0]?.id ?? "",
  );
  const [view, setView] = useState<
    "builder" | "settings" | "preview" | "responses" | "summary"
  >(readOnly ? "preview" : "builder");
  const [quizSettings, setQuizSettings] = useState<QuizSettings>(() =>
    quizSettingsFromContent(content),
  );
  const [banks, setBanks] = useState<QuizBank[]>(
    () => normalizeQuizContent(content).banks,
  );
  const [pools, setPools] = useState<QuizPool[]>(
    () => normalizeQuizContent(content).pools,
  );
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [inspectAttempt, setInspectAttempt] = useState(false);
  const [practiceAttempt, setPracticeAttempt] =
    useState<SpectraQuizPracticeAttempt>();
  const [practiceAttempts, setPracticeAttempts] = useState<
    SpectraQuizPracticeAttempt[]
  >([]);
  const [practiceLoading, setPracticeLoading] = useState(true);
  const [practiceBusy, setPracticeBusy] = useState(false);
  const [practiceSyncing, setPracticeSyncing] = useState<string[]>([]);
  const [practiceError, setPracticeError] = useState<string>();
  const [practiceFeedback, setPracticeFeedback] = useState<
    Record<string, NonNullable<SpectraQuizPracticeAttempt["results"]>[number]>
  >({});
  const [published, setPublished] = useState(
    record(content).published === true,
  );
  /**
   * When it was last published, which is what makes "unpublished edits" a fact
   * we can state instead of a state change the owner has to infer.
   */
  const publishedAt =
    typeof record(content).publishedAt === "number"
      ? Number(record(content).publishedAt)
      : undefined;
  const [quizAssets, setQuizAssets] = useState<SpectraArtifactAsset[]>([]);
  const [quizMediaError, setQuizMediaError] = useState<string>();
  const [uploadingQuizMedia, setUploadingQuizMedia] = useState(false);
  const [publishIssues, setPublishIssues] = useState<
    Array<{ questionId?: string; message: string }>
  >([]);
  const [quizImporting, setQuizImporting] = useState(false);
  const [quizImportReport, setQuizImportReport] = useState<string>();
  const [quizImportError, setQuizImportError] = useState<string>();
  const [questionNavigatorOpen, setQuestionNavigatorOpen] = useState(
    mode === "tab",
  );
  const [draggingQuestionId, setDraggingQuestionId] = useState<string>();
  const [questionDetailsOpen, setQuestionDetailsOpen] = useState(
    mode === "tab",
  );
  const [responseSummary, setResponseSummary] =
    useState<SpectraQuizResponseSummary>();
  const [responseSummaryError, setResponseSummaryError] = useState<string>();

  /**
   * What this person may do here, from `work/registry` through the shell
   * contract rather than from the `readOnly` prop. Sharing grants Read-only or
   * Edit; everything past viewing is derived from what the type can actually do,
   * so a read-only learner still holds `attempt` and `submit` while losing
   * `edit`. Read-only is never a consequence of surface or width (D1/D4).
   */
  const studio = useStudioContract();
  const canEditQuiz = studio.can("edit") && !readOnly;
  const canAttemptQuiz = studio.can("attempt");
  const canSubmitQuiz = studio.can("submit");
  /**
   * The builder's columns, from the pane's measured density rather than the
   * viewport. Three columns when there is room, two when the details panel has
   * to go under the editor, one when even the navigator has to stack. Every one
   * of them is fully editable: narrow is not read-only (CANON D4).
   */
  const showQuestionRail = studio.surface === "full";

  useEffect(() => {
    setQuestionNavigatorOpen(studio.surface === "full");
  }, [studio.surface]);

  useEffect(() => {
    const reveal = (detail: { workId: string; path?: string }) => {
      if (detail.workId !== artifactId || !detail.path) return;
      const match = detail.path.match(/^\/questions\/(\d+)(?:\/|$)/);
      if (match) {
        const question = questions[Number(match[1])];
        if (question) setActiveQuestionId(question.id);
        if (
          /\/(?:difficulty|points|timeLimitSeconds|bloomLevel|standards|section|poolId|poolDrawCount|media)(?:\/|$)/.test(
            detail.path,
          )
        )
          setQuestionDetailsOpen(true);
        setView("builder");
        return;
      }
      if (detail.path.startsWith("/settings")) setView("settings");
    };
    return spectraBus.handle("work.reveal", reveal);
  }, [artifactId, questions]);
  const quizImportRef = useRef<HTMLInputElement>(null);
  const quizWasReadOnly = useRef(!canEditQuiz);
  const [practiceClockNow, setPracticeClockNow] = useState(0);
  // The last thing the server said about the clock, and when it said it.
  const [practiceClock, setPracticeClock] = useState<{
    remainingMs: number;
    at: number;
  }>();
  const [practiceQuestionClocks, setPracticeQuestionClocks] = useState<
    Record<string, { remainingMs: number; at: number }>
  >({});
  const practiceAutoSubmitted = useRef<string | undefined>(undefined);
  const activeQuestion =
    questions.find((question) => question.id === activeQuestionId) ??
    questions[0];
  const activeQuestionIndex = Math.max(
    0,
    questions.findIndex((question) => question.id === activeQuestion?.id),
  );

  useEffect(() => {
    const nextQuestions = quizQuestions(content);
    setQuestions(nextQuestions);
    setActiveQuestionId((current) =>
      nextQuestions.some((question) => question.id === current)
        ? current
        : (nextQuestions[0]?.id ?? ""),
    );
    setQuizSettings(quizSettingsFromContent(content));
    const normalized = normalizeQuizContent(content);
    setBanks(normalized.banks);
    setPools(normalized.pools);
    setPublished(record(content).published === true);
  }, [content]);

  useEffect(() => {
    // Authoring surfaces exist only for someone the capability model lets edit.
    if (!canEditQuiz && (view === "builder" || view === "settings"))
      setView("preview");
    if (quizWasReadOnly.current && canEditQuiz && !practiceAttempt)
      setView("builder");
    quizWasReadOnly.current = !canEditQuiz;
  }, [canEditQuiz, practiceAttempt, view]);

  useEffect(() => {
    const openPreview = ({ workId }: { workId: string }) => {
      if (workId === artifactId) setView("preview");
    };
    return spectraBus.handle("quiz.preview", openPreview);
  }, [artifactId]);

  useEffect(() => {
    let active = true;
    void getArtifactAssets(artifactId)
      .then((result) => {
        if (active) setQuizAssets(result.assets);
      })
      .catch((error: unknown) => {
        if (active)
          setQuizMediaError(
            error instanceof Error
              ? error.message
              : "Quiz media is unavailable.",
          );
      });
    return () => {
      active = false;
    };
  }, [artifactId]);

  useEffect(() => {
    if (practiceAttempt?.status !== "in_progress") return;
    setPracticeClockNow(Date.now());
    const timer = window.setInterval(
      () => setPracticeClockNow(Date.now()),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [practiceAttempt?.attemptId, practiceAttempt?.status]);

  useEffect(() => {
    let active = true;
    setPracticeLoading(true);
    void getSpectraQuizPracticeAttempts(artifactId)
      .then((result) => {
        if (active) setPracticeAttempts(result.attempts);
      })
      .catch((error: unknown) => {
        if (active)
          setPracticeError(
            error instanceof Error
              ? error.message
              : "Your practice attempts are unavailable.",
          );
      })
      .finally(() => {
        if (active) setPracticeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [artifactId]);

  useEffect(() => {
    // Cohort results are only fetched when the owner actually opens them, so a
    // quiz nobody is reporting on costs nothing to keep open.
    if (view !== "summary" || !canEditQuiz) return;
    let active = true;
    setResponseSummaryError(undefined);
    void getSpectraQuizResponseSummary(artifactId)
      .then((result) => {
        if (active) setResponseSummary(result);
      })
      .catch((error: unknown) => {
        if (active)
          setResponseSummaryError(
            error instanceof Error
              ? error.message
              : "Responses are unavailable right now.",
          );
      });
    return () => {
      active = false;
    };
  }, [artifactId, canEditQuiz, view]);

  const quizAssetMap = new Map(
    quizAssets.map((asset) => [asset.assetId, asset]),
  );

  function commit(next: QuizQuestion[], preservePublished = false) {
    const nextPublished = preservePublished ? published : false;
    setQuestions(next);
    if (!preservePublished) setPublished(false);
    setPublishIssues([]);
    onChange({
      ...record(content),
      questions: next,
      banks,
      pools,
      settings: quizSettings,
      published: nextPublished,
    });
  }

  function commitSettings(patch: Partial<QuizSettings>) {
    const merged = { ...quizSettings, ...patch };
    // The contract is the source of truth; the older booleans are kept in step
    // with it so nothing still reading them can disagree (§11C).
    const experience = finalizeQuizExperience(merged.experience);
    const next: QuizSettings = {
      ...merged,
      experience,
      showAnswersImmediately: experience.revealAnswers === "immediate",
      feedbackRelease:
        experience.revealAnswers === "immediate"
          ? "on_each_response"
          : "after_submission",
      timed: experience.timing !== "untimed",
      maxAttempts:
        experience.attempts === "unlimited" ? undefined : experience.attempts,
    };
    setQuizSettings(next);
    setPublished(false);
    setPublishIssues([]);
    onChange({
      ...record(content),
      questions,
      banks,
      pools,
      settings: next,
      published: false,
    });
  }

  /** Applies one coherent change to the experience contract. */
  function commitExperience(patch: Partial<QuizExperience>) {
    commitSettings({
      experience: finalizeQuizExperience({
        ...quizSettings.experience,
        ...patch,
      }),
    });
  }

  function updateQuestion(questionId: string, patch: Partial<QuizQuestion>) {
    commit(
      questions.map((question) =>
        question.id === questionId ? { ...question, ...patch } : question,
      ),
    );
  }

  /**
   * Real reordering, from the pointer and from the keyboard. Order is what a
   * learner sees, so a grip that only looked draggable was a lie. Region ids are
   * keyed on the question id, not its index, so moving a question keeps every
   * AI target and comment anchored to the same question.
   */
  function moveQuestion(fromIndex: number, toIndex: number) {
    if (
      !canEditQuiz ||
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= questions.length ||
      toIndex >= questions.length
    )
      return;
    const next = [...questions];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);
    commit(next);
    setActiveQuestionId(moved.id);
  }

  function addQuestion() {
    const questionId = id("question");
    const question = newQuizQuestion(questionId);
    commit([...questions, question]);
    setActiveQuestionId(question.id);
  }

  async function uploadQuestionMedia(file: File) {
    if (!activeQuestion) return;
    if (!file.type.startsWith("image/")) {
      setQuizMediaError("Choose an image for this question.");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setQuizMediaError(
        "This image exceeds the 100 MB technical safety ceiling.",
      );
      return;
    }
    setUploadingQuizMedia(true);
    setQuizMediaError(undefined);
    try {
      const uploaded = await uploadArtifactAsset({
        artifactId,
        path: `quiz/${activeQuestion.id}/${Date.now().toString(36)}-${file.name}`,
        name: file.name,
        mediaType: file.type,
        sha256: await artifactBlobSha256(file),
        blob: file,
      });
      const previousAssetId = activeQuestion.media?.assetId;
      const nextQuestions = questions.map((question) =>
        question.id === activeQuestion.id
          ? {
              ...question,
              media: {
                assetId: uploaded.assetId,
                name: file.name,
                mediaType: file.type,
                altText: "",
              },
            }
          : question,
      );
      commit(nextQuestions);
      if (
        previousAssetId &&
        !nextQuestions.some(
          (question) => question.media?.assetId === previousAssetId,
        )
      ) {
        try {
          await revokeArtifactAsset(previousAssetId);
        } catch {
          setQuizMediaError(
            "The new image is active, but the replaced asset could not yet be released from storage.",
          );
        }
      }
      const refreshed = await getArtifactAssets(artifactId);
      setQuizAssets(refreshed.assets);
    } catch (error) {
      setQuizMediaError(
        error instanceof Error
          ? error.message
          : "The image could not be added.",
      );
    } finally {
      setUploadingQuizMedia(false);
    }
  }

  async function removeQuestionMedia(questionId: string) {
    const target = questions.find((question) => question.id === questionId);
    if (!target?.media) return;
    const assetId = target.media.assetId;
    const next = questions.map((question) =>
      question.id === questionId ? { ...question, media: undefined } : question,
    );
    commit(next);
    if (!next.some((question) => question.media?.assetId === assetId)) {
      try {
        await revokeArtifactAsset(assetId);
        setQuizAssets((current) =>
          current.filter((asset) => asset.assetId !== assetId),
        );
      } catch (error) {
        setQuizMediaError(
          error instanceof Error
            ? error.message
            : "The image was removed from the question but storage cleanup failed.",
        );
      }
    }
  }

  async function removeQuestion(questionId: string) {
    const target = questions.find((question) => question.id === questionId);
    const next = questions.filter((question) => question.id !== questionId);
    const replacement = next.length > 0 ? next : quizQuestions({});
    commit(replacement);
    setActiveQuestionId(replacement[0]?.id ?? "");
    const assetId = target?.media?.assetId;
    if (
      assetId &&
      !replacement.some((question) => question.media?.assetId === assetId)
    ) {
      try {
        await revokeArtifactAsset(assetId);
        setQuizAssets((current) =>
          current.filter((asset) => asset.assetId !== assetId),
        );
      } catch (error) {
        setQuizMediaError(
          error instanceof Error
            ? error.message
            : "The question was removed but media cleanup failed.",
        );
      }
    }
  }

  function answerArray(questionId: string) {
    try {
      const value = JSON.parse(answers[questionId] ?? "[]");
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  }

  function answerResponseValue(value: string): QuizResponse {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed))
        return parsed.filter(
          (item): item is string => typeof item === "string",
        );
      if (parsed && typeof parsed === "object")
        return Object.fromEntries(
          Object.entries(parsed).flatMap(([key, item]) =>
            typeof item === "string" ||
            (Array.isArray(item) &&
              item.every((candidate) => typeof candidate === "string"))
              ? [[key, item as string | string[]]]
              : [],
          ),
        );
      return value;
    } catch {
      return value;
    }
  }

  function answerObject(questionId: string) {
    const value = answerResponseValue(answers[questionId] ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  }

  const displayedQuestions: QuizQuestion[] = practiceAttempt
    ? practiceAttempt.questions.map((question, index) =>
        normalizeQuizQuestion(question, index),
      )
    : questions;
  const activeDisplayedQuestionIndex = Math.max(
    0,
    displayedQuestions.findIndex(
      (question) => question.id === activeQuestionId,
    ),
  );
  const activeDisplayedQuestionId =
    displayedQuestions[activeDisplayedQuestionIndex]?.id;
  const practiceAttemptId = practiceAttempt?.attemptId;
  const practiceAttemptStatus = practiceAttempt?.status;
  const activePracticeQuestionClock = activeDisplayedQuestionId
    ? practiceQuestionClocks[activeDisplayedQuestionId]
    : undefined;
  const practiceResultByQuestion = new Map(
    (practiceAttempt?.results ?? []).map((result) => [
      result.questionId,
      result,
    ]),
  );
  const revealedPracticeResultByQuestion = new Map([
    ...practiceResultByQuestion,
    ...Object.values(practiceFeedback).map(
      (result) => [result.questionId, result] as const,
    ),
  ]);
  /**
   * Which questions actually carry an answer. Multi-value types are stored as a
   * JSON array, and an empty array is not an answer, so a learner is never told
   * a question is done when nothing was chosen.
   */
  const answeredQuestionIds = new Set(
    displayedQuestions
      .filter((question) => {
        const answer = (answers[question.id] ?? "").trim();
        if (!answer) return false;
        if (!answer.startsWith("[") && !answer.startsWith("{")) return true;
        try {
          const parsed: unknown = JSON.parse(answer);
          return Array.isArray(parsed)
            ? parsed.length > 0
            : Boolean(
                parsed &&
                typeof parsed === "object" &&
                Object.keys(parsed).length,
              );
        } catch {
          return true;
        }
      })
      .map((question) => question.id),
  );
  const answeredQuestionCount = answeredQuestionIds.size;
  const unansweredQuestionCount =
    displayedQuestions.length - answeredQuestionCount;
  const isLastDisplayedQuestion =
    displayedQuestions.length === 0 ||
    activeDisplayedQuestionIndex >= displayedQuestions.length - 1;
  const attemptScoreCounts = (() => {
    let correct = 0;
    let incorrect = 0;
    let pending = 0;
    for (const question of displayedQuestions) {
      if (practiceAttempt) {
        const result = revealedPracticeResultByQuestion.get(question.id);
        if (result?.correct === true) correct += 1;
        else if (result?.correct === false) incorrect += 1;
        else pending += 1;
      } else if (question.type === "long_response") pending += 1;
      else if (questionCorrect(question)) correct += 1;
      else incorrect += 1;
    }
    return { correct, incorrect, pending };
  })();
  /** The score as a percentage, from the server for a real attempt. */
  const attemptPercentage =
    practiceAttempt?.status === "submitted"
      ? (practiceAttempt.percentage ?? undefined)
      : submitted && displayedQuestions.length
        ? Math.round(
            (displayedQuestions.filter((question) => questionCorrect(question))
              .length /
              displayedQuestions.length) *
              100,
          )
        : undefined;
  /**
   * The countdown belongs to the server. The tab only interpolates between
   * anchors, so a refresh, a sleeping laptop or a clock that is minutes off
   * cannot buy extra time — the next anchor snaps the display back (§11C).
   */
  const practiceSecondsRemaining = practiceClock
    ? Math.max(
        0,
        Math.ceil(
          (practiceClock.remainingMs -
            Math.max(0, practiceClockNow - practiceClock.at)) /
            1_000,
        ),
      )
    : null;
  const practiceQuestionSecondsRemaining = activePracticeQuestionClock
    ? Math.max(
        0,
        Math.ceil(
          (activePracticeQuestionClock.remainingMs -
            Math.max(0, practiceClockNow - activePracticeQuestionClock.at)) /
            1_000,
        ),
      )
    : null;
  const practiceShowTimerWarnings =
    record(record(practiceAttempt?.settings).accessibilityPolicy)
      .showTimerWarnings !== false;
  const activeQuestionInputDisabled =
    submitted ||
    (practiceAttempt?.status === "in_progress" &&
      practiceQuestionSecondsRemaining === 0);
  const practiceExperience = practiceAttempt?.experience;
  const practiceAnswersRevealed = practiceAttempt?.answersRevealed !== false;
  const resumableAttempt = practiceAttempts.find(
    (attempt) => attempt.status === "in_progress",
  );
  const latestSubmittedAttempt = practiceAttempts.find(
    (attempt) => attempt.status === "submitted",
  );
  /**
   * The modes this person can actually use. Two questions, two authorities:
   * `work/registry` says whether this role may do the thing at all, and
   * `availableQuizModes` (§11C) says whether this quiz's own configuration
   * offers it. A mode has to clear both, so a learner never sees Build and a
   * teacher never sees Responses on a quiz that keeps nothing. An unusable mode
   * is absent rather than disabled.
   */
  const configuredQuizModes = availableQuizModes(quizSettings.experience, {
    canEdit: canEditQuiz,
    viewer: canEditQuiz ? "teacher" : "learner",
    hasSubmittedAttempt: Boolean(latestSubmittedAttempt),
  });
  const quizModes = useMemo(() => {
    const configured = new Set(configuredQuizModes);
    return studio.modes.flatMap((mode) => {
      const quizMode = REGISTRY_QUIZ_MODES[mode.id];
      return quizMode && configured.has(quizMode) ? [quizMode] : [];
    });
  }, [configuredQuizModes, studio.modes]);
  const activeQuizMode: QuizMode =
    view === "builder" || view === "settings"
      ? "build"
      : view === "summary"
        ? "responses"
        : view === "responses"
          ? "results"
          : practiceAttempt
            ? "attempt"
            : "preview";

  function openQuizMode(next: QuizMode) {
    if (next === "build") {
      setView("builder");
      return;
    }
    if (next === "preview") {
      setPracticeAttempt(undefined);
      setPracticeClock(undefined);
      setAnswers({});
      setSubmitted(false);
      setInspectAttempt(false);
      setPracticeFeedback({});
      setView("preview");
      return;
    }
    if (next === "attempt") {
      // Resuming beats starting: a half-finished attempt is the learner's
      // work, and a second one would quietly spend an allowance.
      if (practiceAttempt?.status === "in_progress") setView("preview");
      else if (resumableAttempt) hydratePracticeAttempt(resumableAttempt);
      else void beginPractice();
      return;
    }
    if (next === "responses") {
      setView("summary");
      return;
    }
    if (latestSubmittedAttempt) hydratePracticeAttempt(latestSubmittedAttempt);
    else setView("responses");
  }

  /**
   * The one-click way out of the Attempt activity (CANON D3). Nothing is
   * discarded: responses are already on the server and an in-progress attempt
   * stays resumable from Your attempts, so leaving is safe by construction.
   * An owner lands back in authoring; a learner lands on their attempts.
   */
  function leaveAttempt() {
    setPracticeAttempt(undefined);
    setPracticeClock(undefined);
    setPracticeQuestionClocks({});
    setAnswers({});
    setSubmitted(false);
    setInspectAttempt(false);
    setPracticeFeedback({});
    setPracticeError(undefined);
    setView(canEditQuiz ? "builder" : "responses");
  }

  function goDisplayedQuestion(delta: -1 | 1) {
    const next = displayedQuestions[activeDisplayedQuestionIndex + delta];
    if (next) setActiveQuestionId(next.id);
  }

  function anchorPracticeClock(remainingMs: number | null | undefined) {
    setPracticeClock(
      typeof remainingMs === "number"
        ? { remainingMs, at: currentTimeMs() }
        : undefined,
    );
  }

  function hydratePracticeAttempt(attempt: SpectraQuizPracticeAttempt) {
    setPracticeAttempt(attempt);
    anchorPracticeClock(
      attempt.status === "in_progress" ? attempt.timeRemainingMs : undefined,
    );
    const anchor = currentTimeMs();
    setPracticeQuestionClocks(
      Object.fromEntries(
        Object.entries(attempt.questionTiming ?? {}).flatMap(
          ([questionId, timing]) =>
            typeof timing.remainingMs === "number"
              ? [[questionId, { remainingMs: timing.remainingMs, at: anchor }]]
              : [],
        ),
      ),
    );
    setAnswers(
      Object.fromEntries(
        Object.entries(attempt.responses).map(([questionId, response]) => [
          questionId,
          typeof response === "string" ? response : JSON.stringify(response),
        ]),
      ),
    );
    setSubmitted(attempt.status === "submitted");
    setInspectAttempt(false);
    setPracticeFeedback(
      Object.fromEntries(
        (attempt.results ?? []).map((result) => [result.questionId, result]),
      ),
    );
    setPracticeError(undefined);
    setView("preview");
  }

  function commitCollections(input: {
    questions?: QuizQuestion[];
    banks?: QuizBank[];
    pools?: QuizPool[];
  }) {
    const nextQuestions = input.questions ?? questions;
    const nextBanks = input.banks ?? banks;
    const nextPools = input.pools ?? pools;
    setQuestions(nextQuestions);
    setBanks(nextBanks);
    setPools(nextPools);
    setPublished(false);
    setPublishIssues([]);
    onChange({
      ...record(content),
      questions: nextQuestions,
      banks: nextBanks,
      pools: nextPools,
      settings: quizSettings,
      published: false,
    });
  }

  function addBank() {
    const bank: QuizBank = {
      id: id("bank"),
      name: `Bank ${banks.length + 1}`,
    };
    commitCollections({ banks: [...banks, bank] });
  }

  function removeBank(bankId: string) {
    commitCollections({
      banks: banks.filter((bank) => bank.id !== bankId),
      questions: questions.map((question) =>
        question.bankId === bankId
          ? { ...question, bankId: undefined }
          : question,
      ),
    });
  }

  function addPool() {
    const pool: QuizPool = {
      id: id("pool"),
      name: `Pool ${pools.length + 1}`,
      drawCount: 1,
    };
    commitCollections({ pools: [...pools, pool] });
  }

  function removePool(poolId: string) {
    commitCollections({
      pools: pools.filter((pool) => pool.id !== poolId),
      questions: questions.map((question) =>
        question.poolId === poolId
          ? { ...question, poolId: undefined, poolDrawCount: undefined }
          : question,
      ),
    });
  }

  function exportQuizAggregate() {
    if (!responseSummary?.available) return;
    const rows: Array<Array<string | number>> = [
      ["metric", "key", "value"],
      ["cohort", "attempts", responseSummary.attemptCount],
      ["cohort", "submitted", responseSummary.submittedCount],
      ["cohort", "in_progress", responseSummary.inProgressCount],
      ["cohort", "timed_out", responseSummary.timeElapsedCount],
      ["cohort", "average_percentage", responseSummary.averagePercentage ?? ""],
      ["duration", "median_ms", responseSummary.duration?.medianMs ?? ""],
      ["duration", "min_ms", responseSummary.duration?.minMs ?? ""],
      ["duration", "max_ms", responseSummary.duration?.maxMs ?? ""],
      ...responseSummary.scoreDistribution.map((bucket) => [
        "score_bucket",
        bucket.label,
        bucket.count,
      ]),
      ...responseSummary.questions.flatMap((question) => [
        ["question_answered", question.questionId, question.answered],
        ["question_correct", question.questionId, question.correct],
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `quiz-${artifactId}-aggregate.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    if (
      !practiceAttemptId ||
      practiceAttemptStatus !== "in_progress" ||
      !activeDisplayedQuestionId
    )
      return;
    let active = true;
    void visitSpectraQuizPracticeQuestion({
      attemptId: practiceAttemptId,
      questionId: activeDisplayedQuestionId,
    })
      .then((timing) => {
        if (!active) return;
        setPracticeAttempt((current) =>
          current
            ? {
                ...current,
                questionTiming: {
                  ...(current.questionTiming ?? {}),
                  [activeDisplayedQuestionId]: {
                    startedAt: timing.startedAt,
                    remainingMs: timing.questionTimeRemainingMs,
                  },
                },
              }
            : current,
        );
        const remainingMs = timing.questionTimeRemainingMs;
        if (typeof remainingMs === "number")
          setPracticeQuestionClocks((current) => ({
            ...current,
            [activeDisplayedQuestionId]: {
              remainingMs,
              at: currentTimeMs(),
            },
          }));
      })
      .catch((error: unknown) => {
        if (active) {
          if (
            error instanceof Error &&
            error.message.includes("QUIZ_QUESTION_TIME_ELAPSED")
          )
            setPracticeQuestionClocks((current) => ({
              ...current,
              [activeDisplayedQuestionId]: {
                remainingMs: 0,
                at: currentTimeMs(),
              },
            }));
          setPracticeError(
            quizPracticeErrorMessage(
              error,
              "This question’s timer could not be synchronized.",
            ),
          );
        }
      });
    return () => {
      active = false;
    };
  }, [activeDisplayedQuestionId, practiceAttemptId, practiceAttemptStatus]);

  async function beginPractice() {
    // The bar already hides an action the viewer cannot perform; this is the
    // same truth guarded at the action, so no other caller can route around it.
    if (!canAttemptQuiz) {
      setPracticeError("You do not have permission to attempt this quiz.");
      return;
    }
    if (!published) {
      setPracticeError(
        "Publish this formative quiz before starting a private attempt.",
      );
      setView("preview");
      return;
    }
    if (!synchronizationReady) {
      setPracticeError(
        "The published version is still synchronizing. Practice will be available as soon as the live state is durable.",
      );
      setView("preview");
      return;
    }
    setPracticeBusy(true);
    setPracticeError(undefined);
    try {
      const attempt = await startSpectraQuizPractice({
        artifactId,
        clientAttemptId: crypto.randomUUID(),
      });
      hydratePracticeAttempt(attempt);
      setPracticeAttempts((current) => [
        attempt,
        ...current.filter((item) => item.attemptId !== attempt.attemptId),
      ]);
    } catch (error) {
      setPracticeError(
        quizPracticeErrorMessage(
          error,
          "The private practice attempt could not be started.",
        ),
      );
    } finally {
      setPracticeBusy(false);
    }
  }

  async function synchronizePracticeAnswer(questionId: string, value: string) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
    if (!practiceAttempt || practiceAttempt.status !== "in_progress") return;
    setPracticeSyncing((current) => [...new Set([...current, questionId])]);
    setPracticeError(undefined);
    try {
      const synchronized = await saveSpectraQuizPracticeResponse({
        attemptId: practiceAttempt.attemptId,
        questionId,
        response: answerResponseValue(value),
        clientMutationId: crypto.randomUUID(),
      });
      if (synchronized.result)
        setPracticeFeedback((current) => ({
          ...current,
          [questionId]: synchronized.result!,
        }));
      if (synchronized.timeRemainingMs !== undefined)
        anchorPracticeClock(synchronized.timeRemainingMs);
      const questionRemainingMs = synchronized.questionTimeRemainingMs;
      if (typeof questionRemainingMs === "number")
        setPracticeQuestionClocks((current) => ({
          ...current,
          [questionId]: {
            remainingMs: questionRemainingMs,
            at: currentTimeMs(),
          },
        }));
      setPracticeAttempt((current) =>
        current
          ? {
              ...current,
              responses: {
                ...current.responses,
                [questionId]: answerResponseValue(value),
              },
            }
          : current,
      );
    } catch (error) {
      setPracticeError(
        `${quizPracticeErrorMessage(
          error,
          "Your latest answer is not synchronized.",
        )} Reconnect before submitting.`,
      );
    } finally {
      setPracticeSyncing((current) =>
        current.filter((id) => id !== questionId),
      );
    }
  }

  async function submitPracticeAttempt() {
    if (!practiceAttempt || practiceAttempt.status !== "in_progress") return;
    setPracticeBusy(true);
    setPracticeError(undefined);
    try {
      for (const [questionId, value] of Object.entries(answers)) {
        try {
          await saveSpectraQuizPracticeResponse({
            attemptId: practiceAttempt.attemptId,
            questionId,
            response: answerResponseValue(value),
            clientMutationId: crypto.randomUUID(),
          });
        } catch {
          // Each answer was already saved as it was written; this pass is a
          // final flush. A rejected save — most often a clock that has just run
          // out — must not stand between the learner and their submission.
        }
      }
      const submittedAttempt = await submitSpectraQuizPractice({
        attemptId: practiceAttempt.attemptId,
        clientSubmissionId: crypto.randomUUID(),
      });
      hydratePracticeAttempt(submittedAttempt);
      setPracticeAttempts((current) => [
        submittedAttempt,
        ...current.filter(
          (item) => item.attemptId !== submittedAttempt.attemptId,
        ),
      ]);
    } catch (error) {
      setPracticeError(
        quizPracticeErrorMessage(
          error,
          "The attempt could not be safely submitted.",
        ),
      );
    } finally {
      setPracticeBusy(false);
    }
  }

  useEffect(() => {
    // A countdown that reaches zero submits what the learner has, once. The
    // server is the authority on expiry; this only saves them from staring at
    // 0:00 wondering whether their work was kept (§11C).
    if (
      practiceSecondsRemaining !== 0 ||
      practiceAttempt?.status !== "in_progress" ||
      practiceAutoSubmitted.current === practiceAttempt.attemptId
    )
      return;
    practiceAutoSubmitted.current = practiceAttempt.attemptId;
    void submitPracticeAttempt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    practiceSecondsRemaining,
    practiceAttempt?.attemptId,
    practiceAttempt?.status,
  ]);

  function questionCorrect(question: QuizQuestion) {
    if (practiceAttempt?.status === "submitted")
      return (
        revealedPracticeResultByQuestion.get(question.id)?.correct === true
      );
    if (question.type === "long_response") return false;
    return (
      gradeQuizQuestion(
        question,
        answerResponseValue(answers[question.id] ?? ""),
      ).correct === true
    );
  }

  function publishQuiz() {
    const issues = validateQuizForPublishing(
      questions as PortableQuizQuestion[],
      {
        banks,
        pools,
        reviewPolicy: quizSettings.reviewPolicy,
        accessibilityPolicy: quizSettings.accessibilityPolicy,
        enforceQuestionTimeLimits: quizSettings.enforceQuestionTimeLimits,
      },
    );
    if (issues.length) {
      setPublishIssues(issues);
      setView("builder");
      const firstQuestionId = issues.find(
        (issue) => issue.questionId,
      )?.questionId;
      if (
        firstQuestionId &&
        questions.some((question) => question.id === firstQuestionId)
      )
        setActiveQuestionId(firstQuestionId);
      return;
    }
    setPublishIssues([]);
    setPublished(true);
    onChange({
      ...record(content),
      questions,
      banks,
      pools,
      settings: quizSettings,
      published: true,
      publishedAt: currentTimeMs(),
    });
  }

  /**
   * Withdrawing a quiz on purpose. Attempts already taken are pinned to their
   * own snapshot, so unpublishing stops new ones without touching old ones.
   */
  function unpublishQuiz() {
    setPublished(false);
    setPublishIssues([]);
    onChange({
      ...record(content),
      questions,
      banks,
      pools,
      settings: quizSettings,
      published: false,
    });
  }

  async function importQuiz(file: File) {
    setQuizImporting(true);
    setQuizImportError(undefined);
    setQuizImportReport(undefined);
    let jobId: string | undefined;
    try {
      const extension = file.name.split(".").pop()?.toLowerCase() || "unknown";
      const beginning = await beginArtifactImportOriginal({
        artifactId,
        typeKey: "quiz",
        format: extension,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: file.size,
        sha256: await artifactBlobSha256(file),
      });
      jobId = beginning.jobId;
      await uploadArtifactImportOriginal(jobId, file);
      const result = await parseQuizImport(file);
      const imported = result.content.questions.map(
        (question, index): QuizQuestion =>
          normalizeQuizQuestion(
            {
              ...question,
              options: question.options ?? [],
              optionIds: (question.options ?? []).map(
                (_, optionIndex) =>
                  `${question.id}:option:${optionIndex + 1}-${crypto.randomUUID()}`,
              ),
              difficulty: question.difficulty ?? "medium",
              points: question.points ?? 1,
              timeLimitSeconds: question.timeLimitSeconds ?? 90,
            },
            index,
          ),
      );
      const onlyBlankStarter =
        questions.length === 1 &&
        !questions[0]?.prompt.trim() &&
        questions[0]?.options.every((option) => !option.trim());
      const next = onlyBlankStarter ? imported : [...questions, ...imported];
      const nextBanks = [
        ...banks,
        ...(result.content.banks ?? []).filter(
          (bank) => !banks.some((candidate) => candidate.id === bank.id),
        ),
      ];
      const nextPools = [
        ...pools,
        ...(result.content.pools ?? []).filter(
          (pool) => !pools.some((candidate) => candidate.id === pool.id),
        ),
      ];
      const nextSettings = result.content.settings
        ? quizSettingsFromContent({ settings: result.content.settings })
        : quizSettings;
      setQuestions(next);
      setBanks(nextBanks);
      setPools(nextPools);
      setQuizSettings(nextSettings);
      setPublished(false);
      setPublishIssues([]);
      onChange({
        ...record(content),
        questions: next,
        banks: nextBanks,
        pools: nextPools,
        settings: nextSettings,
        published: false,
      });
      setActiveQuestionId(imported[0]?.id ?? next[0]?.id ?? "");
      await completeArtifactImport({
        jobId,
        typeKey: "quiz",
        status: "imported",
        fidelityReport: result.fidelity,
        unsupportedFeatures: result.unsupportedFeatures,
        importedContent: {
          questions: imported,
          banks: result.content.banks,
          pools: result.content.pools,
          settings: result.content.settings,
        },
      });
      setQuizImportReport(
        `${imported.length} question${imported.length === 1 ? "" : "s"} imported as editable formative content from ${file.name}. The original is retained for recovery.${
          result.unsupportedFeatures.length
            ? ` Fidelity notes: ${result.unsupportedFeatures.slice(0, 4).join("; ")}${result.unsupportedFeatures.length > 4 ? `; and ${result.unsupportedFeatures.length - 4} more in import history.` : "."}`
            : ""
        }`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The quiz import was quarantined.";
      setQuizImportError(message);
      if (jobId) {
        await completeArtifactImport({
          jobId,
          typeKey: "quiz",
          status: "quarantined",
          fidelityReport: [
            { scope: "quiz import", level: "unsupported", message },
          ],
          unsupportedFeatures: [message],
          quarantineReason: message,
        }).catch(() =>
          abortArtifactImportUpload(jobId!, message).catch(() => undefined),
        );
      }
    } finally {
      setQuizImporting(false);
      if (quizImportRef.current) quizImportRef.current.value = "";
    }
  }

  function exportQuizInterchange(
    format: "qti-2.2" | "csv" | "spectra-json" | "print",
  ) {
    const fidelity = quizExportFidelity(questions, format);
    if (format === "print") {
      setQuizImportReport(
        fidelity.notes.join(" ") ||
          "The print sheet preserves the visible formative question sequence.",
      );
      window.print();
      return;
    }
    const blob =
      format === "spectra-json"
        ? new Blob(
            [quizJson({ questions, settings: quizSettings, banks, pools })],
            { type: "application/json" },
          )
        : format === "csv"
          ? new Blob([quizCsv(questions)], {
              type: "text/csv;charset=utf-8",
            })
          : quizQtiPackage(questions);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `quiz.${format === "spectra-json" ? "json" : format === "qti-2.2" ? "zip" : "csv"}`;
    link.click();
    URL.revokeObjectURL(url);
    setQuizImportReport(
      fidelity.notes.length
        ? `Exported with fidelity notes: ${fidelity.notes.join(" ")}`
        : `Exported ${format} with exact supported question content.`,
    );
  }

  /**
   * One bar, declared rather than drawn. Modes are `[]` on purpose: Attempt and
   * Preview as learner are activities, and CANON D3 forbids an activity as a
   * peer tab beside authoring, so they are declared as actions with the
   * capability each one needs. The bar decides what sheds and what promotes into
   * `⋯`; this type only says what its controls mean.
   */
  const workbarActions: CommandBinding[] = projectBindingsFromIr(
    "quiz",
    canEditQuiz
      ? [
          activeQuizMode === "build"
            ? {
                id: "preview",
                label: "Preview as learner",
                icon: Eye,
                priority: "essential",
                onSelect: () => openQuizMode("preview"),
              }
            : {
                id: "build",
                label: "Back to build",
                icon: Pencil,
                priority: "essential",
                keepLabel: true,
                onSelect: () => openQuizMode("build"),
              },
          {
            id: "settings",
            label: "Quiz settings",
            icon: SlidersHorizontal,
            active: view === "settings",
            // Every one of these is a toggle, not a one-way door: pressing the
            // active control returns to authoring.
            onSelect: () =>
              setView(view === "settings" ? "builder" : "settings"),
          },
          ...(showQuestionRail
            ? [
                {
                  id: "questions",
                  label: questionNavigatorOpen
                    ? "Hide questions"
                    : "Show questions",
                  icon: PanelLeft,
                  priority: "essential" as const,
                  active: questionNavigatorOpen,
                  onSelect: () => setQuestionNavigatorOpen((open) => !open),
                },
              ]
            : []),
          ...(view === "builder"
            ? [
                {
                  id: "question.add",
                  label: "Add question",
                  icon: Plus,
                  priority: "secondary" as const,
                  onSelect: addQuestion,
                },
                {
                  id: "question-details",
                  label: "Question details",
                  icon: List,
                  priority: "secondary" as const,
                  active: questionDetailsOpen,
                  onSelect: () => setQuestionDetailsOpen((open) => !open),
                },
              ]
            : []),
          ...(view === "settings"
            ? [
                {
                  id: "bank.create",
                  label: "Add bank",
                  icon: Plus,
                  priority: "advanced" as const,
                  onSelect: addBank,
                },
                {
                  id: "pool.create",
                  label: "Add pool",
                  icon: Shuffle,
                  priority: "advanced" as const,
                  onSelect: addPool,
                },
              ]
            : []),
          ...(quizModes.includes("responses")
            ? [
                {
                  id: "cohort",
                  label: "Cohort responses",
                  icon: BarChart3,
                  active: view === "summary",
                  onSelect: () =>
                    view === "summary"
                      ? openQuizMode("build")
                      : openQuizMode("responses"),
                } as CommandBinding,
              ]
            : []),
          {
            id: "attempts",
            label: "Your attempts",
            icon: History,
            active: view === "responses",
            onSelect: () =>
              setView(view === "responses" ? "builder" : "responses"),
          },
          ...(view === "summary" && responseSummary?.available
            ? [
                {
                  id: "analytics.export",
                  label: "Export aggregate CSV",
                  icon: Import,
                  priority: "advanced" as const,
                  onSelect: exportQuizAggregate,
                },
              ]
            : []),
          {
            id: "import",
            label: quizImporting ? "Importing questions…" : "Import questions",
            icon: quizImporting ? Loader2 : Import,
            priority: "advanced",
            disabled: quizImporting,
            onSelect: () => quizImportRef.current?.click(),
          },
          {
            id: "export.interchange",
            label: "Export quiz",
            icon: Import,
            priority: "advanced",
            control: {
              kind: "menu",
              options: [
                { value: "spectra-json", label: "Spectra JSON · exact v4" },
                { value: "qti-2.2", label: "QTI 2.2 package" },
                { value: "csv", label: "CSV question table" },
                { value: "print", label: "Print / save PDF" },
              ],
            },
            onSelect: (value) =>
              exportQuizInterchange(
                (typeof value === "string" ? value : "spectra-json") as
                  "qti-2.2" | "csv" | "spectra-json" | "print",
              ),
          },
          ...(published
            ? [
                {
                  id: "unpublish",
                  label: "Unpublish",
                  icon: EyeOff,
                  priority: "advanced",
                  hint: "Stops new attempts; attempts already taken keep their own version",
                  onSelect: unpublishQuiz,
                } as CommandBinding,
              ]
            : []),
        ]
      : [
          {
            id: "attempts",
            label: "Your attempts",
            icon: History,
            priority: "essential",
            active: view === "responses",
            onSelect: () => setView("responses"),
          },
        ],
  );

  return (
    <div className="spectra-quiz-studio bg-transparent">
      <ArtifactWorkbar
        label="Quiz"
        modes={[]}
        selector={
          view === "builder" && questions.length > 0 ? (
            <WorkbarItemSelector
              ariaLabel="Current question"
              itemNoun="question"
              value={activeQuestion?.id ?? ""}
              onChange={setActiveQuestionId}
              items={questions.map((question) => ({
                value: question.id,
                label:
                  plannerDescriptionText(question.prompt) ||
                  "Untitled question",
              }))}
            />
          ) : undefined
        }
        actions={workbarActions}
        primary={
          // One verb, and it is whichever one is actually next: an unpublished
          // quiz has to be published before anyone can sit it, and a published
          // one is sat. A disabled primary would be a dead control.
          published || !canEditQuiz
            ? {
                label: "Attempt",
                icon: Radio,
                requires: "attempt",
                busy: practiceBusy,
                disabled: !published || !synchronizationReady,
                onSelect: () => openQuizMode("attempt"),
              }
            : {
                label: publishedAt ? "Publish changes" : "Publish",
                requires: "edit",
                onSelect: publishQuiz,
              }
        }
      />
      {canEditQuiz ? (
        <input
          ref={quizImportRef}
          type="file"
          hidden
          accept=".json,.csv,.tsv,.xml,.zip,.qti,application/json,text/csv,text/tab-separated-values,application/xml,text/xml,application/zip"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void importQuiz(file);
          }}
        />
      ) : null}
      <div className="spectra-editor-body">
        {/* Publish state is a fact about this quiz, so it is stated rather than
            left to be inferred from which verb the primary happens to show.
            Editing a published quiz withdraws it: attempts are pinned to the
            version they started on, and the next attempt must not snapshot
            questions nobody has re-validated. */}
        {canEditQuiz && !publishIssues.length ? (
          <p
            className="border-b border-[var(--border-subtle)] px-4 py-2 text-[11px] leading-5 text-[var(--text-secondary)]"
            role="status"
          >
            {published ? (
              <>
                <strong className="font-semibold text-[var(--success)]">
                  Published
                </strong>
                {publishedAt ? ` on ${formatShortDate(publishedAt)}.` : "."}{" "}
                Learners can attempt it now.
              </>
            ) : publishedAt ? (
              <>
                <strong className="font-semibold text-[var(--warning)]">
                  Edits are not published.
                </strong>{" "}
                Learners keep the version published on{" "}
                {formatShortDate(publishedAt)} until you publish again.
              </>
            ) : (
              <>
                <strong className="font-semibold text-[var(--text-primary)]">
                  Draft.
                </strong>{" "}
                Nobody can attempt this quiz until you publish it.
              </>
            )}
          </p>
        ) : null}
        {quizImportReport || quizImportError || publishIssues.length ? (
          <div
            className={`border-b px-4 py-3 ${quizImportError || publishIssues.length ? "border-[color-mix(in_oklab,var(--danger)_28%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_4%,var(--bg-primary))]" : "border-[color-mix(in_oklab,var(--success)_24%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_4%,var(--bg-primary))]"}`}
            role="status"
          >
            <div className="flex items-start gap-2">
              {quizImportError || publishIssues.length ? (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" />
              )}
              <div className="min-w-0 flex-1 text-[11px] leading-5 text-[var(--text-secondary)]">
                <strong className="block text-[var(--text-primary)]">
                  {publishIssues.length
                    ? "Resolve these before publishing"
                    : quizImportError
                      ? "Import quarantined"
                      : "Interchange complete"}
                </strong>
                {publishIssues.length ? (
                  <ul className="mt-1 list-disc pl-4">
                    {publishIssues.slice(0, 8).map((issue, index) => (
                      <li key={`${issue.questionId ?? "quiz"}-${index}`}>
                        <button
                          type="button"
                          className="text-left hover:underline"
                          onClick={() => {
                            if (issue.questionId)
                              setActiveQuestionId(issue.questionId);
                            setView("builder");
                          }}
                        >
                          {issue.message}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  quizImportError || quizImportReport
                )}
              </div>
              <button
                type="button"
                className={iconButtonClass()}
                onClick={() => {
                  setPublishIssues([]);
                  setQuizImportError(undefined);
                  setQuizImportReport(undefined);
                }}
                aria-label="Dismiss quiz notice"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : null}
        {view === "preview" ? (
          <div className="p-5">
            <div className="mx-auto max-w-[760px] space-y-3">
              {/* An activity states what it is and how to leave it, from
                  inside itself (CANON D3). The exit is a labelled verb, not an
                  icon in the chrome, and leaving never discards work: the
                  attempt lives on the server and stays resumable. */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-[24px] font-semibold text-[var(--text-primary)]">
                      {practiceAttempt
                        ? practiceAttempt.status === "submitted"
                          ? "Your result"
                          : "Your attempt"
                        : "Quiz preview"}
                    </h3>
                    {practiceAttempt?.status === "in_progress" ? (
                      <span className="rounded-[6px] border border-[color-mix(in_oklab,var(--accent-cyan)_34%,var(--border-default))] px-2 py-0.5 text-micro font-semibold uppercase tracking-[0.07em] text-[var(--accent-cyan)]">
                        In progress
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                    {practiceAttempt
                      ? practiceAttempt.status === "submitted"
                        ? practiceAttempt.timeElapsed
                          ? "Submitted when the clock ran out. Everything you had answered was kept."
                          : "This result is yours. It is pinned to the version you answered."
                        : "Answers save as you write them. Reconnect before submitting if that is interrupted."
                      : "Preview stays local. Attempt creates a private attempt pinned to this quiz version; preview does not, and does not spend one of yours."}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                    {describeQuizExperience(
                      practiceExperience ?? quizSettings.experience,
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {submitted ? (
                    <div className="rounded-[8px] bg-[color-mix(in_oklab,var(--success)_9%,var(--bg-primary))] px-3 py-2 text-right text-[12px] font-semibold text-[var(--success)]">
                      {practiceAttempt?.status === "submitted"
                        ? typeof practiceAttempt.score === "number" &&
                          typeof practiceAttempt.maxScore === "number"
                          ? `${practiceAttempt.score}/${practiceAttempt.maxScore} points · ${practiceAttempt.percentage ?? 0}%`
                          : "Submitted · score hidden"
                        : `${displayedQuestions.filter((question) => questionCorrect(question)).length}/${displayedQuestions.length} correct`}
                      {/* The practice target is set in settings, so a result
                          that never mentions it made the setting decorative. */}
                      {attemptPercentage !== undefined ? (
                        <span className="mt-0.5 block text-micro font-medium text-[var(--text-secondary)]">
                          {attemptPercentage >= quizSettings.targetScore
                            ? `At or above your ${quizSettings.targetScore}% practice target`
                            : `${quizSettings.targetScore - attemptPercentage} points below your ${quizSettings.targetScore}% practice target`}
                        </span>
                      ) : null}
                    </div>
                  ) : practiceSecondsRemaining !== null ? (
                    <div
                      className={`rounded-[8px] border px-3 py-2 text-right ${
                        practiceSecondsRemaining > 60
                          ? "border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                          : practiceSecondsRemaining > 0
                            ? "border-[color-mix(in_oklab,var(--warning)_40%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_6%,var(--bg-primary))] text-[var(--warning)]"
                            : "border-[color-mix(in_oklab,var(--danger)_40%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_6%,var(--bg-primary))] text-[var(--danger)]"
                      }`}
                      role="timer"
                      aria-live="off"
                    >
                      <strong className="block font-display text-[16px] tabular-nums">
                        {practiceSecondsRemaining > 0
                          ? quizClockLabel(practiceSecondsRemaining)
                          : "0:00"}
                      </strong>
                      <span className="text-micro text-[var(--text-tertiary)]">
                        {practiceSecondsRemaining > 0
                          ? practiceExperience?.timing === "deadline"
                            ? "Until this quiz closes"
                            : "Left on this attempt"
                          : "Submitting your answers"}
                      </span>
                    </div>
                  ) : null}
                  {practiceAttempt ? (
                    <button
                      type="button"
                      onClick={leaveAttempt}
                      className="h-9 shrink-0 whitespace-nowrap rounded-[8px] border border-[var(--border-strong)] bg-[var(--bg-primary)] px-3 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                    >
                      {practiceAttempt.status === "submitted"
                        ? "Close result"
                        : "Leave attempt"}
                    </button>
                  ) : canEditQuiz ? (
                    <button
                      type="button"
                      onClick={() => openQuizMode("build")}
                      className="h-9 shrink-0 whitespace-nowrap rounded-[8px] border border-[var(--border-strong)] bg-[var(--bg-primary)] px-3 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                    >
                      Back to build
                    </button>
                  ) : null}
                </div>
              </div>
              {practiceAttempt?.instructions || quizSettings.instructions ? (
                <div className="rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3 text-[11px] leading-5 text-[var(--text-secondary)]">
                  <strong className="mr-1 text-[var(--text-primary)]">
                    Before you begin:
                  </strong>
                  {practiceAttempt?.instructions || quizSettings.instructions}
                </div>
              ) : null}
              {practiceAttempt?.status === "submitted" &&
              !practiceAnswersRevealed ? (
                <div className="rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3 text-[11px] leading-5 text-[var(--text-secondary)]">
                  <strong className="mr-1 text-[var(--text-primary)]">
                    Answers are not shown yet.
                  </strong>
                  {practiceExperience?.revealAnswers === "after_deadline"
                    ? "They open once this quiz closes."
                    : "This quiz keeps its answer key."}
                </div>
              ) : null}
              {practiceError ? (
                <div className="flex items-start gap-2 rounded-[9px] border border-[color-mix(in_oklab,var(--danger)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_5%,var(--bg-primary))] p-3 text-[11px] leading-5 text-[var(--danger)]">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{practiceError}</span>
                </div>
              ) : null}
              {submitted && !inspectAttempt ? (
                <div className="space-y-4">
                  <QuizResultPie
                    correct={attemptScoreCounts.correct}
                    incorrect={attemptScoreCounts.incorrect}
                    pending={attemptScoreCounts.pending}
                  />
                  <button
                    type="button"
                    className="h-9 shrink-0 whitespace-nowrap rounded-[8px] bg-[var(--text-primary)] px-3 text-[12px] font-medium text-[var(--bg-primary)]"
                    onClick={() => setInspectAttempt(true)}
                  >
                    Inspect answers
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-micro font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                        {practiceAttempt ? "Answer sheet" : "Questions"}
                      </span>
                      <span className="text-micro text-[var(--text-secondary)]">
                        {answeredQuestionCount} of {displayedQuestions.length}{" "}
                        answered
                      </span>
                    </div>
                    <div
                      className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--bg-secondary)]"
                      role="progressbar"
                      aria-label="Questions answered"
                      aria-valuemin={0}
                      aria-valuemax={displayedQuestions.length}
                      aria-valuenow={answeredQuestionCount}
                    >
                      <div
                        className="h-full rounded-full bg-[var(--text-primary)] transition-[width] duration-300 ease-out motion-reduce:transition-none"
                        style={{
                          width: `${displayedQuestions.length ? (answeredQuestionCount / displayedQuestions.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    {submitted && inspectAttempt ? (
                      <nav
                        aria-label={
                          practiceAttempt
                            ? "Attempt questions"
                            : "Preview questions"
                        }
                        className="mt-2.5 flex flex-wrap gap-1.5"
                      >
                        {displayedQuestions.map((question, index) => {
                          const graded = submitted
                            ? practiceAttempt
                              ? (revealedPracticeResultByQuestion.get(
                                  question.id,
                                )?.correct ?? null)
                              : question.type === "long_response"
                                ? null
                                : questionCorrect(question)
                            : undefined;
                          const answered = answeredQuestionIds.has(question.id);
                          const active = index === activeDisplayedQuestionIndex;
                          return (
                            <button
                              key={question.id}
                              type="button"
                              aria-current={active ? "true" : undefined}
                              aria-label={`Question ${index + 1}${
                                graded === true
                                  ? ", correct"
                                  : graded === false
                                    ? ", not correct"
                                    : graded === null
                                      ? ", awaiting review"
                                      : answered
                                        ? ", answered"
                                        : ", not answered yet"
                              }`}
                              title={
                                plannerDescriptionText(question.prompt) ||
                                `Question ${index + 1}`
                              }
                              onClick={() => setActiveQuestionId(question.id)}
                              className={`h-8 min-w-8 rounded-[7px] border px-1.5 text-[12px] font-semibold tabular-nums ${
                                active
                                  ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-primary)]"
                                  : graded === true
                                    ? "border-[color-mix(in_oklab,var(--success)_48%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_8%,var(--bg-primary))] text-[var(--success)]"
                                    : graded === false
                                      ? "border-[color-mix(in_oklab,var(--danger)_44%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-primary))] text-[var(--danger)]"
                                      : answered
                                        ? "border-[var(--border-strong)] bg-[var(--bg-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                                        : "border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                              }`}
                            >
                              {index + 1}
                            </button>
                          );
                        })}
                      </nav>
                    ) : null}
                  </div>
                  {displayedQuestions
                    .filter(
                      (_, index) => index === activeDisplayedQuestionIndex,
                    )
                    .map((question) => (
                      <div
                        key={question.id}
                        className={`rounded-[8px] border bg-transparent p-4 ${submitted || revealedPracticeResultByQuestion.has(question.id) ? ((practiceAttempt ? revealedPracticeResultByQuestion.get(question.id)?.correct === null : question.type === "long_response") ? "border-[color-mix(in_oklab,var(--accent-cyan)_28%,var(--border-default))]" : questionCorrect(question) ? "border-[color-mix(in_oklab,var(--success)_48%,var(--border-default))]" : "border-[color-mix(in_oklab,var(--danger)_38%,var(--border-default))]") : "border-[var(--border-default)]"}`}
                      >
                        <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text-secondary)]">
                          <button
                            type="button"
                            className={iconButtonClass()}
                            disabled={activeDisplayedQuestionIndex <= 0}
                            aria-label="Previous question"
                            onClick={() => goDisplayedQuestion(-1)}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <span className="min-w-0 flex-1 text-center">
                            Question {activeDisplayedQuestionIndex + 1}
                            {displayedQuestions.length
                              ? ` of ${displayedQuestions.length}`
                              : ""}
                          </span>
                          {practiceShowTimerWarnings &&
                          practiceQuestionSecondsRemaining !== null ? (
                            <span
                              role="timer"
                              aria-label={`${practiceQuestionSecondsRemaining} seconds left for this question`}
                              className={`rounded-[6px] border px-2 py-1 text-micro tabular-nums ${practiceQuestionSecondsRemaining > 30 ? "border-[var(--border-default)] text-[var(--text-secondary)]" : practiceQuestionSecondsRemaining > 0 ? "border-[color-mix(in_oklab,var(--warning)_42%,var(--border-default))] text-[var(--warning)]" : "border-[color-mix(in_oklab,var(--danger)_42%,var(--border-default))] text-[var(--danger)]"}`}
                            >
                              {practiceQuestionSecondsRemaining > 0
                                ? `${quizClockLabel(practiceQuestionSecondsRemaining)} left`
                                : "Time ended"}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            className={iconButtonClass()}
                            disabled={isLastDisplayedQuestion}
                            aria-label="Next question"
                            onClick={() => goDisplayedQuestion(1)}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="mt-2 text-[15px] font-medium text-[var(--text-primary)]">
                          {plannerDescriptionText(question.prompt) ||
                            "Untitled question"}
                        </div>
                        {question.media && question.type !== "hotspot" ? (
                          quizAssetMap.get(question.media.assetId)
                            ?.downloadUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={
                                quizAssetMap.get(question.media.assetId)!
                                  .downloadUrl!
                              }
                              alt={question.media.altText ?? ""}
                              className="mt-3 max-h-[320px] w-full rounded-[8px] border border-[var(--border-default)] object-contain"
                            />
                          ) : (
                            <div className="mt-3 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-micro text-[var(--text-tertiary)]">
                              Question image unavailable
                            </div>
                          )
                        ) : null}
                        <div className="mt-3 space-y-2">
                          {question.type === "multiple_choice" ||
                          question.type === "true_false" ? (
                            question.options.map((option, optionIndex) => (
                              <button
                                type="button"
                                disabled={activeQuestionInputDisabled}
                                onClick={() =>
                                  void synchronizePracticeAnswer(
                                    question.id,
                                    option,
                                  )
                                }
                                key={`${question.id}-${optionIndex}`}
                                className={`flex w-full items-center gap-2 rounded-[7px] border px-3 py-2 text-left text-[13px] transition ${answers[question.id] === option ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-elevated))] text-[var(--text-primary)]" : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
                              >
                                <Radio className="h-3.5 w-3.5" />
                                {option || `Option ${optionIndex + 1}`}
                              </button>
                            ))
                          ) : question.type === "select_all" ? (
                            question.options.map((option, optionIndex) => {
                              const selected = answerArray(
                                question.id,
                              ).includes(option);
                              return (
                                <button
                                  type="button"
                                  disabled={activeQuestionInputDisabled}
                                  onClick={() => {
                                    const current = answerArray(question.id);
                                    void synchronizePracticeAnswer(
                                      question.id,
                                      JSON.stringify(
                                        selected
                                          ? current.filter(
                                              (value) => value !== option,
                                            )
                                          : [...current, option],
                                      ),
                                    );
                                  }}
                                  key={`${question.id}-${optionIndex}`}
                                  className={`flex w-full items-center gap-2 rounded-[7px] border px-3 py-2 text-left text-[13px] ${selected ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-elevated))]" : "border-[var(--border-default)]"}`}
                                >
                                  <span
                                    className={`flex h-4 w-4 items-center justify-center rounded-[4px] border ${selected ? "border-[var(--accent-cyan)] bg-[var(--accent-cyan)] text-white" : "border-[var(--border-default)]"}`}
                                  >
                                    {selected ? (
                                      <Check className="h-3 w-3" />
                                    ) : null}
                                  </span>
                                  {option || `Option ${optionIndex + 1}`}
                                </button>
                              );
                            })
                          ) : question.type === "ordering" ? (
                            <div className="space-y-2">
                              {(answerArray(question.id).length
                                ? answerArray(question.id)
                                : question.options
                              ).map((option, optionIndex, order) => (
                                <div
                                  key={`${question.id}-${option}-${optionIndex}`}
                                  className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded-[7px] border border-[var(--border-default)] px-3 py-2 text-[13px]"
                                >
                                  <strong>{optionIndex + 1}</strong>
                                  <span>
                                    {option || `Option ${optionIndex + 1}`}
                                  </span>
                                  <div className="flex gap-1">
                                    <button
                                      type="button"
                                      disabled={
                                        activeQuestionInputDisabled ||
                                        optionIndex === 0
                                      }
                                      onClick={() => {
                                        const next = [...order];
                                        [
                                          next[optionIndex - 1],
                                          next[optionIndex],
                                        ] = [
                                          next[optionIndex]!,
                                          next[optionIndex - 1]!,
                                        ];
                                        void synchronizePracticeAnswer(
                                          question.id,
                                          JSON.stringify(next),
                                        );
                                      }}
                                      aria-label={`Move ${option} earlier`}
                                    >
                                      <ChevronDown className="h-3.5 w-3.5 rotate-180" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={
                                        activeQuestionInputDisabled ||
                                        optionIndex === order.length - 1
                                      }
                                      onClick={() => {
                                        const next = [...order];
                                        [
                                          next[optionIndex],
                                          next[optionIndex + 1],
                                        ] = [
                                          next[optionIndex + 1]!,
                                          next[optionIndex]!,
                                        ];
                                        void synchronizePracticeAnswer(
                                          question.id,
                                          JSON.stringify(next),
                                        );
                                      }}
                                      aria-label={`Move ${option} later`}
                                    >
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : question.type === "matching" ? (
                            <div className="space-y-2">
                              {(question.matchingPairs ?? []).map((pair) => {
                                const current = answerArray(question.id);
                                const selected = current
                                  .find((value) =>
                                    value.startsWith(`${pair.id}:`),
                                  )
                                  ?.slice(pair.id.length + 1);
                                const choices =
                                  question.matchingChoices ??
                                  (question.matchingPairs ?? []).map(
                                    (candidate) => candidate.right ?? "",
                                  );
                                return (
                                  <div
                                    key={pair.id}
                                    className="grid grid-cols-[minmax(0,1fr)_18px_minmax(0,1fr)] items-center gap-2 rounded-[7px] border border-[var(--border-default)] px-3 py-2"
                                  >
                                    <span className="text-[12px] font-medium text-[var(--text-primary)]">
                                      {pair.left || "Untitled prompt"}
                                    </span>
                                    <span
                                      aria-hidden="true"
                                      className="text-center text-[var(--text-tertiary)]"
                                    >
                                      →
                                    </span>
                                    <SelectField
                                      ariaLabel={`Match for ${pair.left || "untitled prompt"}`}
                                      size="sm"
                                      disabled={activeQuestionInputDisabled}
                                      placeholder="Choose a match"
                                      value={selected ?? ""}
                                      onChange={(value) => {
                                        const next = current.filter(
                                          (entry) =>
                                            !entry.startsWith(`${pair.id}:`),
                                        );
                                        if (value)
                                          next.push(`${pair.id}:${value}`);
                                        void synchronizePracticeAnswer(
                                          question.id,
                                          JSON.stringify(next),
                                        );
                                      }}
                                      options={choices.map(
                                        (choice, choiceIndex) => ({
                                          value: choice,
                                          label:
                                            choice ||
                                            `Match ${choiceIndex + 1}`,
                                        }),
                                      )}
                                      className="min-w-0"
                                      triggerClassName="w-full"
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          ) : question.type === "hotspot" ? (
                            <div>
                              <div className="relative aspect-video overflow-hidden rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-secondary)]">
                                {question.media &&
                                quizAssetMap.get(question.media.assetId)
                                  ?.downloadUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={
                                      quizAssetMap.get(question.media.assetId)!
                                        .downloadUrl!
                                    }
                                    alt={question.media.altText ?? ""}
                                    className="absolute inset-0 h-full w-full object-contain"
                                  />
                                ) : null}
                                {(question.hotspot?.regions ?? []).map(
                                  (region) => {
                                    const selected = answerArray(question.id);
                                    const active = selected.includes(region.id);
                                    return (
                                      <button
                                        key={region.id}
                                        type="button"
                                        aria-pressed={active}
                                        aria-label={
                                          region.label || "Answer region"
                                        }
                                        disabled={activeQuestionInputDisabled}
                                        onClick={() => {
                                          const next = question.hotspot
                                            ?.allowMultiple
                                            ? active
                                              ? selected.filter(
                                                  (id) => id !== region.id,
                                                )
                                              : [...selected, region.id]
                                            : [region.id];
                                          void synchronizePracticeAnswer(
                                            question.id,
                                            JSON.stringify(next),
                                          );
                                        }}
                                        style={{
                                          left: `${region.x * 100}%`,
                                          top: `${region.y * 100}%`,
                                          width: `${region.width * 100}%`,
                                          height: `${region.height * 100}%`,
                                        }}
                                        className={`absolute min-h-8 min-w-8 rounded-[5px] border-2 px-1 text-micro font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)] ${active ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_22%,transparent)] text-[var(--text-primary)]" : "border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--bg-primary)_72%,transparent)] text-[var(--text-secondary)]"}`}
                                      >
                                        {region.label}
                                      </button>
                                    );
                                  },
                                )}
                              </div>
                              <p className="mt-2 text-micro text-[var(--text-tertiary)]">
                                Every region is a named keyboard button; select{" "}
                                {question.hotspot?.allowMultiple
                                  ? "one or more"
                                  : "one"}
                                .
                              </p>
                            </div>
                          ) : question.type === "multipart" ? (
                            <div className="space-y-3">
                              {question.parts.map((part, partIndex) => {
                                const response = answerObject(question.id);
                                return (
                                  <section
                                    key={part.id}
                                    className="rounded-[8px] border border-[var(--border-subtle)] p-3"
                                  >
                                    <p className="mb-2 text-[12px] font-semibold text-[var(--text-primary)]">
                                      Part {partIndex + 1}:{" "}
                                      {part.prompt || "Untitled part"}
                                    </p>
                                    <QuizPartResponse
                                      part={part}
                                      response={response[part.id]}
                                      disabled={activeQuestionInputDisabled}
                                      onChange={(next, commitNow) => {
                                        const value = JSON.stringify({
                                          ...response,
                                          [part.id]: next,
                                        });
                                        if (commitNow)
                                          void synchronizePracticeAnswer(
                                            question.id,
                                            value,
                                          );
                                        else
                                          setAnswers((current) => ({
                                            ...current,
                                            [question.id]: value,
                                          }));
                                      }}
                                    />
                                  </section>
                                );
                              })}
                            </div>
                          ) : question.type === "long_response" ? (
                            <textarea
                              disabled={activeQuestionInputDisabled}
                              value={answers[question.id] ?? ""}
                              onChange={(event) =>
                                setAnswers((current) => ({
                                  ...current,
                                  [question.id]: event.target.value,
                                }))
                              }
                              onBlur={(event) =>
                                void synchronizePracticeAnswer(
                                  question.id,
                                  event.currentTarget.value,
                                )
                              }
                              className={textareaClass("min-h-[150px]")}
                              placeholder="Develop your response"
                            />
                          ) : (
                            <input
                              type={
                                question.type === "numeric" ? "number" : "text"
                              }
                              disabled={activeQuestionInputDisabled}
                              value={answers[question.id] ?? ""}
                              onChange={(event) =>
                                setAnswers((current) => ({
                                  ...current,
                                  [question.id]: event.target.value,
                                }))
                              }
                              onBlur={(event) =>
                                void synchronizePracticeAnswer(
                                  question.id,
                                  event.currentTarget.value,
                                )
                              }
                              className={inputClass()}
                              placeholder="Type your answer"
                            />
                          )}
                        </div>
                        {revealedPracticeResultByQuestion.has(question.id) ||
                        (submitted && canEditQuiz && !practiceAttempt) ? (
                          <div className="mt-3 border-t border-[var(--border-subtle)] pt-3 text-[11px] leading-5 text-[var(--text-secondary)]">
                            {!practiceAttempt ||
                            revealedPracticeResultByQuestion.get(question.id)
                              ?.answersVisible !== false ? (
                              <div>
                                <strong className="text-[var(--text-primary)]">
                                  Answer:
                                </strong>{" "}
                                {practiceAttempt
                                  ? Array.isArray(
                                      revealedPracticeResultByQuestion.get(
                                        question.id,
                                      )?.expected,
                                    )
                                    ? (
                                        revealedPracticeResultByQuestion.get(
                                          question.id,
                                        )?.expected as string[]
                                      ).join(" · ")
                                    : String(
                                        revealedPracticeResultByQuestion.get(
                                          question.id,
                                        )?.expected ?? "Not available",
                                      )
                                  : question.type === "matching"
                                    ? (question.matchingPairs ?? [])
                                        .map(
                                          (pair) =>
                                            `${pair.left} → ${pair.right ?? ""}`,
                                        )
                                        .join(" · ")
                                    : question.type === "long_response"
                                      ? "Advisory review, no single auto-scored answer"
                                      : question.type === "select_all" ||
                                          question.type === "ordering"
                                        ? (
                                            question.correctAnswers ??
                                            question.options
                                          ).join(" · ")
                                        : question.correctAnswer}
                              </div>
                            ) : null}
                            {practiceAttempt &&
                            revealedPracticeResultByQuestion.get(question.id)
                              ?.scoreVisible ? (
                              <div className="mt-1 font-medium tabular-nums text-[var(--text-primary)]">
                                {revealedPracticeResultByQuestion.get(
                                  question.id,
                                )?.awardedPoints ?? 0}
                                /
                                {revealedPracticeResultByQuestion.get(
                                  question.id,
                                )?.maxPoints ?? 0}{" "}
                                points
                                {(revealedPracticeResultByQuestion.get(
                                  question.id,
                                )?.penaltyApplied ?? 0) > 0
                                  ? ` · ${revealedPracticeResultByQuestion.get(question.id)?.penaltyApplied} penalty applied`
                                  : ""}
                              </div>
                            ) : null}
                            {(
                              practiceAttempt
                                ? revealedPracticeResultByQuestion.get(
                                    question.id,
                                  )?.explanation
                                : question.explanation
                            ) ? (
                              <div className="mt-1">
                                {practiceAttempt
                                  ? revealedPracticeResultByQuestion.get(
                                      question.id,
                                    )?.explanation
                                  : question.explanation}
                              </div>
                            ) : null}
                            {practiceAttempt &&
                            revealedPracticeResultByQuestion.get(question.id)
                              ?.advisoryFeedback ? (
                              <div className="mt-1 rounded-[6px] bg-[var(--bg-secondary)] px-2 py-1.5 text-[var(--text-secondary)]">
                                {
                                  revealedPracticeResultByQuestion.get(
                                    question.id,
                                  )?.advisoryFeedback
                                }
                              </div>
                            ) : null}
                            {practiceAttempt &&
                            revealedPracticeResultByQuestion.get(question.id)
                              ?.answerFeedback?.length ? (
                              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[var(--text-secondary)]">
                                {revealedPracticeResultByQuestion
                                  .get(question.id)!
                                  .answerFeedback!.map((feedback) => (
                                    <li key={feedback}>{feedback}</li>
                                  ))}
                              </ul>
                            ) : null}
                            {practiceAttempt &&
                            revealedPracticeResultByQuestion.get(question.id)
                              ?.partResults?.length ? (
                              <ol className="mt-2 space-y-1 border-t border-[var(--border-subtle)] pt-2">
                                {revealedPracticeResultByQuestion
                                  .get(question.id)!
                                  .partResults!.map((part, index) => (
                                    <li key={part.questionId}>
                                      Part {index + 1}: {part.awardedPoints}/
                                      {part.maxPoints} points
                                      {part.correct === null
                                        ? " · advisory review"
                                        : part.correct
                                          ? " · correct"
                                          : " · review this part"}
                                    </li>
                                  ))}
                              </ol>
                            ) : null}
                            {question.sourceRefs?.length ? (
                              <div className="mt-1 text-[var(--text-tertiary)]">
                                Sources: {question.sourceRefs.join(" · ")}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ))}
                </>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-3">
                {submitted && !inspectAttempt ? null : (
                  <WorkbarItemSelector
                    ariaLabel="Current question"
                    itemNoun="question"
                    value={activeQuestion?.id ?? ""}
                    onChange={setActiveQuestionId}
                    items={displayedQuestions.map((question) => ({
                      value: question.id,
                      label:
                        plannerDescriptionText(question.prompt) ||
                        "Untitled question",
                    }))}
                  />
                )}
                {practiceSyncing.length ? (
                  <span className="ml-auto inline-flex items-center gap-2 text-micro text-[var(--text-tertiary)]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Synchronizing {practiceSyncing.length} answer
                    {practiceSyncing.length === 1 ? "" : "s"}
                  </span>
                ) : practiceAttempt?.status === "in_progress" ? (
                  <span className="ml-auto inline-flex items-center gap-2 text-micro text-[var(--success)]">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Current answers synchronized
                  </span>
                ) : (
                  <span className="ml-auto" />
                )}
                {submitted ? (
                  <button
                    type="button"
                    className={smallActionClass()}
                    onClick={() => {
                      if (practiceAttempt) {
                        leaveAttempt();
                        return;
                      }
                      setSubmitted(false);
                      setInspectAttempt(false);
                      setAnswers({});
                      setPracticeFeedback({});
                    }}
                  >
                    {practiceAttempt ? "Close result" : "Try again"}
                  </button>
                ) : isLastDisplayedQuestion ? (
                  <div className="flex items-center gap-2">
                    {unansweredQuestionCount > 0 ? (
                      <span className="text-micro text-[var(--text-secondary)]">
                        {unansweredQuestionCount} still blank
                      </span>
                    ) : null}
                    <button
                      type="button"
                      disabled={
                        practiceBusy ||
                        practiceSyncing.length > 0 ||
                        (Boolean(practiceAttempt) && !canSubmitQuiz)
                      }
                      className="h-9 shrink-0 whitespace-nowrap rounded-[8px] bg-[var(--text-primary)] px-3 text-[12px] font-medium text-[var(--bg-primary)] disabled:opacity-45"
                      onClick={() =>
                        practiceAttempt
                          ? void submitPracticeAttempt()
                          : setSubmitted(true)
                      }
                    >
                      {practiceBusy
                        ? "Submitting safely…"
                        : practiceAttempt
                          ? "Submit attempt"
                          : "Check answers"}
                    </button>
                  </div>
                ) : (
                  <span className="text-micro text-[var(--text-secondary)]">
                    {unansweredQuestionCount > 0
                      ? `${unansweredQuestionCount} still blank`
                      : null}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : view === "settings" ? (
          <div
            className="mx-auto grid max-w-[900px] gap-4 p-6"
            style={{
              gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
            }}
          >
            <div style={{ gridColumn: "1 / -1" }}>
              <QuizExperienceSection
                experience={quizSettings.experience}
                onChange={commitExperience}
                readOnly={!canEditQuiz}
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Learner instructions">
                <textarea
                  value={quizSettings.instructions}
                  onChange={(event) =>
                    commitSettings({ instructions: event.target.value })
                  }
                  className={textareaClass("min-h-[104px]")}
                  placeholder="Explain the goal, useful materials, and what learners should do after reviewing feedback."
                />
              </Field>
            </div>
            <section
              style={{ gridColumn: "1 / -1" }}
              className="grid gap-4 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 md:grid-cols-2"
            >
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
                      Question banks
                    </h3>
                    <p className="text-micro text-[var(--text-tertiary)]">
                      Reusable organization; removing a bank keeps its
                      questions.
                    </p>
                  </div>
                  <button
                    type="button"
                    className={smallActionClass()}
                    onClick={addBank}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add bank
                  </button>
                </div>
                <div className="space-y-1.5">
                  {banks.map((bank) => (
                    <div
                      key={bank.id}
                      className="grid grid-cols-[minmax(0,1fr)_30px] items-center gap-2"
                    >
                      <input
                        value={bank.name}
                        aria-label="Bank name"
                        onChange={(event) =>
                          commitCollections({
                            banks: banks.map((candidate) =>
                              candidate.id === bank.id
                                ? { ...candidate, name: event.target.value }
                                : candidate,
                            ),
                          })
                        }
                        className={inputClass()}
                      />
                      <button
                        type="button"
                        className={iconButtonClass()}
                        onClick={() => removeBank(bank.id)}
                        aria-label={`Remove ${bank.name || "bank"}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {!banks.length ? (
                    <p className="rounded-[7px] bg-[var(--bg-secondary)] px-3 py-2 text-micro text-[var(--text-tertiary)]">
                      No banks yet
                    </p>
                  ) : null}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
                      Random-draw pools
                    </h3>
                    <p className="text-micro text-[var(--text-tertiary)]">
                      Each attempt deterministically draws the configured count.
                    </p>
                  </div>
                  <button
                    type="button"
                    className={smallActionClass()}
                    onClick={addPool}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add pool
                  </button>
                </div>
                <div className="space-y-1.5">
                  {pools.map((pool) => (
                    <div
                      key={pool.id}
                      className="grid grid-cols-[minmax(0,1fr)_72px_30px] items-center gap-2"
                    >
                      <input
                        value={pool.name}
                        aria-label="Pool name"
                        onChange={(event) =>
                          commitCollections({
                            pools: pools.map((candidate) =>
                              candidate.id === pool.id
                                ? { ...candidate, name: event.target.value }
                                : candidate,
                            ),
                          })
                        }
                        className={inputClass()}
                      />
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={pool.drawCount}
                        aria-label={`Draw count for ${pool.name || "pool"}`}
                        onChange={(event) =>
                          commitCollections({
                            pools: pools.map((candidate) =>
                              candidate.id === pool.id
                                ? {
                                    ...candidate,
                                    drawCount: Math.max(
                                      1,
                                      Math.min(
                                        100,
                                        Number(event.target.value) || 1,
                                      ),
                                    ),
                                  }
                                : candidate,
                            ),
                          })
                        }
                        className={inputClass()}
                      />
                      <button
                        type="button"
                        className={iconButtonClass()}
                        onClick={() => removePool(pool.id)}
                        aria-label={`Remove ${pool.name || "pool"}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {!pools.length ? (
                    <p className="rounded-[7px] bg-[var(--bg-secondary)] px-3 py-2 text-micro text-[var(--text-tertiary)]">
                      No pools yet
                    </p>
                  ) : null}
                </div>
              </div>
            </section>
            <button
              type="button"
              onClick={() =>
                commitSettings({
                  shuffleQuestions: !quizSettings.shuffleQuestions,
                })
              }
              className="flex items-center justify-between rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-left"
            >
              <span>
                <span className="block text-[13px] font-semibold text-[var(--text-primary)]">
                  Shuffle questions
                </span>
                <span className="mt-1 block text-[11px] text-[var(--text-secondary)]">
                  Present a different order on each attempt.
                </span>
              </span>
              <CheckCircle2
                className={`h-5 w-5 ${quizSettings.shuffleQuestions ? "text-[var(--success)]" : "text-[var(--text-tertiary)]"}`}
              />
            </button>
            <button
              type="button"
              onClick={() =>
                commitSettings({
                  enforceQuestionTimeLimits:
                    !quizSettings.enforceQuestionTimeLimits,
                })
              }
              className="flex items-center justify-between rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-left"
            >
              <span>
                <span className="block text-[13px] font-semibold text-[var(--text-primary)]">
                  Enforce question timers
                </span>
                <span className="mt-1 block text-[11px] text-[var(--text-secondary)]">
                  Start each question once and keep its server clock across
                  navigation or refresh.
                </span>
              </span>
              <CheckCircle2
                className={`h-5 w-5 ${quizSettings.enforceQuestionTimeLimits ? "text-[var(--success)]" : "text-[var(--text-tertiary)]"}`}
              />
            </button>
            <button
              type="button"
              onClick={() =>
                commitSettings({
                  shuffleOptions: !quizSettings.shuffleOptions,
                })
              }
              className="flex items-center justify-between rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-left"
            >
              <span>
                <span className="block text-[13px] font-semibold text-[var(--text-primary)]">
                  Shuffle answer options
                </span>
                <span className="mt-1 block text-[11px] text-[var(--text-secondary)]">
                  Preserve ordering questions while varying choice positions.
                </span>
              </span>
              <CheckCircle2
                className={`h-5 w-5 ${quizSettings.shuffleOptions ? "text-[var(--success)]" : "text-[var(--text-tertiary)]"}`}
              />
            </button>
            <button
              type="button"
              onClick={() =>
                commitSettings({ allowResume: !quizSettings.allowResume })
              }
              className="flex items-center justify-between rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-left"
            >
              <span>
                <span className="block text-[13px] font-semibold text-[var(--text-primary)]">
                  Resume interrupted practice
                </span>
                <span className="mt-1 block text-[11px] text-[var(--text-secondary)]">
                  Keep synchronized in-progress attempts available after
                  navigation or reconnect.
                </span>
              </span>
              <CheckCircle2
                className={`h-5 w-5 ${quizSettings.allowResume ? "text-[var(--success)]" : "text-[var(--text-tertiary)]"}`}
              />
            </button>
            <Field label="Learner time allowance">
              <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
                <SelectField
                  ariaLabel="Learner time allowance"
                  value={String(quizSettings.defaultTimeMultiplier)}
                  onChange={(value) =>
                    commitSettings({ defaultTimeMultiplier: Number(value) })
                  }
                  options={[
                    { value: "1", label: "Standard guidance" },
                    { value: "1.25", label: "25% extra time" },
                    { value: "1.5", label: "50% extra time" },
                    { value: "2", label: "Double time" },
                  ]}
                  triggerClassName="w-full"
                />
                <p className="mt-2 text-micro leading-4 text-[var(--text-tertiary)]">
                  Scales countdown and per-question time on the server, and the
                  suggested duration on the printed sheet. Deadlines remain one
                  shared closing time. Reduced-motion and text-size preferences
                  are respected independently.
                </p>
              </div>
            </Field>
            <section
              style={{ gridColumn: "1 / -1" }}
              className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4"
            >
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
                Review contents
              </h3>
              <p className="mt-1 text-micro text-[var(--text-tertiary)]">
                Answer release timing remains the outer gate. These controls
                decide what appears after that gate opens.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {(
                  [
                    ["showScore", "Score"],
                    ["showCorrectness", "Correctness"],
                    ["showCorrectAnswers", "Correct answers"],
                    ["showFeedback", "Feedback"],
                    ["showExplanations", "Explanations"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={quizSettings.reviewPolicy[key]}
                    onClick={() =>
                      commitSettings({
                        reviewPolicy: {
                          ...quizSettings.reviewPolicy,
                          [key]: !quizSettings.reviewPolicy[key],
                        },
                      })
                    }
                    className={`rounded-[7px] border px-3 py-2 text-left text-[11px] font-medium ${quizSettings.reviewPolicy[key] ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-primary))] text-[var(--text-primary)]" : "border-[var(--border-default)] text-[var(--text-secondary)]"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>
            <section
              style={{ gridColumn: "1 / -1" }}
              className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4"
            >
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
                Attempt accessibility policy
              </h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(
                  [
                    [
                      "keyboardSafeRequired",
                      "Require keyboard-safe interactions",
                    ],
                    ["showTimerWarnings", "Show visible timer warnings"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={quizSettings.accessibilityPolicy[key]}
                    onClick={() =>
                      commitSettings({
                        accessibilityPolicy: {
                          ...quizSettings.accessibilityPolicy,
                          [key]: !quizSettings.accessibilityPolicy[key],
                        },
                      })
                    }
                    className={`rounded-[7px] border px-3 py-2 text-left text-[11px] font-medium ${quizSettings.accessibilityPolicy[key] ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-primary))] text-[var(--text-primary)]" : "border-[var(--border-default)] text-[var(--text-secondary)]"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>
            <section
              style={{ gridColumn: "1 / -1" }}
              className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4"
            >
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
                Formative scope
              </h3>
              <p className="mt-1 text-micro text-[var(--text-tertiary)]">
                These boundaries are part of the quiz capability contract, not
                missing switches.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {Object.entries(QUIZ_REFUSAL_REASONS).map(
                  ([capabilityId, reason]) => (
                    <div
                      key={capabilityId}
                      data-capability-id={capabilityId}
                      aria-disabled="true"
                      className="rounded-[7px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-[11px] leading-5 text-[var(--text-secondary)]"
                    >
                      {reason}
                    </div>
                  ),
                )}
              </div>
            </section>
            <Field label="Personal practice target">
              <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={quizSettings.targetScore}
                  onChange={(event) =>
                    commitSettings({ targetScore: Number(event.target.value) })
                  }
                  className="w-full accent-[var(--accent-cyan)]"
                />
                <div className="mt-2 text-right font-display text-[20px] font-semibold text-[var(--text-primary)]">
                  {quizSettings.targetScore}%
                </div>
                <p className="mt-2 text-micro leading-4 text-[var(--text-tertiary)]">
                  Guidance for formative practice only. It is not a grade or
                  pass/fail threshold.
                </p>
              </div>
            </Field>
          </div>
        ) : view === "summary" ? (
          <div className="mx-auto max-w-[760px] p-6">
            <div className="mb-5">
              <h3 className="font-display text-[24px] font-semibold text-[var(--text-primary)]">
                Responses
              </h3>
              <p className="mt-1 max-w-[540px] text-[11px] leading-5 text-[var(--text-secondary)]">
                How the group did, question by question. Nobody is named and no
                individual response is shown here.
              </p>
            </div>
            {responseSummaryError ? (
              <div className="flex items-start gap-2 rounded-[9px] border border-[color-mix(in_oklab,var(--danger)_35%,var(--border-default))] p-3 text-[11px] text-[var(--danger)]">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {responseSummaryError}
              </div>
            ) : !responseSummary ? (
              <div className="flex min-h-[180px] items-center justify-center gap-2 text-[11px] text-[var(--text-tertiary)]">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading responses
              </div>
            ) : !responseSummary.available ? (
              <div data-spectra-card="result" className="p-6 text-center">
                <h3 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">
                  Nothing to report
                </h3>
                <p className="mx-auto mt-2 max-w-[440px] text-[12px] leading-5 text-[var(--text-secondary)]">
                  {responseSummary.reason}
                </p>
                <button
                  type="button"
                  onClick={() => setView("settings")}
                  className="mt-4 rounded-[8px] bg-[var(--text-primary)] px-3 py-2 text-[11px] font-medium text-[var(--bg-primary)]"
                >
                  Open quiz settings
                </button>
              </div>
            ) : !responseSummary.submittedCount ? (
              <div data-spectra-card="result" className="p-6 text-center">
                <h3 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">
                  No submissions yet
                </h3>
                <p className="mx-auto mt-2 max-w-[440px] text-[12px] leading-5 text-[var(--text-secondary)]">
                  {responseSummary.inProgressCount
                    ? `${responseSummary.inProgressCount} ${responseSummary.inProgressCount === 1 ? "attempt is" : "attempts are"} still open. Results appear as they are submitted.`
                    : "Share this quiz to start collecting responses."}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div
                  className="grid gap-2"
                  style={{
                    gridTemplateColumns: "repeat(auto-fit,minmax(124px,1fr))",
                  }}
                >
                  {(
                    [
                      ["Submitted", String(responseSummary.submittedCount)],
                      ["In progress", String(responseSummary.inProgressCount)],
                      [
                        "Average",
                        responseSummary.averagePercentage === undefined
                          ? "None yet"
                          : `${responseSummary.averagePercentage}%`,
                      ],
                      [
                        "Ran out of time",
                        String(responseSummary.timeElapsedCount),
                      ],
                      [
                        "Median time",
                        responseSummary.duration
                          ? quizDurationLabel(responseSummary.duration.medianMs)
                          : "None yet",
                      ],
                      [
                        "Time range",
                        responseSummary.duration
                          ? `${quizDurationLabel(responseSummary.duration.minMs)}–${quizDurationLabel(responseSummary.duration.maxMs)}`
                          : "None yet",
                      ],
                    ] as const
                  ).map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5"
                    >
                      <strong className="block font-display text-[20px] tabular-nums text-[var(--text-primary)]">
                        {value}
                      </strong>
                      <span className="text-micro uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
                <section className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
                  <div className="mb-3 flex items-baseline justify-between gap-3">
                    <h4 className="text-[12px] font-semibold text-[var(--text-primary)]">
                      Score distribution
                    </h4>
                    <span className="text-micro text-[var(--text-tertiary)]">
                      Submitted attempts
                    </span>
                  </div>
                  <div className="grid grid-cols-5 items-end gap-2">
                    {responseSummary.scoreDistribution.map((bucket) => {
                      const height = responseSummary.submittedCount
                        ? Math.max(
                            bucket.count ? 8 : 2,
                            Math.round(
                              (bucket.count / responseSummary.submittedCount) *
                                56,
                            ),
                          )
                        : 2;
                      return (
                        <div key={bucket.label} className="text-center">
                          <strong className="block text-micro tabular-nums text-[var(--text-secondary)]">
                            {bucket.count}
                          </strong>
                          <div className="mt-1 flex h-14 items-end justify-center rounded-[5px] bg-[var(--bg-secondary)] px-1">
                            <span
                              aria-hidden="true"
                              className="w-full rounded-t-[3px] bg-[var(--accent-cyan)]"
                              style={{ height }}
                            />
                          </div>
                          <span className="mt-1 block text-[9px] tabular-nums text-[var(--text-tertiary)]">
                            {bucket.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
                <div className="space-y-2">
                  {responseSummary.questions.map((entry, index) => {
                    const share = entry.answered
                      ? Math.round((entry.correct / entry.answered) * 100)
                      : 0;
                    return (
                      <div
                        key={entry.questionId}
                        className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <p className="min-w-0 text-[12px] leading-5 text-[var(--text-primary)]">
                            <span className="mr-2 text-micro tabular-nums text-[var(--text-tertiary)]">
                              {index + 1}
                            </span>
                            {plannerDescriptionText(
                              questions.find(
                                (question) => question.id === entry.questionId,
                              )?.prompt ?? "",
                            ) || `Question ${index + 1}`}
                          </p>
                          <strong className="shrink-0 font-display text-[16px] tabular-nums text-[var(--text-primary)]">
                            {entry.answered ? `${share}%` : "No answers"}
                          </strong>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${share}%`,
                              background:
                                share >= 70
                                  ? "var(--success)"
                                  : share >= 40
                                    ? "#d88922"
                                    : "var(--danger)",
                            }}
                          />
                        </div>
                        <p className="mt-1.5 text-micro text-[var(--text-tertiary)]">
                          {entry.answered
                            ? `${entry.correct} of ${entry.answered} answered correctly`
                            : "Not answered yet"}
                        </p>
                        {entry.commonResponses.length ? (
                          <ul className="mt-2 flex flex-wrap gap-1.5">
                            {entry.commonResponses.map((response) => (
                              <li
                                key={response.response}
                                className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-micro text-[var(--text-secondary)]"
                              >
                                {response.response}
                                <em className="ml-1 not-italic tabular-nums text-[var(--text-tertiary)]">
                                  ×{response.count}
                                </em>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : view === "responses" ? (
          <div className="mx-auto max-w-[760px] p-6">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="font-display text-[24px] font-semibold text-[var(--text-primary)]">
                  Your results
                </h3>
                <p className="mt-1 max-w-[520px] text-[11px] leading-5 text-[var(--text-secondary)]">
                  Every attempt you have made on this quiz, newest first. Only
                  you can open them. Authors and collaborators see the group,
                  not your answers.
                </p>
              </div>
              <button
                type="button"
                disabled={!published || practiceBusy || !canAttemptQuiz}
                onClick={() => void beginPractice()}
                className="rounded-[8px] bg-[var(--text-primary)] px-3 py-2 text-[11px] font-semibold text-[var(--bg-primary)] disabled:opacity-45"
              >
                New private attempt
              </button>
            </div>
            {practiceError ? (
              <div className="mb-3 flex items-start gap-2 rounded-[9px] border border-[color-mix(in_oklab,var(--danger)_35%,var(--border-default))] p-3 text-[11px] text-[var(--danger)]">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {practiceError}
              </div>
            ) : null}
            {practiceLoading ? (
              <div className="flex min-h-[180px] items-center justify-center gap-2 text-[11px] text-[var(--text-tertiary)]">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading your
                attempts
              </div>
            ) : practiceAttempts.length ? (
              <div className="space-y-2">
                {practiceAttempts.map((attempt, index) => (
                  <button
                    key={attempt.attemptId}
                    type="button"
                    onClick={() => hydratePracticeAttempt(attempt)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-left transition hover:border-[color-mix(in_oklab,var(--accent-cyan)_35%,var(--border-default))] hover:bg-[var(--bg-hover)]"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <strong className="text-[12px] text-[var(--text-primary)]">
                          Practice {practiceAttempts.length - index}
                        </strong>
                        <span
                          className={`rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-[0.06em] ${attempt.status === "submitted" ? "bg-[color-mix(in_oklab,var(--success)_10%,var(--bg-primary))] text-[var(--success)]" : "bg-[color-mix(in_oklab,var(--warning)_10%,var(--bg-primary))] text-[var(--warning)]"}`}
                        >
                          {attempt.status === "submitted"
                            ? "Reviewed"
                            : "In progress"}
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-micro text-[var(--text-tertiary)]">
                        Started {formatShortDate(attempt.startedAt)} · pinned
                        content {attempt.contentHash}
                      </span>
                    </span>
                    <span className="text-right">
                      <strong className="block font-display text-[18px] text-[var(--text-primary)]">
                        {attempt.status === "submitted"
                          ? typeof attempt.percentage === "number"
                            ? `${attempt.percentage}%`
                            : "Done"
                          : `${Object.keys(attempt.responses).length}/${attempt.questions.length}`}
                      </strong>
                      <span className="text-micro text-[var(--text-tertiary)]">
                        {attempt.status === "submitted"
                          ? `${Math.max(1, Math.round((attempt.elapsedMs ?? 0) / 60_000))} min · Review`
                          : "Resume safely"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div data-spectra-card="result" className="p-6 text-center">
                <CheckCircle2 className="mx-auto h-7 w-7 text-[var(--success)]" />
                <h3 className="mt-3 font-display text-[22px] font-semibold text-[var(--text-primary)]">
                  No private attempts yet
                </h3>
                <p className="mx-auto mt-2 max-w-[440px] text-[12px] leading-5 text-[var(--text-secondary)]">
                  Preview lets authors inspect the experience. A private
                  practice run creates your own version-pinned learning record.
                </p>
                <button
                  type="button"
                  onClick={() => setView("preview")}
                  className="mt-4 rounded-[8px] bg-[var(--text-primary)] px-3 py-2 text-[11px] font-medium text-[var(--bg-primary)]"
                >
                  Open preview
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="spectra-quiz-builder min-h-0 flex-1">
            {showQuestionRail ? (
              <StudioItemRail
                label="Questions"
                count={questions.length}
                collapsed={!questionNavigatorOpen}
                onToggleCollapsed={() =>
                  setQuestionNavigatorOpen((open) => !open)
                }
                items={questions.map((question) => ({
                  id: question.id,
                  title:
                    plannerDescriptionText(question.prompt) ||
                    "Untitled question",
                  subtitle: `${QUIZ_TYPE_LABELS[question.type]} · ${question.points ?? 1} point${(question.points ?? 1) === 1 ? "" : "s"}`,
                  active: activeQuestion?.id === question.id,
                }))}
                onSelect={setActiveQuestionId}
                onAdd={canEditQuiz ? addQuestion : undefined}
                addLabel="Add question"
                canEdit={canEditQuiz}
                draggingId={draggingQuestionId}
                onDragStart={setDraggingQuestionId}
                onDragEnd={() => setDraggingQuestionId(undefined)}
                onMove={moveQuestion}
              />
            ) : null}
            <section
              data-quiz-panel="editor"
              className="min-w-0 flex-1 overflow-auto border-[var(--border-default)] p-4"
            >
              {activeQuestion ? (
                <QuestionEditor
                  question={activeQuestion}
                  questionNumber={
                    questions.findIndex(
                      (question) => question.id === activeQuestion.id,
                    ) + 1
                  }
                  questionCount={questions.length}
                  questionIndex={questions.findIndex(
                    (question) => question.id === activeQuestion.id,
                  )}
                  aiChangedPaths={aiChangedPaths}
                  onChange={(patch) => updateQuestion(activeQuestion.id, patch)}
                  onRemove={() => void removeQuestion(activeQuestion.id)}
                  onDuplicate={() => {
                    const questionId = id("question");
                    const duplicate = duplicateQuizQuestion(
                      activeQuestion,
                      questionId,
                    );
                    // A duplicate belongs beside its original, not at the end of
                    // a twelve-question set.
                    const next = [...questions];
                    next.splice(activeQuestionIndex + 1, 0, duplicate);
                    commit(next);
                    setActiveQuestionId(questionId);
                  }}
                  onMove={(toIndex) =>
                    moveQuestion(activeQuestionIndex, toIndex)
                  }
                />
              ) : null}
            </section>
            {questionDetailsOpen ? (
              <aside
                data-quiz-panel="settings"
                className="spectra-studio-inspector-overlay min-w-0 p-3"
              >
                {activeQuestion ? (
                  <div className="grid gap-3">
                    <Field
                      label="Difficulty"
                      aiActive={pathTouches(
                        aiChangedPaths,
                        `/questions/${questions.findIndex((question) => question.id === activeQuestion.id)}/difficulty`,
                      )}
                      path={`/questions/${questions.findIndex((question) => question.id === activeQuestion.id)}/difficulty`}
                    >
                      <SelectField
                        ariaLabel="Difficulty"
                        size="sm"
                        value={activeQuestion.difficulty ?? "medium"}
                        onChange={(value) =>
                          updateQuestion(activeQuestion.id, {
                            difficulty: value as QuizQuestion["difficulty"],
                          })
                        }
                        options={[
                          { value: "easy", label: "Easy" },
                          { value: "medium", label: "Medium" },
                          { value: "hard", label: "Hard" },
                        ]}
                        triggerClassName="w-full"
                      />
                    </Field>
                    <Field
                      label="Points"
                      aiActive={pathTouches(
                        aiChangedPaths,
                        `/questions/${questions.findIndex((question) => question.id === activeQuestion.id)}/points`,
                      )}
                      path={`/questions/${questions.findIndex((question) => question.id === activeQuestion.id)}/points`}
                    >
                      <input
                        type="number"
                        value={activeQuestion.points ?? 1}
                        min={1}
                        onChange={(event) =>
                          updateQuestion(activeQuestion.id, {
                            points: Number(event.target.value),
                          })
                        }
                        className={inputClass()}
                      />
                    </Field>
                    <Field
                      label="Time (seconds)"
                      aiActive={pathTouches(
                        aiChangedPaths,
                        `/questions/${questions.findIndex((question) => question.id === activeQuestion.id)}/timeLimitSeconds`,
                      )}
                      path={`/questions/${questions.findIndex((question) => question.id === activeQuestion.id)}/timeLimitSeconds`}
                    >
                      <input
                        type="number"
                        value={activeQuestion.timeLimitSeconds ?? 90}
                        min={0}
                        onChange={(event) =>
                          updateQuestion(activeQuestion.id, {
                            timeLimitSeconds: Number(event.target.value),
                          })
                        }
                        className={inputClass()}
                      />
                    </Field>
                    <Field
                      label="Bloom's taxonomy"
                      aiActive={pathTouches(
                        aiChangedPaths,
                        `/questions/${questions.findIndex((question) => question.id === activeQuestion.id)}/bloomLevel`,
                      )}
                      path={`/questions/${questions.findIndex((question) => question.id === activeQuestion.id)}/bloomLevel`}
                    >
                      <SelectField
                        ariaLabel="Bloom's taxonomy level"
                        size="sm"
                        value={activeQuestion.bloomLevel ?? "remember"}
                        onChange={(value) =>
                          updateQuestion(activeQuestion.id, {
                            bloomLevel: value as NonNullable<
                              QuizQuestion["bloomLevel"]
                            >,
                          })
                        }
                        options={[
                          { value: "remember", label: "Remember" },
                          { value: "understand", label: "Understand" },
                          { value: "apply", label: "Apply" },
                          { value: "analyze", label: "Analyze" },
                          { value: "evaluate", label: "Evaluate" },
                          { value: "create", label: "Create" },
                        ]}
                        triggerClassName="w-full"
                      />
                    </Field>
                    <Field label="Standards (optional)">
                      <div className="spectra-quiz-standard-editor">
                        {(activeQuestion.standards ?? []).map((standard) => (
                          <span key={standard}>
                            {standard}
                            <button
                              type="button"
                              aria-label={`Remove ${standard}`}
                              onClick={() =>
                                updateQuestion(activeQuestion.id, {
                                  standards: (
                                    activeQuestion.standards ?? []
                                  ).filter((item) => item !== standard),
                                })
                              }
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </span>
                        ))}
                        <input
                          aria-label="Add standard"
                          placeholder="+ Add standard"
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== ",")
                              return;
                            event.preventDefault();
                            const value = event.currentTarget.value
                              .trim()
                              .replace(/,$/, "");
                            if (!value) return;
                            updateQuestion(activeQuestion.id, {
                              standards: Array.from(
                                new Set([
                                  ...(activeQuestion.standards ?? []),
                                  value,
                                ]),
                              ),
                            });
                            event.currentTarget.value = "";
                          }}
                        />
                      </div>
                    </Field>
                    <details className="spectra-quiz-advanced">
                      <summary>
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        Advanced placement
                        <ChevronDown className="ml-auto h-3.5 w-3.5" />
                      </summary>
                      <div>
                        <Field label="Section">
                          <input
                            value={activeQuestion.section ?? ""}
                            onChange={(event) =>
                              updateQuestion(activeQuestion.id, {
                                section: event.target.value || undefined,
                              })
                            }
                            className={inputClass()}
                            placeholder="e.g. Foundations"
                          />
                        </Field>
                        <Field label="Question bank">
                          <SelectField
                            ariaLabel="Question bank"
                            size="sm"
                            value={activeQuestion.bankId ?? ""}
                            onChange={(value) =>
                              updateQuestion(activeQuestion.id, {
                                bankId: value || undefined,
                              })
                            }
                            options={[
                              { value: "", label: "No bank" },
                              ...banks.map((bank) => ({
                                value: bank.id,
                                label: bank.name,
                              })),
                            ]}
                            triggerClassName="w-full"
                          />
                        </Field>
                        <Field label="Random pool">
                          <SelectField
                            ariaLabel="Random pool"
                            size="sm"
                            value={activeQuestion.poolId ?? ""}
                            onChange={(value) =>
                              updateQuestion(activeQuestion.id, {
                                poolId: value || undefined,
                                poolDrawCount: undefined,
                              })
                            }
                            options={[
                              { value: "", label: "Always include" },
                              ...pools.map((pool) => ({
                                value: pool.id,
                                label: `${pool.name} · draw ${pool.drawCount}`,
                              })),
                            ]}
                            triggerClassName="w-full"
                          />
                        </Field>
                        <p>
                          Pool draw counts are configured once in Quiz settings.
                          Questions outside a pool always appear.
                        </p>
                      </div>
                    </details>
                    <div className="spectra-quiz-media">
                      {activeQuestion.media ? (
                        <>
                          {quizAssetMap.get(activeQuestion.media.assetId)
                            ?.downloadUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={
                                quizAssetMap.get(activeQuestion.media.assetId)!
                                  .downloadUrl!
                              }
                              alt={activeQuestion.media.altText ?? ""}
                            />
                          ) : (
                            <div data-missing="true">
                              <ImageIcon className="h-4 w-4" /> Media
                              unavailable
                            </div>
                          )}
                          <Field label="Image description">
                            <input
                              value={activeQuestion.media.altText ?? ""}
                              onChange={(event) =>
                                updateQuestion(activeQuestion.id, {
                                  media: {
                                    ...activeQuestion.media!,
                                    altText: event.target.value,
                                  },
                                })
                              }
                              className={inputClass()}
                              placeholder="Describe the image for learners who cannot see it"
                            />
                          </Field>
                          <button
                            type="button"
                            onClick={() =>
                              void removeQuestionMedia(activeQuestion.id)
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Remove image
                          </button>
                        </>
                      ) : (
                        <label
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            const file = event.dataTransfer.files?.[0];
                            if (file?.type.startsWith("image/"))
                              void uploadQuestionMedia(file);
                          }}
                        >
                          {uploadingQuizMedia ? (
                            <>
                              <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
                              Uploading image…
                            </>
                          ) : (
                            <>
                              <span>Drag and drop image</span>
                              <span>or</span>
                              <strong>Browse</strong>
                            </>
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            hidden
                            disabled={uploadingQuizMedia}
                            onChange={(event) => {
                              const file = event.currentTarget.files?.[0];
                              if (file) void uploadQuestionMedia(file);
                              event.currentTarget.value = "";
                            }}
                          />
                        </label>
                      )}
                      {quizMediaError ? (
                        <p role="status">{quizMediaError}</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </aside>
            ) : null}
          </div>
        )}
        <section className="spectra-quiz-print-sheet" aria-hidden="true">
          <header>
            <span>Formative practice</span>
            <h1>Quiz</h1>
            {quizSettings.instructions ? (
              <p>{quizSettings.instructions}</p>
            ) : null}
            <dl>
              <div>
                <dt>Questions</dt>
                <dd>{questions.length}</dd>
              </div>
              <div>
                <dt>Estimated time</dt>
                <dd>
                  {Math.max(
                    1,
                    Math.ceil(
                      (questions.reduce(
                        (total, question) =>
                          total + (question.timeLimitSeconds ?? 90),
                        0,
                      ) /
                        60) *
                        quizSettings.defaultTimeMultiplier,
                    ),
                  )}{" "}
                  min
                </dd>
              </div>
            </dl>
          </header>
          <ol>
            {questions.map((question) => (
              <li key={question.id}>
                <h2>
                  {plannerDescriptionText(question.prompt) ||
                    "Untitled question"}
                </h2>
                {question.options.length ? (
                  <ul>
                    {question.options.map((option, index) => (
                      <li key={`${question.id}-print-${index}`}>
                        {String.fromCharCode(65 + index)}. {option || "(blank)"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="spectra-quiz-print-response-lines" />
                )}
                {canEditQuiz ? (
                  <aside>
                    <strong>Answer and review guidance:</strong>{" "}
                    {question.type === "matching"
                      ? (question.matchingPairs ?? [])
                          .map((pair) => `${pair.left} → ${pair.right ?? ""}`)
                          .join(" · ")
                      : question.type === "select_all" ||
                          question.type === "ordering"
                        ? (question.correctAnswers ?? question.options).join(
                            " · ",
                          )
                        : question.type === "long_response"
                          ? question.rubric || "Advisory review"
                          : question.correctAnswer}
                    {question.explanation ? (
                      <p>{question.explanation}</p>
                    ) : null}
                  </aside>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

function QuestionEditor({
  question,
  questionNumber,
  questionCount,
  questionIndex,
  aiChangedPaths = [],
  onChange,
  onRemove,
  onDuplicate,
  onMove,
}: {
  question: QuizQuestion;
  questionNumber: number;
  questionCount: number;
  questionIndex: number;
  aiChangedPaths?: string[];
  onChange: (patch: Partial<QuizQuestion>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  /** Moves this question to `toIndex`. Bounds are enforced by the caller. */
  onMove: (toIndex: number) => void;
}) {
  const [tagDraft, setTagDraft] = useState("");
  const qPath = `/questions/${questionIndex}`;
  const aiField = (suffix: string) =>
    pathTouches(aiChangedPaths, `${qPath}/${suffix}`);
  /** Ways this question's answer key cannot be resolved as written. */
  const answerKeyProblems = (() => {
    if (
      !["multiple_choice", "true_false", "select_all", "ordering"].includes(
        question.type,
      )
    )
      return [];
    const problems: string[] = [];
    const filled = question.options.filter((option) => option.trim());
    const duplicate = filled.find(
      (option, index) =>
        filled.findIndex((candidate) => candidate.trim() === option.trim()) !==
        index,
    );
    if (duplicate)
      problems.push(
        `Two options both say "${duplicate.trim()}". The answer key cannot tell them apart, so make one of them different.`,
      );
    if (question.options.length !== filled.length)
      problems.push(
        "An empty option cannot be marked correct. Write it or remove it.",
      );
    if (question.type === "select_all") {
      if (!(question.correctAnswers ?? []).length)
        problems.push("Mark at least one option correct.");
    } else if (question.type !== "ordering" && !question.correctAnswer?.trim())
      problems.push("Mark the correct option.");
    return problems;
  })();
  const feedbackTargets: Array<{ id: string; label: string }> = [
    "multiple_choice",
    "true_false",
    "select_all",
    "ordering",
  ].includes(question.type)
    ? question.optionIds.map((optionId, index) => ({
        id: optionId,
        label: question.options[index] || `Option ${index + 1}`,
      }))
    : question.type === "matching"
      ? (question.matchingPairs ?? []).map((pair) => ({
          id: pair.id,
          label: pair.left || "Untitled pair",
        }))
      : question.type === "hotspot"
        ? (question.hotspot?.regions ?? []).map((region) => ({
            id: region.id,
            label: region.label || "Untitled region",
          }))
        : question.type === "multipart"
          ? question.parts.map((part, index) => ({
              id: part.id,
              label: part.prompt || `Part ${index + 1}`,
            }))
          : [];

  function addTag() {
    const tag = tagDraft.trim().replace(/^#+/, "");
    if (!tag) return;
    if (
      !(question.tags ?? []).some(
        (candidate) => candidate.toLowerCase() === tag.toLowerCase(),
      )
    ) {
      onChange({ tags: [...(question.tags ?? []), tag] });
    }
    setTagDraft("");
  }

  function updateOption(index: number, value: string) {
    const options = [...question.options];
    const previous = options[index] ?? "";
    options[index] = value;
    onChange({
      options,
      correctAnswer:
        question.correctAnswer === previous ? value : question.correctAnswer,
      correctAnswers: (question.correctAnswers ?? []).map((answer) =>
        answer === previous ? value : answer,
      ),
    });
  }
  return (
    <div className="spectra-quiz-question-editor">
      <div className="mb-4 flex items-center justify-between">
        {/* Which question you are editing. The workbar already states the
            position in the set, so this does not repeat "of N". */}
        <div className="text-[13px] font-semibold text-[var(--text-primary)]">
          Question {questionNumber}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={iconButtonClass()}
            onClick={() => onMove(questionIndex - 1)}
            disabled={questionIndex === 0}
            aria-label="Move question earlier"
            title="Move question earlier"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={iconButtonClass()}
            onClick={() => onMove(questionIndex + 1)}
            disabled={questionIndex >= questionCount - 1}
            aria-label="Move question later"
            title="Move question later"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={iconButtonClass()}
            onClick={onDuplicate}
            aria-label="Duplicate question"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={iconButtonClass()}
            onClick={onRemove}
            aria-label="Remove question"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="spectra-quiz-type-row">
        <span>Type</span>
        <div
          className="min-w-0"
          data-ai-region={aiRegionAttr(aiField("type"))}
          {...targetAttrs(`${qPath}/type`)}
        >
          <SelectField
            ariaLabel="Question type"
            size="sm"
            value={question.type}
            onChange={(value) => {
              const type = value as QuizQuestion["type"];
              onChange({
                type,
                options:
                  type === "true_false"
                    ? ["True", "False"]
                    : ["multiple_choice", "select_all", "ordering"].includes(
                          type,
                        ) && question.options.length === 0
                      ? ["", "", "", ""]
                      : question.options,
                optionIds:
                  type === "true_false"
                    ? [id("option"), id("option")]
                    : ["multiple_choice", "select_all", "ordering"].includes(
                          type,
                        ) && question.options.length === 0
                      ? [id("option"), id("option"), id("option"), id("option")]
                      : question.optionIds,
                correctAnswers:
                  type === "select_all" ||
                  type === "ordering" ||
                  type === "fill_blank"
                    ? (question.correctAnswers ?? [])
                    : [],
                correctOptionIds: [],
                matchingPairs:
                  type === "matching" &&
                  (question.matchingPairs ?? []).length < 2
                    ? [
                        { id: id("pair"), left: "", right: "" },
                        { id: id("pair"), left: "", right: "" },
                      ]
                    : question.matchingPairs,
                hotspot:
                  type === "hotspot"
                    ? (question.hotspot ?? {
                        allowMultiple: false,
                        regions: [],
                      })
                    : question.hotspot,
                parts:
                  type === "multipart" && question.parts.length === 0
                    ? [newQuizPart(question.id, 0), newQuizPart(question.id, 1)]
                    : question.parts,
              });
            }}
            options={QUIZ_TYPE_OPTIONS}
            triggerClassName="w-full"
          />
        </div>
      </div>
      <div className="mt-2">
        <Field
          label="Question"
          aiActive={aiField("prompt")}
          path={`${qPath}/prompt`}
        >
          <ArtifactRichTextEditor
            value={question.prompt}
            onChange={(prompt) => onChange({ prompt })}
            path={`${qPath}/prompt`}
            placeholder="Write a clear question"
          />
        </Field>
      </div>
      {["multiple_choice", "true_false", "select_all", "ordering"].includes(
        question.type,
      ) ? (
        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[12px] font-semibold text-[var(--text-secondary)]">
              Answer options
            </h4>
          </div>
          <div className="grid gap-1">
            {question.options.map((option, index) => (
              <div
                key={question.optionIds[index] ?? index}
                className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2"
              >
                {question.type === "ordering" ? (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-default)] text-[11px] font-semibold text-[var(--text-secondary)]">
                    {index + 1}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={`flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${
                      question.type === "select_all"
                        ? (question.correctOptionIds ?? []).includes(
                            question.optionIds[index] ?? "",
                          ) && option
                          ? "border-[var(--success)] bg-[var(--success)] text-white"
                          : "border-[var(--border-default)] text-[var(--text-tertiary)]"
                        : (question.correctOptionIds ?? []).includes(
                              question.optionIds[index] ?? "",
                            ) && option
                          ? "border-[var(--success)] text-[var(--success)]"
                          : "border-[var(--border-default)] text-[var(--text-tertiary)]"
                    }`}
                    onClick={() => {
                      if (!option) return;
                      const optionId = question.optionIds[index];
                      if (!optionId) return;
                      if (question.type === "select_all") {
                        const current = question.correctAnswers ?? [];
                        const currentIds = question.correctOptionIds ?? [];
                        onChange({
                          correctAnswers: current.includes(option)
                            ? current.filter((answer) => answer !== option)
                            : [...current, option],
                          correctOptionIds: currentIds.includes(optionId)
                            ? currentIds.filter((id) => id !== optionId)
                            : [...currentIds, optionId],
                        });
                      } else
                        onChange({
                          correctAnswer: option,
                          correctOptionIds: [optionId],
                        });
                    }}
                    {...targetAttrs(
                      `${qPath}/${
                        question.type === "select_all"
                          ? "correctAnswers"
                          : "correctAnswer"
                      }`,
                      `option:${index}`,
                      "toggle",
                    )}
                    aria-label={`${
                      question.type === "select_all" &&
                      (question.correctOptionIds ?? []).includes(
                        question.optionIds[index] ?? "",
                      )
                        ? "Unmark"
                        : "Mark"
                    } option ${index + 1} correct`}
                  >
                    {(question.type === "select_all"
                      ? (question.correctOptionIds ?? []).includes(
                          question.optionIds[index] ?? "",
                        )
                      : (question.correctOptionIds ?? []).includes(
                          question.optionIds[index] ?? "",
                        )) && option ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Circle className="h-3 w-3" />
                    )}
                  </button>
                )}
                <input
                  value={option}
                  onChange={(event) => updateOption(index, event.target.value)}
                  readOnly={question.type === "true_false"}
                  data-ai-region={aiRegionAttr(aiField(`options/${index}`))}
                  {...targetAttrs(`${qPath}/options/${index}`)}
                  className={`${inputClass()} ${
                    question.type === "true_false"
                      ? "cursor-default bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
                      : ""
                  }`}
                  placeholder={`Option ${index + 1}`}
                />
                <div className="flex items-center gap-1">
                  {question.type === "ordering" ? (
                    <>
                      <button
                        type="button"
                        className={iconButtonClass()}
                        disabled={index === 0}
                        onClick={() => {
                          const options = [...question.options];
                          const optionIds = [...question.optionIds];
                          [options[index - 1], options[index]] = [
                            options[index]!,
                            options[index - 1]!,
                          ];
                          [optionIds[index - 1], optionIds[index]] = [
                            optionIds[index]!,
                            optionIds[index - 1]!,
                          ];
                          onChange({
                            options,
                            optionIds,
                            correctAnswers: options,
                          });
                        }}
                        aria-label={`Move option ${index + 1} earlier`}
                      >
                        <ChevronDown className="h-4 w-4 rotate-180" />
                      </button>
                      <button
                        type="button"
                        className={iconButtonClass()}
                        disabled={index === question.options.length - 1}
                        onClick={() => {
                          const options = [...question.options];
                          const optionIds = [...question.optionIds];
                          [options[index], options[index + 1]] = [
                            options[index + 1]!,
                            options[index]!,
                          ];
                          [optionIds[index], optionIds[index + 1]] = [
                            optionIds[index + 1]!,
                            optionIds[index]!,
                          ];
                          onChange({
                            options,
                            optionIds,
                            correctAnswers: options,
                          });
                        }}
                        aria-label={`Move option ${index + 1} later`}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </>
                  ) : null}
                  {question.type !== "true_false" ? (
                    <button
                      type="button"
                      className={iconButtonClass()}
                      onClick={() => {
                        const removed = question.options[index];
                        const options = question.options.filter(
                          (_, candidate) => candidate !== index,
                        );
                        const optionIds = question.optionIds.filter(
                          (_, candidate) => candidate !== index,
                        );
                        onChange({
                          options,
                          optionIds,
                          correctOptionIds: (
                            question.correctOptionIds ?? []
                          ).filter((id) => id !== question.optionIds[index]),
                          correctAnswer:
                            question.correctAnswer === removed
                              ? ""
                              : question.correctAnswer,
                          correctAnswers: (
                            question.correctAnswers ?? []
                          ).filter((answer) => answer !== removed),
                        });
                      }}
                      aria-label={`Remove option ${index + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          {question.type !== "true_false" ? (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className={smallActionClass()}
                onClick={() =>
                  onChange({
                    options: [...question.options, ""],
                    optionIds: [...question.optionIds, id("option")],
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" /> Add option
              </button>
              {question.type !== "ordering" ? (
                <button
                  type="button"
                  className={smallActionClass()}
                  onClick={() => {
                    const paired = question.options.map((option, index) => ({
                      option,
                      optionId: question.optionIds[index] ?? id("option"),
                    }));
                    for (let index = paired.length - 1; index > 0; index -= 1) {
                      const target = Math.floor(Math.random() * (index + 1));
                      [paired[index], paired[target]] = [
                        paired[target]!,
                        paired[index]!,
                      ];
                    }
                    onChange({
                      options: paired.map(({ option }) => option),
                      optionIds: paired.map(({ optionId }) => optionId),
                    });
                  }}
                >
                  <Shuffle className="h-3.5 w-3.5" /> Shuffle options
                </button>
              ) : null}
            </div>
          ) : null}
          <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
            {question.type === "ordering"
              ? "The order shown above is the canonical answer."
              : question.type === "select_all"
                ? "Select every correct option using the marker beside it."
                : "Select the correct option using its marker."}
          </p>
          {/* The answer key is matched on the option's text, so two options that
              read the same are genuinely undecidable and a blank one can never
              be the answer. Both are said here, while the author can still fix
              them, rather than only at publish. */}
          {answerKeyProblems.length ? (
            <ul className="mt-2 space-y-1 text-[11px] leading-5 text-[var(--warning)]">
              {answerKeyProblems.map((problem) => (
                <li key={problem} className="flex items-start gap-1.5">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{problem}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : question.type === "matching" ? (
        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[12px] font-semibold text-[var(--text-secondary)]">
              Matching pairs
            </h4>
            <button
              type="button"
              className={smallActionClass()}
              onClick={() =>
                onChange({
                  matchingPairs: [
                    ...(question.matchingPairs ?? []),
                    { id: id("pair"), left: "", right: "" },
                  ],
                })
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add pair
            </button>
          </div>
          <div className="space-y-2">
            {(question.matchingPairs ?? []).map((pair, index) => (
              <div
                key={pair.id}
                className="grid grid-cols-[minmax(0,1fr)_18px_minmax(0,1fr)_30px] items-center gap-2"
              >
                <input
                  value={pair.left}
                  onChange={(event) =>
                    onChange({
                      matchingPairs: (question.matchingPairs ?? []).map(
                        (candidate) =>
                          candidate.id === pair.id
                            ? { ...candidate, left: event.target.value }
                            : candidate,
                      ),
                    })
                  }
                  data-ai-region={aiRegionAttr(
                    aiField(`matchingPairs/${index}/left`) ||
                      aiField(`matchingPairs/${index}`),
                  )}
                  {...targetAttrs(`${qPath}/matchingPairs/${index}/left`)}
                  className={inputClass()}
                  placeholder={`Prompt ${index + 1}`}
                />
                <span className="text-center text-[var(--text-tertiary)]">
                  →
                </span>
                <input
                  value={pair.right ?? ""}
                  onChange={(event) =>
                    onChange({
                      matchingPairs: (question.matchingPairs ?? []).map(
                        (candidate) =>
                          candidate.id === pair.id
                            ? { ...candidate, right: event.target.value }
                            : candidate,
                      ),
                    })
                  }
                  data-ai-region={aiRegionAttr(
                    aiField(`matchingPairs/${index}/right`) ||
                      aiField(`matchingPairs/${index}`),
                  )}
                  {...targetAttrs(`${qPath}/matchingPairs/${index}/right`)}
                  className={inputClass()}
                  placeholder={`Match ${index + 1}`}
                />
                <button
                  type="button"
                  className={iconButtonClass()}
                  disabled={(question.matchingPairs ?? []).length <= 2}
                  onClick={() =>
                    onChange({
                      matchingPairs: (question.matchingPairs ?? []).filter(
                        (candidate) => candidate.id !== pair.id,
                      ),
                    })
                  }
                  aria-label={`Remove matching pair ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-micro text-[var(--text-tertiary)]">
            Matches are shuffled in each private practice attempt. The right
            side remains hidden from learners until feedback is released.
          </p>
        </section>
      ) : question.type === "hotspot" ? (
        <section className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-[12px] font-semibold text-[var(--text-secondary)]">
                Hotspot regions
              </h4>
              <p className="text-micro text-[var(--text-tertiary)]">
                Percent-based regions stay aligned when the question image
                resizes.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-pressed={question.hotspot?.allowMultiple === true}
                className={smallActionClass()}
                onClick={() =>
                  onChange({
                    hotspot: {
                      allowMultiple: question.hotspot?.allowMultiple !== true,
                      regions: question.hotspot?.regions ?? [],
                    },
                  })
                }
              >
                {question.hotspot?.allowMultiple
                  ? "Multiple regions"
                  : "One region"}
              </button>
              <button
                type="button"
                className={smallActionClass()}
                onClick={() =>
                  onChange({
                    hotspot: {
                      allowMultiple: question.hotspot?.allowMultiple === true,
                      regions: [
                        ...(question.hotspot?.regions ?? []),
                        {
                          id: id("region"),
                          label: `Region ${(question.hotspot?.regions.length ?? 0) + 1}`,
                          x: 0.1,
                          y: 0.1,
                          width: 0.25,
                          height: 0.2,
                          correct: false,
                        },
                      ],
                    },
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" /> Add region
              </button>
            </div>
          </div>
          <div className="relative aspect-video overflow-hidden rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-secondary)]">
            {(question.hotspot?.regions ?? []).map((region) => (
              <button
                key={region.id}
                type="button"
                aria-pressed={region.correct}
                aria-label={`${region.label || "Region"}${region.correct ? ", correct" : ", not correct"}`}
                onClick={() =>
                  onChange({
                    hotspot: {
                      allowMultiple: question.hotspot?.allowMultiple === true,
                      regions: (question.hotspot?.regions ?? []).map(
                        (candidate) =>
                          candidate.id === region.id
                            ? { ...candidate, correct: !candidate.correct }
                            : candidate,
                      ),
                    },
                  })
                }
                style={{
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${region.width * 100}%`,
                  height: `${region.height * 100}%`,
                }}
                className={`absolute min-h-7 min-w-7 rounded-[5px] border-2 px-1 text-micro font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)] ${region.correct ? "border-[var(--success)] bg-[color-mix(in_oklab,var(--success)_18%,transparent)] text-[var(--text-primary)]" : "border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--bg-primary)_70%,transparent)] text-[var(--text-secondary)]"}`}
              >
                {region.label}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {(question.hotspot?.regions ?? []).map((region, index) => (
              <div
                key={region.id}
                className="grid grid-cols-[minmax(120px,1fr)_repeat(4,64px)_30px] items-end gap-2 overflow-x-auto rounded-[7px] border border-[var(--border-subtle)] p-2"
              >
                <Field label={`Region ${index + 1}`}>
                  <input
                    value={region.label}
                    onChange={(event) =>
                      onChange({
                        hotspot: {
                          allowMultiple:
                            question.hotspot?.allowMultiple === true,
                          regions: (question.hotspot?.regions ?? []).map(
                            (candidate) =>
                              candidate.id === region.id
                                ? { ...candidate, label: event.target.value }
                                : candidate,
                          ),
                        },
                      })
                    }
                    className={inputClass()}
                  />
                </Field>
                {(
                  [
                    ["x", "X %"],
                    ["y", "Y %"],
                    ["width", "W %"],
                    ["height", "H %"],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} label={label}>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={Math.round(region[key] * 100)}
                      onChange={(event) => {
                        const value =
                          Math.max(
                            0,
                            Math.min(100, Number(event.target.value) || 0),
                          ) / 100;
                        onChange({
                          hotspot: {
                            allowMultiple:
                              question.hotspot?.allowMultiple === true,
                            regions: (question.hotspot?.regions ?? []).map(
                              (candidate) =>
                                candidate.id === region.id
                                  ? { ...candidate, [key]: value }
                                  : candidate,
                            ),
                          },
                        });
                      }}
                      className={inputClass()}
                    />
                  </Field>
                ))}
                <button
                  type="button"
                  className={iconButtonClass()}
                  onClick={() =>
                    onChange({
                      hotspot: {
                        allowMultiple: question.hotspot?.allowMultiple === true,
                        regions: (question.hotspot?.regions ?? []).filter(
                          (candidate) => candidate.id !== region.id,
                        ),
                      },
                    })
                  }
                  aria-label={`Remove ${region.label || `region ${index + 1}`}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <p className="text-micro text-[var(--text-tertiary)]">
            Select regions in the preview to mark them correct. Learners receive
            the same named regions as keyboard buttons.
          </p>
        </section>
      ) : question.type === "multipart" ? (
        <section className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-[12px] font-semibold text-[var(--text-secondary)]">
                Question parts
              </h4>
              <p className="text-micro text-[var(--text-tertiary)]">
                Ordered auto-scored parts share the prompt above.
              </p>
            </div>
            <button
              type="button"
              className={smallActionClass()}
              onClick={() =>
                onChange({
                  parts: [
                    ...question.parts,
                    newQuizPart(question.id, question.parts.length),
                  ],
                })
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add part
            </button>
          </div>
          {question.parts.map((part, partIndex) => {
            const choiceType = [
              "multiple_choice",
              "true_false",
              "select_all",
              "ordering",
            ].includes(part.type);
            const updatePart = (patch: Partial<typeof part>) =>
              onChange({
                parts: question.parts.map((candidate) =>
                  candidate.id === part.id
                    ? { ...candidate, ...patch }
                    : candidate,
                ),
              });
            return (
              <article
                key={part.id}
                className="rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3"
              >
                <div className="grid grid-cols-[auto_minmax(0,1fr)_160px_auto] items-center gap-2">
                  <strong className="text-micro tabular-nums text-[var(--text-tertiary)]">
                    {partIndex + 1}
                  </strong>
                  <input
                    value={part.prompt}
                    onChange={(event) =>
                      updatePart({ prompt: event.target.value })
                    }
                    className={inputClass()}
                    placeholder="Part prompt"
                    aria-label={`Part ${partIndex + 1} prompt`}
                  />
                  <SelectField
                    ariaLabel={`Part ${partIndex + 1} type`}
                    size="sm"
                    value={part.type}
                    onChange={(value) => {
                      const type = value as typeof part.type;
                      updatePart({
                        type,
                        options:
                          type === "true_false"
                            ? ["True", "False"]
                            : choiceType && !part.options.length
                              ? ["", "", "", ""]
                              : part.options,
                        correctOptionIds: [],
                      });
                    }}
                    options={MULTIPART_TYPE_OPTIONS}
                    triggerClassName="w-full"
                  />
                  <button
                    type="button"
                    className={iconButtonClass()}
                    disabled={question.parts.length <= 1}
                    onClick={() =>
                      onChange({
                        parts: question.parts.filter(
                          (candidate) => candidate.id !== part.id,
                        ),
                      })
                    }
                    aria-label={`Remove part ${partIndex + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                  {choiceType ? (
                    <Field label="Options (one per line)">
                      <textarea
                        rows={3}
                        value={part.options.join("\n")}
                        readOnly={part.type === "true_false"}
                        onChange={(event) => {
                          const options = event.target.value.split("\n");
                          updatePart({
                            options,
                            optionIds: options.map(
                              (_, index) =>
                                part.optionIds[index] ??
                                `${part.id}:option:${index + 1}`,
                            ),
                          });
                        }}
                        className={textareaClass("min-h-[76px]")}
                      />
                    </Field>
                  ) : part.type === "matching" ? (
                    <Field label="Pairs (prompt → match)">
                      <textarea
                        rows={3}
                        value={(part.matchingPairs ?? [])
                          .map((pair) => `${pair.left} → ${pair.right}`)
                          .join("\n")}
                        onChange={(event) =>
                          updatePart({
                            matchingPairs: event.target.value
                              .split("\n")
                              .filter(Boolean)
                              .map((line, index) => {
                                const [left = "", right = ""] = line.split(
                                  /\s*(?:→|=>)\s*/,
                                  2,
                                );
                                return {
                                  id:
                                    part.matchingPairs?.[index]?.id ??
                                    `${part.id}:pair:${index + 1}`,
                                  left,
                                  right,
                                };
                              }),
                            matchingChoices: event.target.value
                              .split("\n")
                              .filter(Boolean)
                              .map(
                                (line) =>
                                  line.split(/\s*(?:→|=>)\s*/, 2)[1] ?? "",
                              ),
                          })
                        }
                        className={textareaClass("min-h-[76px]")}
                      />
                    </Field>
                  ) : (
                    <Field label="Expected answer">
                      <input
                        type={part.type === "numeric" ? "number" : "text"}
                        value={part.correctAnswer ?? ""}
                        onChange={(event) =>
                          updatePart({ correctAnswer: event.target.value })
                        }
                        className={inputClass()}
                      />
                    </Field>
                  )}
                  <div className="grid gap-2">
                    <Field label="Points">
                      <input
                        type="number"
                        min={0.01}
                        max={100}
                        step="0.25"
                        value={part.points ?? 1}
                        onChange={(event) =>
                          updatePart({
                            points: Number(event.target.value) || 1,
                          })
                        }
                        className={inputClass()}
                      />
                    </Field>
                    {choiceType && part.type !== "ordering" ? (
                      <Field label="Correct answer(s)">
                        <input
                          value={
                            part.type === "select_all"
                              ? (part.correctAnswers ?? []).join("; ")
                              : (part.correctAnswer ?? "")
                          }
                          onChange={(event) => {
                            const answers = event.target.value
                              .split(";")
                              .map((answer) => answer.trim())
                              .filter(Boolean);
                            const correctOptionIds = part.optionIds.filter(
                              (_, index) =>
                                answers.includes(part.options[index] ?? ""),
                            );
                            updatePart(
                              part.type === "select_all"
                                ? { correctAnswers: answers, correctOptionIds }
                                : {
                                    correctAnswer: event.target.value,
                                    correctOptionIds,
                                  },
                            );
                          }}
                          className={inputClass()}
                          placeholder={
                            part.type === "select_all" ? "A; C" : "Answer"
                          }
                        />
                      </Field>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : question.type === "long_response" ? (
        <div className="mt-4">
          <Field
            label="Formative rubric / review guidance"
            aiActive={aiField("rubric")}
            path={`${qPath}/rubric`}
          >
            <textarea
              value={question.rubric ?? ""}
              onChange={(event) => onChange({ rubric: event.target.value })}
              className={textareaClass("min-h-[110px]")}
              placeholder="What should a strong response include?"
            />
          </Field>
          <p className="mt-2 text-micro leading-4 text-[var(--text-tertiary)]">
            Long responses are not auto-scored. Learners receive this guidance
            as advisory formative feedback.
          </p>
        </div>
      ) : question.type === "numeric" ? (
        <div
          className="mt-4 grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}
        >
          <Field
            label="Expected number"
            aiActive={aiField("correctAnswer")}
            path={`${qPath}/correctAnswer`}
          >
            <input
              type="number"
              value={question.correctAnswer ?? ""}
              onChange={(event) =>
                onChange({ correctAnswer: event.target.value })
              }
              className={inputClass()}
              placeholder="42"
            />
          </Field>
          <Field
            label="Accepted tolerance (±)"
            aiActive={aiField("numericTolerance")}
            path={`${qPath}/numericTolerance`}
          >
            <input
              type="number"
              min={0}
              step="any"
              value={question.numericTolerance ?? 0}
              onChange={(event) =>
                onChange({
                  numericTolerance: Math.max(
                    0,
                    Number(event.target.value) || 0,
                  ),
                })
              }
              className={inputClass()}
              placeholder="0"
            />
          </Field>
        </div>
      ) : (
        <div className="mt-4">
          <Field
            label={
              question.type === "fill_blank"
                ? "Primary accepted answer"
                : "Expected answer"
            }
            aiActive={aiField("correctAnswer")}
            path={`${qPath}/correctAnswer`}
          >
            <input
              value={question.correctAnswer ?? ""}
              onChange={(event) =>
                onChange({ correctAnswer: event.target.value })
              }
              className={inputClass()}
              placeholder={
                question.type === "fill_blank"
                  ? "Text that completes the blank"
                  : "Short answer key"
              }
            />
          </Field>
          {question.type === "fill_blank" ? (
            <div className="mt-3">
              <Field
                label="Other accepted answers"
                aiActive={aiField("correctAnswers")}
                path={`${qPath}/correctAnswers`}
              >
                <input
                  value={(question.correctAnswers ?? []).join("; ")}
                  onChange={(event) =>
                    onChange({
                      correctAnswers: event.target.value
                        .split(";")
                        .map((answer) => answer.trim())
                        .filter(Boolean),
                    })
                  }
                  className={inputClass()}
                  placeholder="Alternative spelling; equivalent phrase"
                />
              </Field>
            </div>
          ) : null}
        </div>
      )}
      <section className="mt-4 grid gap-3 rounded-[9px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3 sm:grid-cols-2">
        <Field label="Partial credit">
          <SelectField
            ariaLabel="Partial credit"
            size="sm"
            value={question.scoring.partialCredit}
            onChange={(value) =>
              onChange({
                scoring: {
                  ...question.scoring,
                  partialCredit: value as "none" | "proportional",
                },
              })
            }
            options={[
              { value: "none", label: "All or nothing" },
              { value: "proportional", label: "Proportional" },
            ]}
            triggerClassName="w-full"
          />
        </Field>
        <Field label="Incorrect-answer penalty">
          <input
            type="number"
            min={0}
            max={100}
            step="0.25"
            value={question.scoring.penaltyPoints}
            onChange={(event) =>
              onChange({
                scoring: {
                  ...question.scoring,
                  penaltyPoints: Math.max(
                    0,
                    Math.min(100, Number(event.target.value) || 0),
                  ),
                },
              })
            }
            className={inputClass()}
          />
        </Field>
        <Field label="When correct">
          <textarea
            value={question.correctFeedback ?? ""}
            onChange={(event) =>
              onChange({ correctFeedback: event.target.value })
            }
            className={textareaClass("min-h-[72px]")}
            placeholder="Reinforce what worked"
          />
        </Field>
        <Field label="When incorrect">
          <textarea
            value={question.incorrectFeedback ?? ""}
            onChange={(event) =>
              onChange({ incorrectFeedback: event.target.value })
            }
            className={textareaClass("min-h-[72px]")}
            placeholder="Offer a next step or misconception check"
          />
        </Field>
        {feedbackTargets.length ? (
          <details className="spectra-quiz-content-advanced sm:col-span-2">
            <summary>
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Feedback per answer
              <ChevronDown className="ml-auto h-3.5 w-3.5" />
            </summary>
            <div className="grid gap-2 pt-3">
              {feedbackTargets.map((target) => (
                <Field key={target.id} label={target.label}>
                  <input
                    value={question.answerFeedback[target.id] ?? ""}
                    onChange={(event) =>
                      onChange({
                        answerFeedback: {
                          ...question.answerFeedback,
                          [target.id]: event.target.value,
                        },
                      })
                    }
                    className={inputClass()}
                    placeholder="Optional feedback for this answer"
                  />
                </Field>
              ))}
            </div>
          </details>
        ) : null}
      </section>
      <div className="mt-4">
        <Field
          label="Explanation"
          aiActive={aiField("explanation")}
          path={`${qPath}/explanation`}
        >
          <textarea
            value={question.explanation ?? ""}
            onChange={(event) => onChange({ explanation: event.target.value })}
            className={textareaClass("min-h-[110px]")}
            placeholder="Optional answer explanation"
          />
        </Field>
      </div>
      <div className="mt-4">
        <Field
          label="Tags / topics"
          aiActive={aiField("tags")}
          path={`${qPath}/tags`}
        >
          <div className="spectra-quiz-tag-editor">
            {(question.tags ?? []).map((tag) => (
              <span key={tag}>
                {tag}
                <button
                  type="button"
                  aria-label={`Remove ${tag} tag`}
                  onClick={() =>
                    onChange({
                      tags: (question.tags ?? []).filter(
                        (item) => item !== tag,
                      ),
                    })
                  }
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            <input
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onBlur={addTag}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  addTag();
                }
              }}
              placeholder="+ Add tag"
            />
          </div>
        </Field>
      </div>
      <details className="spectra-quiz-content-advanced mt-4">
        <summary>
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Feedback and source details
          <ChevronDown className="ml-auto h-3.5 w-3.5" />
        </summary>
        <div className="grid gap-4 pt-3">
          <Field
            label="Formative feedback / next step"
            aiActive={aiField("feedback")}
            path={`${qPath}/feedback`}
          >
            <textarea
              value={question.feedback ?? ""}
              onChange={(event) => onChange({ feedback: event.target.value })}
              className={textareaClass("min-h-[76px]")}
              placeholder="Offer a useful next step without turning practice into a grade."
            />
          </Field>
          <Field
            label="Sources / provenance"
            aiActive={aiField("sourceRefs")}
            path={`${qPath}/sourceRefs`}
          >
            <input
              value={(question.sourceRefs ?? []).join(", ")}
              onChange={(event) =>
                onChange({
                  sourceRefs: event.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
              className={inputClass()}
              placeholder="Textbook p. 42, class notes"
            />
          </Field>
        </div>
      </details>
    </div>
  );
}

function QuizPartResponse({
  part,
  response,
  disabled,
  onChange,
}: {
  part: QuizPart;
  response: QuizResponseAtom | undefined;
  disabled: boolean;
  onChange: (response: QuizResponseAtom, commitNow: boolean) => void;
}) {
  const selected = Array.isArray(response) ? response : [];
  const options =
    part.type === "true_false" && part.options.length === 0
      ? ["True", "False"]
      : part.options;
  if (part.type === "select_all")
    return (
      <div className="space-y-1.5">
        {options.map((option, index) => {
          const active = selected.includes(option);
          return (
            <button
              key={`${part.id}:${index}`}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() =>
                onChange(
                  active
                    ? selected.filter((value) => value !== option)
                    : [...selected, option],
                  true,
                )
              }
              className={`flex w-full items-center gap-2 rounded-[7px] border px-3 py-2 text-left text-[11px] ${active ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-primary))]" : "border-[var(--border-default)]"}`}
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-[4px] border border-current">
                {active ? <Check className="h-3 w-3" /> : null}
              </span>
              {option || `Option ${index + 1}`}
            </button>
          );
        })}
      </div>
    );
  if (part.type === "ordering") {
    const order = selected.length ? selected : options;
    return (
      <div className="space-y-1.5">
        {order.map((option, index) => (
          <div
            key={`${part.id}:${option}:${index}`}
            className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-[7px] border border-[var(--border-default)] px-3 py-2 text-[11px]"
          >
            <strong>{index + 1}</strong>
            <span>{option || `Option ${index + 1}`}</span>
            <span>
              <button
                type="button"
                disabled={disabled || index === 0}
                aria-label={`Move ${option} earlier`}
                onClick={() => {
                  const next = [...order];
                  [next[index - 1], next[index]] = [
                    next[index]!,
                    next[index - 1]!,
                  ];
                  onChange(next, true);
                }}
                className="p-1 disabled:opacity-30"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={disabled || index === order.length - 1}
                aria-label={`Move ${option} later`}
                onClick={() => {
                  const next = [...order];
                  [next[index], next[index + 1]] = [
                    next[index + 1]!,
                    next[index]!,
                  ];
                  onChange(next, true);
                }}
                className="p-1 disabled:opacity-30"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (part.type === "matching")
    return (
      <div className="space-y-1.5">
        {(part.matchingPairs ?? []).map((pair) => {
          const current = selected
            .find((entry) => entry.startsWith(`${pair.id}:`))
            ?.slice(pair.id.length + 1);
          return (
            <div
              key={pair.id}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2"
            >
              <span className="text-[11px] font-medium">{pair.left}</span>
              <SelectField
                ariaLabel={`Match for ${pair.left || "part prompt"}`}
                size="sm"
                disabled={disabled}
                value={current ?? ""}
                placeholder="Choose"
                onChange={(value) => {
                  const next = selected.filter(
                    (entry) => !entry.startsWith(`${pair.id}:`),
                  );
                  if (value) next.push(`${pair.id}:${value}`);
                  onChange(next, true);
                }}
                options={(part.matchingChoices ?? []).map((choice) => ({
                  value: choice,
                  label: choice,
                }))}
              />
            </div>
          );
        })}
      </div>
    );
  if (options.length)
    return (
      <div className="space-y-1.5">
        {options.map((option, index) => (
          <button
            key={`${part.id}:${index}`}
            type="button"
            disabled={disabled}
            aria-pressed={response === option}
            onClick={() => onChange(option, true)}
            className={`w-full rounded-[7px] border px-3 py-2 text-left text-[11px] ${response === option ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-primary))]" : "border-[var(--border-default)]"}`}
          >
            {String.fromCharCode(65 + index)}. {option || `Option ${index + 1}`}
          </button>
        ))}
      </div>
    );
  return (
    <input
      type={part.type === "numeric" ? "number" : "text"}
      disabled={disabled}
      value={typeof response === "string" ? response : ""}
      onChange={(event) => onChange(event.target.value, false)}
      onBlur={(event) => onChange(event.currentTarget.value, true)}
      className={inputClass()}
      placeholder="Type your answer"
    />
  );
}
