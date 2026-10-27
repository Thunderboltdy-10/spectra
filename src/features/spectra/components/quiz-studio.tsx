"use client";

import { useMissingAssets } from "./use-missing-assets";
import { currentTimeMs } from "@/lib/unique-token";
import { readConvexError } from "../../../../shared/convex-error.mjs";
import {
  AlertCircle,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  History,
  Import,
  List,
  Loader2,
  Pencil,
  PanelLeft,
  Plus,
  Radio,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LifeForm, LifeVerdict } from "@/components/ui/life-moments";
import { SelectField } from "@/components/ui/select";
import {
  abortArtifactImportUpload,
  beginArtifactImportOriginal,
  completeArtifactImport,
  getArtifactAssets,
  getSpectraQuizPracticeAttempts,
  getSpectraQuizResponseSummary,
  saveSpectraQuizPracticeResponse,
  startSpectraQuizPractice,
  submitSpectraQuizPractice,
  uploadArtifactAsset,
  uploadArtifactImportOriginal,
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
  validateQuizForPublishing,
  type PortableQuizQuestion,
} from "../quiz/interchange";

import { SpectraStoredText } from "./spectra-rich-content";
import { plainTextFromStored } from "../rich-content";
import { spectraBus } from "../events";
import { itemForRegion, itemInPassage, plainOfMarkup, QUESTION_NOUNS, type WorkRegion } from "../anchors/locate";
import { regionElement, useOpenAnchor, type AnchorLanding } from "../anchors/use-open-anchor";

/** The semantic layer's region for the quiz's learner instructions (shared/semantic-chunks.ts). */
const QUIZ_INSTRUCTIONS_REGION = "quiz-setting:instructions";
import {
  Field,
  iconButtonClass,
  inputClass,
  quizQuestions,
  smallActionClass,
  textareaClass,
} from "./artifact-studio";
import {
  id,
  quizSettingsFromContent,
  record,
  type QuizQuestion,
  type QuizSettings,
} from "./artifact-content-model";
import { artifactBlobSha256 } from "./artifact-studio-file-utils";
import { formatShortDate } from "./spectra-view-model";
import {
  ArtifactWorkbar,
  WorkbarItemSelector,
  contentHistoryBindings,
  type CommandBinding,
} from "./artifact-workbar";
import { projectBindingsFromIr } from "../capabilities";
import { useStudioContract } from "./artifact-studio-shell";
import { StudioItemRail } from "./studio-item-rail";
import { QuestionSheet } from "./quiz/question-sheet";
import { QUIZ_TYPE_LABELS, retypeQuestion } from "./quiz/question-types";
import { QuestionThumbnail } from "./quiz/question-thumbnail";
import { NumberField } from "@/components/ui/number-field";

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
        <h3 className="text-ui font-semibold text-[var(--text-primary)]">
          How this quiz is used
        </h3>
        <p className="text-micro text-[var(--text-secondary)]">
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
              className={`rounded-card border p-3 text-left transition-colors disabled:opacity-45 ${
                active
                  ? "border-[var(--border-strong)] bg-[var(--bg-elevated)]"
                  : "border-[var(--border-default)] hover:border-[var(--border-strong)]"
              }`}
            >
              <span className="block text-caption font-semibold text-[var(--text-primary)]">
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
        className="mt-3 text-micro font-semibold text-[var(--text-secondary)] underline-offset-2 hover:underline"
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
              <NumberField
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
            <NumberField
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
                resultsVisibility:
                  value as QuizExperience["resultsVisibility"],
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

function quizPracticeErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("QUIZ_ATTEMPT_TIME_ELAPSED"))
    return "Time ran out, so this answer was not recorded. Submit to see how you did.";
  if (message.includes("QUIZ_PRACTICE_UNAVAILABLE")) {
    // The server already phrases why an attempt cannot start — a deadline that
    // has passed, an attempt allowance that is used up — so pass its own words
    // through rather than guessing at a second explanation.
    const reason = message.split("QUIZ_PRACTICE_UNAVAILABLE:")[1]?.trim();
    return reason || "This quiz is not open for attempts right now.";
  }
  if (message.includes("QUIZ_PRACTICE_ATTEMPT_LIMIT_REACHED"))
    return "You have reached this quiz’s configured practice-attempt limit.";
  if (message.includes("QUIZ_PRACTICE_STILL_PUBLISHING"))
    return "It is still publishing. Press Attempt again in a moment.";
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
      <ul className="space-y-1.5 text-ui text-[var(--text-secondary)]">
        <li>
          <span className="font-semibold text-[var(--success)]">{correct}</span>
          {" · right"}
        </li>
        <li>
          <span className="font-semibold text-[var(--danger)]">{incorrect}</span>
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
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [inspectAttempt, setInspectAttempt] = useState(false);
  const [practiceAttempt, setPracticeAttempt] =
    useState<SpectraQuizPracticeAttempt>();
  const practiceQuestionTypes = useMemo(
    () => new Map((practiceAttempt?.questions ?? []).map(({ id, type }) => [id, type])),
    [practiceAttempt?.questions],
  );
  const [practiceAttempts, setPracticeAttempts] = useState<
    SpectraQuizPracticeAttempt[]
  >([]);
  const [practiceLoading, setPracticeLoading] = useState(true);
  const [practiceBusy, setPracticeBusy] = useState(false);
  const [practiceSyncing, setPracticeSyncing] = useState<string[]>([]);
  const practiceWrites = useRef(new Map<ReturnType<typeof saveSpectraQuizPracticeResponse>, string>());
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
  // A question's extra settings fold under its sheet; opened on request.
  const [questionDetailsOpen, setQuestionDetailsOpen] = useState(false);
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
  // Opened at a question or the instructions (a search hit, a citation):
  // the builder shows it. A learner's attempt is never moved.
  const landOnQuestion = useCallback(
    (region: WorkRegion): AnchorLanding | null => {
      if (!canEditQuiz) return null;
      if (region.id === QUIZ_INSTRUCTIONS_REGION)
        return {
          select: () => setView("settings"),
          find: (root) => regionElement(root, QUIZ_INSTRUCTIONS_REGION),
        };
      const named = itemForRegion(questions, region, QUESTION_NOUNS);
      if (!named) return null;
      const question =
        itemInPassage(questions, questions.indexOf(named), (entry) =>
          [plainOfMarkup(entry.prompt), ...entry.options, plainOfMarkup(entry.explanation)].join(" "),
        region.excerpt) ?? named;
      return {
        select: () => {
          setActiveQuestionId(question.id);
          setView("builder");
        },
        find: (root) => regionElement(root, question.id),
      };
    },
    [canEditQuiz, questions],
  );
  useOpenAnchor(artifactId, landOnQuestion);
  const quizImportRef = useRef<HTMLInputElement>(null);
  const quizWasReadOnly = useRef(!canEditQuiz);
  const [practiceClockNow, setPracticeClockNow] = useState(0);
  // The last thing the server said about the clock, and when it said it.
  const [practiceClock, setPracticeClock] = useState<{
    remainingMs: number;
    at: number;
  }>();
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
    if (practiceAttempt?.status !== "in_progress" || !practiceClock) return;
    setPracticeClockNow(Date.now());
    const timer = window.setInterval(
      () => setPracticeClockNow(Date.now()),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [practiceAttempt, practiceClock]);

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
  useMissingAssets(
    questions.flatMap((question) => (question.media?.assetId ? [question.media.assetId] : [])),
    quizAssetMap,
    () => getArtifactAssets(artifactId).then((result) => setQuizAssets(result.assets)),
  );

  // The quiz as it is now. A media upload finishes after an await, when the
  // render that started it holds stale questions; building on those would
  // silently drop every edit made meanwhile, collaborators' included.
  const latestQuizRef = useRef({ content, questions, quizSettings, published });
  latestQuizRef.current = { content, questions, quizSettings, published };

  function commit(next: QuizQuestion[], preservePublished = false) {
    const latest = latestQuizRef.current;
    const nextPublished = preservePublished ? latest.published : false;
    latestQuizRef.current = { ...latest, questions: next, published: nextPublished };
    setQuestions(next);
    if (!preservePublished) setPublished(false);
    setPublishIssues([]);
    onChange({
      ...record(latest.content),
      questions: next,
      settings: latest.quizSettings,
      published: nextPublished,
    });
  }

  // A new quiz arrives as one blank short answer, the shell the server can
  // keep schema-valid. A quiz is multiple choice unless someone says
  // otherwise, so the untouched shell becomes one the first time it opens.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const shellChecked = useRef(false);
  useEffect(() => {
    if (shellChecked.current || !canEditQuiz) return;
    shellChecked.current = true;
    const [only] = questions;
    const untouched =
      questions.length === 1 &&
      only?.type === "short_answer" &&
      !String(only.prompt ?? "").trim() &&
      !String(only.correctAnswer ?? "").trim() &&
      !String(only.explanation ?? "").trim();
    if (untouched) commitRef.current([{ ...only, ...retypeQuestion(only, "multiple_choice") }]);
  }, [canEditQuiz, questions]);

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
    const question = {
      id: questionId,
      prompt: "",
      type: "multiple_choice" as const,
      options: ["", "", "", ""],
      optionIds: [0, 1, 2, 3].map(
        (optionIndex) => `${questionId}:option:${optionIndex + 1}`,
      ),
      correctAnswer: "",
      explanation: "",
      difficulty: "medium" as const,
      points: 1,
      timeLimitSeconds: 90,
      bloomLevel: "remember" as const,
      standards: [],
      tags: [],
    };
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
      const nextQuestions = latestQuizRef.current.questions.map((question) =>
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

  // Removing an image or a question never releases its asset: undo and
  // History restore bring the item back, and every retained version still
  // references it. Assets are released with the artifact.
  function removeQuestionMedia(questionId: string) {
    if (!questions.some((question) => question.id === questionId && question.media)) return;
    commit(
      questions.map((question) =>
        question.id === questionId ? { ...question, media: undefined } : question,
      ),
    );
  }

  function removeQuestion(questionId: string) {
    const next = questions.filter((question) => question.id !== questionId);
    const replacement = next.length > 0 ? next : quizQuestions({});
    commit(replacement);
    setActiveQuestionId(replacement[0]?.id ?? "");
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

  function answerValueArray(value: string) {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  }

  const displayedQuestions: QuizQuestion[] = practiceAttempt
    ? practiceAttempt.questions.map((question) => ({
        ...question,
        optionIds: question.options.map(
          (_, optionIndex) =>
            `${question.id}:attempt-option:${optionIndex + 1}`,
        ),
        difficulty:
          question.difficulty === "easy" ||
          question.difficulty === "medium" ||
          question.difficulty === "hard"
            ? question.difficulty
            : undefined,
        media:
          record(question.media).assetId &&
          typeof record(question.media).assetId === "string"
            ? {
                assetId: String(record(question.media).assetId),
                name: String(record(question.media).name ?? "Question media"),
                mediaType: String(
                  record(question.media).mediaType ??
                    "application/octet-stream",
                ),
                altText:
                  typeof record(question.media).altText === "string"
                    ? String(record(question.media).altText)
                    : undefined,
              }
            : undefined,
      }))
    : questions;
  const activeDisplayedQuestionIndex = Math.max(
    0,
    displayedQuestions.findIndex(
      (question) => question.id === activeQuestionId,
    ),
  );
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
        if (!answer.startsWith("[")) return true;
        try {
          return (JSON.parse(answer) as unknown[]).length > 0;
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
    setAnswers(
      Object.fromEntries(
        Object.entries(attempt.responses).map(([questionId, response]) => [
          questionId,
          Array.isArray(response) ? JSON.stringify(response) : response,
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
      setPracticeError("Still publishing. Attempt opens as soon as it is saved.");
      setView("preview");
      return;
    }
    setPracticeBusy(true);
    setPracticeError(undefined);
    try {
      // The server learns of a publish a moment after this page does: while it
      // has not, Attempt stays busy and asks again with the same attempt id.
      const clientAttemptId = crypto.randomUUID();
      const startWhenPublished = async (
        tries: number,
      ): Promise<Awaited<ReturnType<typeof startSpectraQuizPractice>>> => {
        try {
          return await startSpectraQuizPractice({ artifactId, clientAttemptId });
        } catch (error) {
          const publishing = readConvexError(error).code === "QUIZ_PRACTICE_NOT_PUBLISHED";
          if (!publishing || !latestQuizRef.current.published) throw error;
          if (tries >= 4) throw new Error("QUIZ_PRACTICE_STILL_PUBLISHING");
          await new Promise((resolve) => window.setTimeout(resolve, 1_000 + tries * 750));
          return startWhenPublished(tries + 1);
        }
      };
      const started = await startWhenPublished(0);
      hydratePracticeAttempt(started);
      setPracticeAttempts((current) => [
        started,
        ...current.filter((item) => item.attemptId !== started.attemptId),
      ]);
    } catch (error) {
      setView("preview");
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

  function practiceAnswerValue(questionId: string, value: string) {
    const type = practiceQuestionTypes.get(questionId);
    return ["select_all", "ordering", "matching"].includes(type ?? "") ? answerValueArray(value) : value;
  }

  async function synchronizePracticeAnswer(questionId: string, value: string) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
    if (!practiceAttempt || practiceAttempt.status !== "in_progress") return;
    setPracticeSyncing((current) => [...new Set([...current, questionId])]);
    let writing: ReturnType<typeof saveSpectraQuizPracticeResponse> | undefined;
    try {
      const save = () => {
        setPracticeError(undefined);
        return saveSpectraQuizPracticeResponse({
          attemptId: practiceAttempt.attemptId,
          questionId,
          response: practiceAnswerValue(questionId, value),
          clientMutationId: crypto.randomUUID(),
        });
      };
      // One learner can blur, revise and blur again before the first save
      // arrives. Preserve that order so an older request cannot win on reload.
      const earlier = [...practiceWrites.current]
        .filter(([, id]) => id === questionId)
        .map(([pending]) => pending);
      writing = earlier.length ? Promise.allSettled(earlier).then(save) : save();
      practiceWrites.current.set(writing, questionId);
      const synchronized = await writing;
      if (synchronized.result)
        setPracticeFeedback((current) => ({
          ...current,
          [questionId]: synchronized.result!,
        }));
      if (synchronized.timeRemainingMs !== undefined)
        anchorPracticeClock(synchronized.timeRemainingMs);
      setPracticeAttempt((current) =>
        current?.attemptId === practiceAttempt.attemptId
          ? {
              ...current,
              responses: {
                ...current.responses,
                [questionId]: practiceAnswerValue(questionId, value),
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
      if (writing) practiceWrites.current.delete(writing);
      if (![...practiceWrites.current.values()].includes(questionId)) {
        setPracticeSyncing((current) => current.filter((id) => id !== questionId));
      }
    }
  }

  async function submitPracticeAttempt() {
    if (!practiceAttempt || practiceAttempt.status !== "in_progress") return;
    setPracticeBusy(true);
    setPracticeError(undefined);
    try {
      // Blurring the answer can start a save during the Submit click. Keep
      // that click and flush the latest answers after earlier saves settle.
      await Promise.allSettled([...practiceWrites.current.keys()]);
      for (const [questionId, value] of Object.entries(answers)) {
        try {
          await saveSpectraQuizPracticeResponse({
            attemptId: practiceAttempt.attemptId,
            questionId,
            response: practiceAnswerValue(questionId, value),
            clientMutationId: crypto.randomUUID(),
          });
        } catch (error) {
          // An expired or already submitted attempt is finalized by the
          // authoritative submit endpoint. Other failures must preserve the
          // draft rather than silently submit older saved answers.
          if (!["QUIZ_ATTEMPT_TIME_ELAPSED", "QUIZ_ATTEMPT_NOT_EDITABLE"].includes(readConvexError(error).code ?? "")) throw error;
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
    if (question.type === "select_all") {
      const actual = [...answerArray(question.id)].sort();
      const expected = [...(question.correctAnswers ?? [])].sort();
      return (
        actual.length === expected.length &&
        actual.every((value, index) => value === expected[index])
      );
    }
    if (question.type === "ordering") {
      const actual = answerArray(question.id);
      const expected = question.correctAnswers?.length
        ? question.correctAnswers
        : question.options;
      return (
        actual.length === expected.length &&
        actual.every((value, index) => value === expected[index])
      );
    }
    if (question.type === "matching") {
      const actual = [...answerArray(question.id)].sort();
      const expected = (question.matchingPairs ?? [])
        .map(
          (pair) =>
            `${pair.id}:${(pair.right ?? "").trim().toLocaleLowerCase()}`,
        )
        .sort();
      return (
        actual.length === expected.length &&
        actual.every(
          (value, index) =>
            value.trim().toLocaleLowerCase() === expected[index],
        )
      );
    }
    if (question.type === "numeric") {
      const actual = Number(answers[question.id]);
      const expected = Number(question.correctAnswer);
      return (
        Number.isFinite(actual) &&
        Number.isFinite(expected) &&
        Math.abs(actual - expected) <= (question.numericTolerance ?? 0)
      );
    }
    if (question.type === "fill_blank") {
      const actual = (answers[question.id] ?? "").trim().toLocaleLowerCase();
      return [question.correctAnswer, ...(question.correctAnswers ?? [])]
        .filter(Boolean)
        .some((answer) => answer!.trim().toLocaleLowerCase() === actual);
    }
    if (question.type === "long_response") return false;
    return (
      (answers[question.id] ?? "").trim().toLocaleLowerCase() ===
      (question.correctAnswer ?? "").trim().toLocaleLowerCase()
    );
  }

  function publishQuiz() {
    const issues = validateQuizForPublishing(
      questions as PortableQuizQuestion[],
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
        (question): QuizQuestion => ({
          ...question,
          options: question.options ?? [],
          optionIds: (question.options ?? []).map(
            (_, optionIndex) =>
              `${question.id}:option:${optionIndex + 1}-${crypto.randomUUID()}`,
          ),
          difficulty: question.difficulty ?? "medium",
          points: question.points ?? 1,
          timeLimitSeconds: question.timeLimitSeconds ?? 90,
        }),
      );
      // The quiz as it is now, after the upload and parse: a question added
      // meanwhile (here or by a collaborator) is kept.
      const current = latestQuizRef.current.questions;
      const onlyBlankStarter =
        current.length === 1 &&
        !current[0]?.prompt.trim() &&
        current[0]?.options.every((option) => !option.trim());
      const next = onlyBlankStarter ? imported : [...current, ...imported];
      commit(next);
      setActiveQuestionId(imported[0]?.id ?? next[0]?.id ?? "");
      await completeArtifactImport({
        jobId,
        typeKey: "quiz",
        status: "imported",
        fidelityReport: result.fidelity,
        unsupportedFeatures: result.unsupportedFeatures,
        importedContent: {
          questions: imported,
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
        ...contentHistoryBindings(studio.history),
        activeQuizMode === "build"
          ? {
              id: "preview",
              label: "Preview as learner",
              icon: Eye,
              tab: "Review",
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
          onSelect: () => setView(view === "settings" ? "builder" : "settings"),
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
                onSelect: () =>
                  setQuestionNavigatorOpen((open) => !open),
              },
            ]
          : []),
        // The question list carries Add question on the full surface. A side
        // panel has no list, so the bar offers it instead.
        ...(view === "builder" && !showQuestionRail
          ? [
              {
                id: "add-question",
                label: "Add question",
                icon: Plus,
                priority: "essential" as const,
                keepLabel: true,
                onSelect: addQuestion,
              },
            ]
          : []),
        ...(view === "builder"
          ? [
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
        {
          id: "import",
          label: quizImporting ? "Importing questions…" : "Import questions",
          icon: quizImporting ? Loader2 : Import,
          priority: "advanced",
          disabled: quizImporting,
          onSelect: () => quizImportRef.current?.click(),
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
                  plainTextFromStored(question.prompt) ||
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
      <div className="spectra-editor-body spectra-composer-clearance">
        {/* Publish state is a fact about this quiz, so it is stated rather than
            left to be inferred from which verb the primary happens to show.
            Editing a published quiz withdraws it: attempts are pinned to the
            version they started on, and the next attempt must not snapshot
            questions nobody has re-validated. */}
        {canEditQuiz && !publishIssues.length ? (
          <p
            className="border-b border-[var(--border-subtle)] px-4 py-2 text-micro leading-5 text-[var(--text-secondary)]"
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
              <div className="min-w-0 flex-1 text-micro leading-5 text-[var(--text-secondary)]">
                <strong className="block text-[var(--text-primary)]">
                  {publishIssues.length
                    ? "Resolve these before publishing"
                    : quizImportError
                      ? "Couldn't import"
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
                    <h3 className="font-display text-metric font-semibold text-[var(--text-primary)]">
                      {practiceAttempt
                        ? practiceAttempt.status === "submitted"
                          ? "Your result"
                          : "Your attempt"
                        : "Quiz preview"}
                    </h3>
                    {practiceAttempt?.status === "in_progress" ? (
                      <span className="rounded-chip border border-[color-mix(in_oklab,var(--accent-cyan)_34%,var(--border-default))] px-2 py-0.5 text-micro font-semibold text-[var(--accent-cyan)]">
                        In progress
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-caption text-[var(--text-secondary)]">
                    {practiceAttempt
                      ? practiceAttempt.status === "submitted"
                        ? practiceAttempt.timeElapsed
                          ? "Submitted when the clock ran out. Everything you had answered was kept."
                          : "This result is yours. It is pinned to the version you answered."
                        : "Answers save as you write them. Reconnect before submitting if that is interrupted."
                      : "Preview stays local. Attempt creates a private attempt pinned to this quiz version; preview does not, and does not spend one of yours."}
                  </p>
                  <p className="mt-1 text-micro text-[var(--text-tertiary)]">
                    {describeQuizExperience(
                      practiceExperience ?? quizSettings.experience,
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {submitted ? (
                    <div className="rounded-control bg-[color-mix(in_oklab,var(--success)_9%,var(--bg-primary))] px-3 py-2 text-right text-caption font-semibold text-[var(--success)]">
                      <LifeForm />
                      {practiceAttempt?.status === "submitted"
                        ? `${practiceAttempt.score ?? 0}/${practiceAttempt.maxScore ?? 0} points · ${practiceAttempt.percentage ?? 0}%`
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
                      className={`rounded-control border px-3 py-2 text-right ${
                        practiceSecondsRemaining > 60
                          ? "border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                          : practiceSecondsRemaining > 0
                            ? "border-[color-mix(in_oklab,var(--warning)_40%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_6%,var(--bg-primary))] text-[var(--warning)]"
                            : "border-[color-mix(in_oklab,var(--danger)_40%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_6%,var(--bg-primary))] text-[var(--danger)]"
                      }`}
                      role="timer"
                      aria-live="off"
                    >
                      <strong className="block font-display text-editor tabular-nums">
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
                      className="h-9 shrink-0 whitespace-nowrap rounded-control border border-[var(--border-strong)] bg-[var(--bg-primary)] px-3 text-caption font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                    >
                      {practiceAttempt.status === "submitted"
                        ? "Close result"
                        : "Leave attempt"}
                    </button>
                  ) : canEditQuiz ? (
                    <button
                      type="button"
                      onClick={() => openQuizMode("build")}
                      className="h-9 shrink-0 whitespace-nowrap rounded-control border border-[var(--border-strong)] bg-[var(--bg-primary)] px-3 text-caption font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                    >
                      Back to build
                    </button>
                  ) : null}
                </div>
              </div>
              {practiceAttempt?.instructions || quizSettings.instructions ? (
                <div className="rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3 text-micro leading-5 text-[var(--text-secondary)]">
                  <strong className="mr-1 text-[var(--text-primary)]">
                    Before you begin:
                  </strong>
                  {practiceAttempt?.instructions || quizSettings.instructions}
                </div>
              ) : null}
              {practiceAttempt?.status === "submitted" &&
              !practiceAnswersRevealed ? (
                <div className="rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3 text-micro leading-5 text-[var(--text-secondary)]">
                  <strong className="mr-1 text-[var(--text-primary)]">
                    Answers are not shown yet.
                  </strong>
                  {practiceExperience?.revealAnswers === "after_deadline"
                    ? "They open once this quiz closes."
                    : "This quiz keeps its answer key."}
                </div>
              ) : null}
              {practiceError ? (
                <div className="flex items-start gap-2 rounded-card border border-[color-mix(in_oklab,var(--danger)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_5%,var(--bg-primary))] p-3 text-micro leading-5 text-[var(--danger)]">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{practiceError}</span>
                </div>
              ) : null}
              {submitted && !inspectAttempt ? (
                <div className="space-y-4">
                  <LifeForm />
                  <QuizResultPie
                    correct={attemptScoreCounts.correct}
                    incorrect={attemptScoreCounts.incorrect}
                    pending={attemptScoreCounts.pending}
                  />
                  <button
                    type="button"
                    className="h-9 shrink-0 whitespace-nowrap rounded-control bg-[var(--text-primary)] px-3 text-caption font-medium text-[var(--bg-primary)]"
                    onClick={() => setInspectAttempt(true)}
                  >
                    Inspect answers
                  </button>
                </div>
              ) : (
              <>
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-micro font-semibold text-[var(--text-secondary)]">
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
                    className="h-full rounded-full bg-[var(--text-primary)] transition-[width] duration-[var(--motion-slow)] ease-standard motion-reduce:transition-none"
                    style={{
                      width: `${displayedQuestions.length ? (answeredQuestionCount / displayedQuestions.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                {submitted && inspectAttempt ? (
                <nav
                  aria-label={
                    practiceAttempt ? "Attempt questions" : "Preview questions"
                  }
                  className="mt-2.5 flex flex-wrap gap-1.5"
                >
                  {displayedQuestions.map((question, index) => {
                    const graded = submitted
                      ? practiceAttempt
                        ? (revealedPracticeResultByQuestion.get(question.id)
                            ?.correct ?? null)
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
                          plainTextFromStored(question.prompt) ||
                          `Question ${index + 1}`
                        }
                        onClick={() => setActiveQuestionId(question.id)}
                        className={`h-8 min-w-8 rounded-control border px-1.5 text-caption font-semibold tabular-nums ${
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
                .filter((_, index) => index === activeDisplayedQuestionIndex)
                .map((question) => (
                  <div
                    key={question.id}
                    className={`rounded-control border bg-transparent p-4 ${submitted || revealedPracticeResultByQuestion.has(question.id) ? ((practiceAttempt ? revealedPracticeResultByQuestion.get(question.id)?.correct === null : question.type === "long_response") ? "border-[color-mix(in_oklab,var(--accent-cyan)_28%,var(--border-default))]" : questionCorrect(question) ? "border-[color-mix(in_oklab,var(--success)_48%,var(--border-default))]" : "border-[color-mix(in_oklab,var(--danger)_38%,var(--border-default))]") : "border-[var(--border-default)]"}`}
                  >
                    <LifeVerdict
                      verdict={
                        submitted || revealedPracticeResultByQuestion.has(question.id)
                          ? (practiceAttempt ? revealedPracticeResultByQuestion.get(question.id)?.correct === null : question.type === "long_response")
                            ? "open"
                            : questionCorrect(question)
                              ? "right"
                              : "wrong"
                          : null
                      }
                    />
                    <div className="flex items-center gap-2 text-caption font-semibold text-[var(--text-secondary)]">
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
                    <SpectraStoredText
                      value={question.prompt}
                      fallback="Untitled question"
                      className="mt-2 text-subhead font-medium"
                    />
                    {question.media ? (
                      quizAssetMap.get(question.media.assetId)?.downloadUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={
                            quizAssetMap.get(question.media.assetId)!
                              .downloadUrl!
                          }
                          alt={question.media.altText ?? ""}
                          className="mt-3 max-h-[320px] w-full rounded-control border border-[var(--border-default)] object-contain"
                        />
                      ) : (
                        <div className="mt-3 rounded-control border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-micro text-[var(--text-tertiary)]">
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
                            disabled={submitted || practiceBusy}
                            onClick={() =>
                              void synchronizePracticeAnswer(
                                question.id,
                                option,
                              )
                            }
                            key={`${question.id}-${optionIndex}`}
                            className={`flex w-full items-center gap-2 rounded-control border px-3 py-2 text-left text-ui transition ${answers[question.id] === option ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-elevated))] text-[var(--text-primary)]" : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
                          >
                            <Radio className="h-3.5 w-3.5" />
                            <SpectraStoredText
                              inline
                              value={option}
                              fallback={`Option ${optionIndex + 1}`}
                            />
                          </button>
                        ))
                      ) : question.type === "select_all" ? (
                        question.options.map((option, optionIndex) => {
                          const selected = answerArray(question.id).includes(
                            option,
                          );
                          return (
                            <button
                              type="button"
                              disabled={submitted || practiceBusy}
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
                              className={`flex w-full items-center gap-2 rounded-control border px-3 py-2 text-left text-ui ${selected ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-elevated))]" : "border-[var(--border-default)]"}`}
                            >
                              <span
                                className={`flex h-4 w-4 items-center justify-center rounded-chip border ${selected ? "border-[var(--accent-cyan)] bg-[var(--accent-cyan)] text-white" : "border-[var(--border-default)]"}`}
                              >
                                {selected ? (
                                  <Check className="h-3 w-3" />
                                ) : null}
                              </span>
                              <SpectraStoredText
                                inline
                                value={option}
                                fallback={`Option ${optionIndex + 1}`}
                              />
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
                              className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded-control border border-[var(--border-default)] px-3 py-2 text-ui"
                            >
                              <strong>{optionIndex + 1}</strong>
                              <SpectraStoredText
                                inline
                                value={option}
                                fallback={`Option ${optionIndex + 1}`}
                              />
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  disabled={submitted || practiceBusy || optionIndex === 0}
                                  onClick={() => {
                                    const next = [...order];
                                    [next[optionIndex - 1], next[optionIndex]] =
                                      [
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
                                    submitted || practiceBusy ||
                                    optionIndex === order.length - 1
                                  }
                                  onClick={() => {
                                    const next = [...order];
                                    [next[optionIndex], next[optionIndex + 1]] =
                                      [
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
                              .find((value) => value.startsWith(`${pair.id}:`))
                              ?.slice(pair.id.length + 1);
                            const choices =
                              question.matchingChoices ??
                              (question.matchingPairs ?? []).map(
                                (candidate) => candidate.right ?? "",
                              );
                            return (
                              <div
                                key={pair.id}
                                className="grid grid-cols-[minmax(0,1fr)_18px_minmax(0,1fr)] items-center gap-2 rounded-control border border-[var(--border-default)] px-3 py-2"
                              >
                                <span className="text-caption font-medium text-[var(--text-primary)]">
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
                                  disabled={submitted || practiceBusy}
                                  placeholder="Choose a match"
                                  value={selected ?? ""}
                                  onChange={(value) => {
                                    const next = current.filter(
                                      (entry) =>
                                        !entry.startsWith(`${pair.id}:`),
                                    );
                                    if (value) next.push(`${pair.id}:${value}`);
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
                      ) : question.type === "long_response" ? (
                        <textarea
                          disabled={submitted || practiceBusy}
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
                          type={question.type === "numeric" ? "number" : "text"}
                          disabled={submitted || practiceBusy}
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
                      <div className="mt-3 border-t border-[var(--border-subtle)] pt-3 text-micro leading-5 text-[var(--text-secondary)]">
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
                        {(
                          practiceAttempt
                            ? revealedPracticeResultByQuestion.get(question.id)
                                ?.explanation
                            : question.explanation
                        ) ? (
                          <SpectraStoredText
                            className="mt-1"
                            value={
                              (practiceAttempt
                                ? revealedPracticeResultByQuestion.get(
                                    question.id,
                                  )?.explanation
                                : question.explanation) ?? ""
                            }
                          />
                        ) : null}
                        {practiceAttempt &&
                        revealedPracticeResultByQuestion.get(question.id)
                          ?.advisoryFeedback ? (
                          <div className="mt-1 rounded-chip bg-[var(--bg-secondary)] px-2 py-1.5 text-[var(--text-secondary)]">
                            {
                              revealedPracticeResultByQuestion.get(question.id)
                                ?.advisoryFeedback
                            }
                          </div>
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
                      plainTextFromStored(question.prompt) ||
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
                  Object.entries(answers).some(([questionId, value]) => {
                    const current = practiceAnswerValue(questionId, value);
                    const saved = practiceAttempt.responses[questionId] ?? "";
                    return JSON.stringify(current) !== JSON.stringify(saved);
                  }) ? (
                    <span className="ml-auto text-micro text-[var(--warning)]">
                      Not saved yet
                    </span>
                  ) : (
                    <span className="ml-auto inline-flex items-center gap-2 text-micro text-[var(--success)]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Current answers synchronized
                    </span>
                  )
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
                        (Boolean(practiceAttempt) && !canSubmitQuiz)
                      }
                      className="h-9 shrink-0 whitespace-nowrap rounded-control bg-[var(--text-primary)] px-3 text-caption font-medium text-[var(--bg-primary)] disabled:opacity-45"
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
            style={{ gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}
          >
            <div style={{ gridColumn: "1 / -1" }}>
              <QuizExperienceSection
                experience={quizSettings.experience}
                onChange={commitExperience}
                readOnly={!canEditQuiz}
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }} data-anchor-region={QUIZ_INSTRUCTIONS_REGION}>
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
            <button
              type="button"
              onClick={() =>
                commitSettings({
                  shuffleQuestions: !quizSettings.shuffleQuestions,
                })
              }
              className="flex items-center justify-between rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-left"
            >
              <span>
                <span className="block text-ui font-semibold text-[var(--text-primary)]">
                  Shuffle questions
                </span>
                <span className="mt-1 block text-micro text-[var(--text-secondary)]">
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
                  shuffleOptions: !quizSettings.shuffleOptions,
                })
              }
              className="flex items-center justify-between rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-left"
            >
              <span>
                <span className="block text-ui font-semibold text-[var(--text-primary)]">
                  Shuffle answer options
                </span>
                <span className="mt-1 block text-micro text-[var(--text-secondary)]">
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
              className="flex items-center justify-between rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-left"
            >
              <span>
                <span className="block text-ui font-semibold text-[var(--text-primary)]">
                  Resume interrupted practice
                </span>
                <span className="mt-1 block text-micro text-[var(--text-secondary)]">
                  Keep synchronized in-progress attempts available after
                  navigation or reconnect.
                </span>
              </span>
              <CheckCircle2
                className={`h-5 w-5 ${quizSettings.allowResume ? "text-[var(--success)]" : "text-[var(--text-tertiary)]"}`}
              />
            </button>
            <Field label="Printed sheet time allowance">
              <div className="rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
                <SelectField
                  ariaLabel="Printed sheet time allowance"
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
                  Scales the suggested duration printed on the paper sheet. The
                  on-screen countdown is set by Time above and is held by the
                  server, so it is not changed here. Learner reduced-motion and
                  text-size preferences are always respected independently.
                </p>
              </div>
            </Field>
            <Field label="Personal practice target">
              <div className="rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
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
                <div className="mt-2 text-right font-display text-heading font-semibold text-[var(--text-primary)]">
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
              <h3 className="font-display text-metric font-semibold text-[var(--text-primary)]">
                Responses
              </h3>
              <p className="mt-1 max-w-[540px] text-micro leading-5 text-[var(--text-secondary)]">
                How the group did, question by question. Nobody is named and no
                individual response is shown here.
              </p>
            </div>
            {responseSummaryError ? (
              <div className="flex items-start gap-2 rounded-card border border-[color-mix(in_oklab,var(--danger)_35%,var(--border-default))] p-3 text-micro text-[var(--danger)]">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {responseSummaryError}
              </div>
            ) : !responseSummary ? (
              <div className="flex min-h-[180px] items-center justify-center gap-2 text-micro text-[var(--text-tertiary)]">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading responses
              </div>
            ) : !responseSummary.available ? (
              <div data-spectra-card="result" className="p-6 text-center">
                <h3 className="font-display text-heading font-semibold text-[var(--text-primary)]">
                  Nothing to report
                </h3>
                <p className="mx-auto mt-2 max-w-[440px] text-caption leading-5 text-[var(--text-secondary)]">
                  {responseSummary.reason}
                </p>
                <button
                  type="button"
                  onClick={() => setView("settings")}
                  className="mt-4 rounded-control bg-[var(--text-primary)] px-3 py-2 text-micro font-medium text-[var(--bg-primary)]"
                >
                  Open quiz settings
                </button>
              </div>
            ) : !responseSummary.submittedCount ? (
              <div data-spectra-card="result" className="p-6 text-center">
                <h3 className="font-display text-heading font-semibold text-[var(--text-primary)]">
                  No submissions yet
                </h3>
                <p className="mx-auto mt-2 max-w-[440px] text-caption leading-5 text-[var(--text-secondary)]">
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
                    ] as const
                  ).map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5"
                    >
                      <strong className="block font-display text-heading tabular-nums text-[var(--text-primary)]">
                        {value}
                      </strong>
                      <span className="text-micro text-[var(--text-tertiary)]">
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  {responseSummary.questions.map((entry, index) => {
                    const share = entry.answered
                      ? Math.round((entry.correct / entry.answered) * 100)
                      : 0;
                    return (
                      <div
                        key={entry.questionId}
                        className="rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)] p-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <p className="min-w-0 text-caption leading-5 text-[var(--text-primary)]">
                            <span className="mr-2 text-micro tabular-nums text-[var(--text-tertiary)]">
                              {index + 1}
                            </span>
                            {entry.prompt}
                          </p>
                          <strong className="shrink-0 font-display text-editor tabular-nums text-[var(--text-primary)]">
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
                                    ? "var(--accent-gold)"
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
                                className="rounded-chip border border-[var(--border-default)] px-2 py-0.5 text-micro text-[var(--text-secondary)]"
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
                <h3 className="font-display text-metric font-semibold text-[var(--text-primary)]">
                  Your results
                </h3>
                <p className="mt-1 max-w-[520px] text-micro leading-5 text-[var(--text-secondary)]">
                  Every attempt you have made on this quiz, newest first. Only
                  you can open them. Authors and collaborators see the group,
                  not your answers.
                </p>
              </div>
              <button
                type="button"
                disabled={!published || practiceBusy || !canAttemptQuiz}
                onClick={() => void beginPractice()}
                className="rounded-control bg-[var(--text-primary)] px-3 py-2 text-micro font-semibold text-[var(--bg-primary)] disabled:opacity-45"
              >
                New private attempt
              </button>
            </div>
            {practiceError ? (
              <div className="mb-3 flex items-start gap-2 rounded-card border border-[color-mix(in_oklab,var(--danger)_35%,var(--border-default))] p-3 text-micro text-[var(--danger)]">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {practiceError}
              </div>
            ) : null}
            {practiceLoading ? (
              <div className="flex min-h-[180px] items-center justify-center gap-2 text-micro text-[var(--text-tertiary)]">
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
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-left transition hover:border-[color-mix(in_oklab,var(--accent-cyan)_35%,var(--border-default))] hover:bg-[var(--bg-hover)]"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <strong className="text-caption text-[var(--text-primary)]">
                          Practice {practiceAttempts.length - index}
                        </strong>
                        <span
                          className={`rounded-chip px-2 py-0.5 text-micro font-semibold  ${attempt.status === "submitted" ? "bg-[color-mix(in_oklab,var(--success)_10%,var(--bg-primary))] text-[var(--success)]" : "bg-[color-mix(in_oklab,var(--warning)_10%,var(--bg-primary))] text-[var(--warning)]"}`}
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
                      <strong className="block font-display text-heading text-[var(--text-primary)]">
                        {attempt.status === "submitted"
                          ? `${attempt.percentage ?? 0}%`
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
                <h3 className="mt-3 font-display text-metric font-semibold text-[var(--text-primary)]">
                  No private attempts yet
                </h3>
                <p className="mx-auto mt-2 max-w-[440px] text-caption leading-5 text-[var(--text-secondary)]">
                  Preview lets authors inspect the experience. A private
                  practice run creates your own version-pinned learning record.
                </p>
                <button
                  type="button"
                  onClick={() => setView("preview")}
                  className="mt-4 rounded-control bg-[var(--text-primary)] px-3 py-2 text-micro font-medium text-[var(--bg-primary)]"
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
                    plainTextFromStored(question.prompt) ||
                    "Untitled question",
                  subtitle: `${QUIZ_TYPE_LABELS[question.type]} · ${question.points ?? 1} point${(question.points ?? 1) === 1 ? "" : "s"}`,
                  active: activeQuestion?.id === question.id,
                  preview: <QuestionThumbnail question={question} />,
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
              className="min-w-0 flex-1 overflow-auto pb-10"
            >
              {activeQuestion ? (
                <QuestionSheet
                  key={activeQuestion.id}
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
                  image={{
                    url: activeQuestion.media
                      ? (quizAssetMap.get(activeQuestion.media.assetId)?.downloadUrl ?? undefined)
                      : undefined,
                    uploading: uploadingQuizMedia,
                    error: quizMediaError,
                    upload: (file) => void uploadQuestionMedia(file),
                    remove: () => removeQuestionMedia(activeQuestion.id),
                  }}
                  detailsOpen={questionDetailsOpen}
                  onDetailsOpenChange={setQuestionDetailsOpen}
                  onChange={(patch) => updateQuestion(activeQuestion.id, patch)}
                  onRemove={() => removeQuestion(activeQuestion.id)}
                  onDuplicate={() => {
                    const questionId = id("question");
                    const duplicate: QuizQuestion = {
                      ...structuredClone(activeQuestion),
                      id: questionId,
                      optionIds: activeQuestion.options.map(
                        (_, optionIndex) =>
                          `${questionId}:option:${optionIndex + 1}`,
                      ),
                    };
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
                <SpectraStoredText
                  value={question.prompt}
                  fallback="Untitled question"
                  className="spectra-quiz-print-prompt"
                />
                {question.options.length ? (
                  <ul>
                    {question.options.map((option, index) => (
                      <li key={`${question.id}-print-${index}`}>
                        {String.fromCharCode(65 + index)}.{" "}
                        <SpectraStoredText inline value={option} fallback="(blank)" />
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
                      <SpectraStoredText value={question.explanation} />
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

