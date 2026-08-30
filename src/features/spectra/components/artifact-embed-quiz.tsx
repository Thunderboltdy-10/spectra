"use client";

import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Loader2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SelectField } from "@/components/ui/select";
import { embedCapabilityEnabled } from "../capabilities";
import {
  getArtifactAssets,
  saveSpectraQuizPracticeResponse,
  startSpectraQuizPractice,
  submitSpectraQuizPractice,
  visitSpectraQuizPracticeQuestion,
  type SpectraArtifactEmbed,
  type SpectraArtifactAsset,
  type SpectraQuizPracticeAttempt,
  type SpectraQuizPracticeQuestion,
} from "../data/api";
import type { QuizResponse } from "../quiz/model";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function richText(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:script|style)[\s\S]*?<\/(?:script|style)>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function previewQuestions(embed: SpectraArtifactEmbed) {
  const snapshot = record(embed.source?.snapshot);
  const content = record(snapshot.content);
  return Array.isArray(content.questions) ? content.questions.map(record) : [];
}

export function embeddedQuizIsPublished(embed: SpectraArtifactEmbed) {
  const snapshot = record(embed.source?.snapshot);
  return record(snapshot.content).published === true;
}

function answerArray(value: QuizResponse | undefined) {
  return Array.isArray(value) ? value : [];
}

function answerText(value: QuizResponse | undefined) {
  return typeof value === "string" ? value : "";
}

function responseRecord(value: QuizResponse | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

export function ArtifactEmbedQuiz({ embed }: { embed: SpectraArtifactEmbed }) {
  const interaction = embed.effectiveInteraction ?? embed.interaction;
  const canAnswer = embedCapabilityEnabled(
    "quiz",
    interaction,
    "attempt.answer",
  );
  const canNavigate = embedCapabilityEnabled(
    "quiz",
    interaction,
    "attempt.navigate",
  );
  const canSubmit = embedCapabilityEnabled(
    "quiz",
    interaction,
    "attempt.submit",
  );
  const published = embeddedQuizIsPublished(embed);
  const previews = useMemo(() => previewQuestions(embed), [embed]);
  const [attempt, setAttempt] = useState<SpectraQuizPracticeAttempt | null>(
    null,
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState<"start" | "save" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [questionClock, setQuestionClock] = useState<{
    questionId: string;
    remainingMs: number;
    at: number;
  }>();
  const [practiceMediaAssets, setPracticeMediaAssets] = useState<
    SpectraArtifactAsset[]
  >([]);
  const activeQuestion =
    attempt?.questions[
      Math.min(activeIndex, Math.max(0, attempt.questions.length - 1))
    ];
  const attemptId = attempt?.attemptId;
  const attemptStatus = attempt?.status;
  const activeQuestionId = activeQuestion?.id;
  const questionSecondsRemaining =
    questionClock && questionClock.questionId === activeQuestion?.id
      ? Math.max(
          0,
          Math.ceil(
            (questionClock.remainingMs -
              Math.max(0, clockNow - questionClock.at)) /
              1_000,
          ),
        )
      : null;

  useEffect(() => {
    const artifactId = embed.source?.artifactId;
    const assetIds = [
      ...new Set(
        (attempt?.questions ?? []).flatMap((question) =>
          question.media?.assetId ? [question.media.assetId] : [],
        ),
      ),
    ];
    if (!artifactId || !assetIds.length) {
      setPracticeMediaAssets([]);
      return;
    }
    let active = true;
    void getArtifactAssets(artifactId, assetIds)
      .then((result) => {
        if (active) setPracticeMediaAssets(result.assets);
      })
      .catch(() => {
        if (active) setPracticeMediaAssets([]);
      });
    return () => {
      active = false;
    };
  }, [attempt?.questions, embed.source?.artifactId]);

  useEffect(() => {
    if (attempt?.status !== "in_progress" || !questionClock) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [attempt?.status, questionClock]);

  useEffect(() => {
    if (!attemptId || attemptStatus !== "in_progress" || !activeQuestionId)
      return;
    let active = true;
    void visitSpectraQuizPracticeQuestion({
      attemptId,
      questionId: activeQuestionId,
    })
      .then((timing) => {
        if (!active) return;
        setAttempt((current) =>
          current
            ? {
                ...current,
                questionTiming: {
                  ...(current.questionTiming ?? {}),
                  [activeQuestionId]: {
                    startedAt: timing.startedAt,
                    remainingMs: timing.questionTimeRemainingMs,
                  },
                },
              }
            : current,
        );
        if (typeof timing.questionTimeRemainingMs === "number")
          setQuestionClock({
            questionId: activeQuestionId,
            remainingMs: timing.questionTimeRemainingMs,
            at: Date.now(),
          });
      })
      .catch((reason: unknown) => {
        if (active) {
          if (
            reason instanceof Error &&
            reason.message.includes("QUIZ_QUESTION_TIME_ELAPSED")
          )
            setQuestionClock({
              questionId: activeQuestionId,
              remainingMs: 0,
              at: Date.now(),
            });
          setError(
            reason instanceof Error
              ? reason.message
              : "This question’s timer could not be synchronized.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [activeQuestionId, attemptId, attemptStatus]);

  async function start() {
    if (!embed.source || !canAnswer || !published || busy) return;
    setBusy("start");
    setError(null);
    try {
      const next = await startSpectraQuizPractice({
        artifactId: embed.source.artifactId,
        clientAttemptId: crypto.randomUUID(),
      });
      setAttempt(next);
      setActiveIndex(0);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Practice could not be started.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function saveResponse(questionId: string, response: QuizResponse) {
    if (!attempt || attempt.status !== "in_progress" || !canAnswer || busy)
      return;
    const previous = attempt.responses[questionId];
    setAttempt((current) =>
      current
        ? {
            ...current,
            responses: { ...current.responses, [questionId]: response },
          }
        : current,
    );
    setBusy("save");
    setError(null);
    try {
      const synchronized = await saveSpectraQuizPracticeResponse({
        attemptId: attempt.attemptId,
        questionId,
        response,
        clientMutationId: crypto.randomUUID(),
      });
      if (typeof synchronized.questionTimeRemainingMs === "number")
        setQuestionClock({
          questionId,
          remainingMs: synchronized.questionTimeRemainingMs,
          at: Date.now(),
        });
    } catch (reason) {
      setAttempt((current) => {
        if (!current) return current;
        const responses = { ...current.responses };
        if (previous === undefined) delete responses[questionId];
        else responses[questionId] = previous;
        return { ...current, responses };
      });
      setError(
        reason instanceof Error
          ? reason.message
          : "That answer could not be saved.",
      );
    } finally {
      setBusy(null);
    }
  }

  function updateLocalResponse(questionId: string, response: QuizResponse) {
    setAttempt((current) =>
      current
        ? {
            ...current,
            responses: { ...current.responses, [questionId]: response },
          }
        : current,
    );
  }

  async function submit() {
    if (!attempt || attempt.status !== "in_progress" || !canSubmit || busy)
      return;
    setBusy("submit");
    setError(null);
    try {
      for (const [questionId, response] of Object.entries(attempt.responses)) {
        await saveSpectraQuizPracticeResponse({
          attemptId: attempt.attemptId,
          questionId,
          response,
          clientMutationId: crypto.randomUUID(),
        });
      }
      const submitted = await submitSpectraQuizPractice({
        attemptId: attempt.attemptId,
        clientSubmissionId: crypto.randomUUID(),
      });
      setAttempt(submitted);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Practice could not be submitted.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!canAnswer || !published) {
    if (embed.mode === "compact") {
      return (
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[12px] font-semibold text-[var(--text-primary)]">
              {previews.length}{" "}
              {previews.length === 1 ? "question" : "questions"}
            </div>
            <p className="mt-0.5 text-micro text-[var(--text-tertiary)]">
              {canAnswer ? "Publish to practice" : "Read-only preview"}
            </p>
          </div>
          <span className="rounded-[6px] border border-[var(--border-default)] px-2 py-1 text-micro font-medium text-[var(--text-secondary)]">
            {canAnswer ? "Draft" : "Preview"}
          </span>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {previews.slice(0, 6).map((question, index) => (
          <div
            key={String(question.id ?? index)}
            className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3"
          >
            <p className="text-[12px] font-semibold leading-5 text-[var(--text-primary)]">
              {richText(question.prompt) || "Empty question"}
            </p>
          </div>
        ))}
        {previews.length === 0 ? (
          <p className="text-micro text-[var(--text-tertiary)]">
            This quiz has no visible questions yet.
          </p>
        ) : null}
        {canAnswer && !published ? (
          <p className="text-micro text-[var(--text-secondary)]">
            Publish the source quiz to start private practice.
          </p>
        ) : null}
      </div>
    );
  }

  if (!attempt) {
    return (
      <div className="flex min-h-24 items-center justify-between gap-4 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3.5">
        <div>
          <p className="text-[12px] font-semibold text-[var(--text-primary)]">
            Private practice
          </p>
          <p className="mt-1 text-micro leading-4 text-[var(--text-secondary)]">
            Answers are saved to your attempt, not to the source quiz.
          </p>
          {error ? (
            <p className="mt-1 text-micro text-[var(--danger)]">{error}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void start()}
          disabled={busy === "start"}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] bg-[var(--text-primary)] px-3 text-micro font-semibold text-[var(--bg-primary)] disabled:opacity-45"
        >
          {busy === "start" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          ) : null}
          Start practice
        </button>
      </div>
    );
  }

  if (attempt.status === "submitted") {
    return (
      <div className="rounded-[8px] border border-[color-mix(in_oklab,var(--success)_32%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_5%,var(--bg-primary))] p-4">
        <p className="text-[12px] font-semibold text-[var(--text-primary)]">
          Practice submitted
        </p>
        <p className="mt-1 text-[14px] font-semibold text-[var(--success)]">
          {typeof attempt.score === "number" &&
          typeof attempt.maxScore === "number"
            ? `${attempt.score} / ${attempt.maxScore}${typeof attempt.percentage === "number" ? ` (${Math.round(attempt.percentage)}%)` : ""}`
            : "Score hidden by the review policy"}
        </p>
      </div>
    );
  }

  const question = activeQuestion;
  if (!question)
    return (
      <p className="text-micro text-[var(--text-tertiary)]">
        This practice attempt has no questions.
      </p>
    );
  const response = attempt.responses[question.id];
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-semibold leading-5 text-[var(--text-primary)]">
          {richText(question.prompt) || "Empty question"}
        </p>
        <span className="shrink-0 text-right text-micro text-[var(--text-tertiary)]">
          {activeIndex + 1} / {attempt.questions.length}
          {questionSecondsRemaining !== null ? (
            <strong
              role="timer"
              className={`mt-1 block tabular-nums ${questionSecondsRemaining > 30 ? "text-[var(--text-secondary)]" : questionSecondsRemaining > 0 ? "text-[var(--warning)]" : "text-[var(--danger)]"}`}
            >
              {questionSecondsRemaining > 0
                ? `${Math.floor(questionSecondsRemaining / 60)}:${String(questionSecondsRemaining % 60).padStart(2, "0")}`
                : "Time ended"}
            </strong>
          ) : null}
        </span>
      </div>
      <QuestionResponse
        question={question}
        response={response}
        mediaUrl={
          question.media
            ? (practiceMediaAssets.find(
                (asset) => asset.assetId === question.media?.assetId,
              )?.downloadUrl ?? undefined)
            : undefined
        }
        disabled={busy !== null || questionSecondsRemaining === 0}
        onChange={(value) => updateLocalResponse(question.id, value)}
        onCommit={(value) => void saveResponse(question.id, value)}
      />
      {error ? (
        <p className="mt-2 text-micro text-[var(--danger)]">{error}</p>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous question"
            disabled={!canNavigate || activeIndex === 0 || busy !== null}
            onClick={() => setActiveIndex((value) => Math.max(0, value - 1))}
            className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next question"
            disabled={
              !canNavigate ||
              activeIndex >= attempt.questions.length - 1 ||
              busy !== null
            }
            onClick={() =>
              setActiveIndex((value) =>
                Math.min(attempt.questions.length - 1, value + 1),
              )
            }
            className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit || busy !== null}
          className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-[var(--text-primary)] px-3 text-micro font-semibold text-[var(--bg-primary)] disabled:opacity-45"
        >
          {busy === "submit" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          ) : null}
          Submit
        </button>
      </div>
    </div>
  );
}

function QuestionResponse({
  question,
  response,
  mediaUrl,
  disabled,
  onChange,
  onCommit,
}: {
  question: SpectraQuizPracticeQuestion;
  response: QuizResponse | undefined;
  mediaUrl?: string;
  disabled: boolean;
  onChange: (response: QuizResponse) => void;
  onCommit: (response: QuizResponse) => void;
}) {
  const options =
    question.type === "true_false" && question.options.length === 0
      ? ["True", "False"]
      : question.options;
  if (question.type === "select_all") {
    const selected = answerArray(response);
    return (
      <div className="mt-3 space-y-1.5">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() =>
                onCommit(
                  active
                    ? selected.filter((value) => value !== option)
                    : [...selected, option],
                )
              }
              className={`flex w-full items-center gap-2 rounded-[7px] border px-3 py-2 text-left text-[11px] disabled:opacity-55 ${active ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-primary))]" : "border-[var(--border-subtle)]"}`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-[4px] border ${active ? "border-[var(--accent-cyan)] bg-[var(--accent-cyan)] text-white" : "border-[var(--border-default)]"}`}
              >
                {active ? <Check className="h-3 w-3" /> : null}
              </span>
              {richText(option) || "Empty option"}
            </button>
          );
        })}
      </div>
    );
  }
  if (question.type === "ordering") {
    const order = answerArray(response).length
      ? answerArray(response)
      : options;
    return (
      <div className="mt-3 space-y-1.5">
        {order.map((option, index) => (
          <div
            key={`${option}:${index}`}
            className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-[7px] border border-[var(--border-subtle)] px-3 py-2 text-[11px]"
          >
            <span className="font-semibold text-[var(--text-tertiary)]">
              {index + 1}
            </span>
            <span>{richText(option) || "Empty option"}</span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                aria-label={`Move ${option} earlier`}
                disabled={disabled || index === 0}
                onClick={() => {
                  const next = [...order];
                  [next[index - 1], next[index]] = [
                    next[index]!,
                    next[index - 1]!,
                  ];
                  onCommit(next);
                }}
                className="rounded-[5px] p-1 disabled:opacity-25"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Move ${option} later`}
                disabled={disabled || index === order.length - 1}
                onClick={() => {
                  const next = [...order];
                  [next[index], next[index + 1]] = [
                    next[index + 1]!,
                    next[index]!,
                  ];
                  onCommit(next);
                }}
                className="rounded-[5px] p-1 disabled:opacity-25"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (question.type === "matching") {
    const selected = answerArray(response);
    return (
      <div className="mt-3 space-y-1.5">
        {(question.matchingPairs ?? []).map((pair) => {
          const current = selected
            .find((value) => value.startsWith(`${pair.id}:`))
            ?.slice(pair.id.length + 1);
          return (
            <div
              key={pair.id}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2"
            >
              <span className="text-[11px] font-medium text-[var(--text-primary)]">
                {richText(pair.left) || "Untitled prompt"}
              </span>
              <SelectField
                ariaLabel={`Match for ${richText(pair.left) || "untitled prompt"}`}
                size="sm"
                disabled={disabled}
                placeholder="Choose a match"
                value={current ?? ""}
                onChange={(value) => {
                  const next = selected.filter(
                    (entry) => !entry.startsWith(`${pair.id}:`),
                  );
                  if (value) next.push(`${pair.id}:${value}`);
                  onCommit(next);
                }}
                options={(question.matchingChoices ?? []).map((choice) => ({
                  value: choice,
                  label: richText(choice) || "Empty match",
                }))}
              />
            </div>
          );
        })}
      </div>
    );
  }
  if (question.type === "hotspot") {
    const selected = answerArray(response);
    const regions = question.hotspot?.regions ?? [];
    const allowMultiple = question.hotspot?.allowMultiple === true;
    return (
      <div className="mt-3">
        <div
          className="relative aspect-video overflow-hidden rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)]"
          aria-label="Hotspot answer regions"
        >
          {mediaUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaUrl}
              alt={question.media?.altText ?? ""}
              className="absolute inset-0 h-full w-full object-contain"
            />
          ) : question.media ? (
            <span className="absolute inset-0 flex items-center justify-center p-3 text-center text-micro text-[var(--text-tertiary)]">
              Question image unavailable
            </span>
          ) : null}
          {regions.map((region) => {
            const active = selected.includes(region.id);
            return (
              <button
                key={region.id}
                type="button"
                aria-pressed={active}
                aria-label={region.label || "Answer region"}
                disabled={disabled}
                onClick={() => {
                  const next = allowMultiple
                    ? active
                      ? selected.filter((id) => id !== region.id)
                      : [...selected, region.id]
                    : [region.id];
                  onCommit(next);
                }}
                style={{
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${region.width * 100}%`,
                  height: `${region.height * 100}%`,
                }}
                className={`absolute min-h-7 min-w-7 rounded-[5px] border-2 text-micro font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)] ${active ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_22%,transparent)] text-[var(--text-primary)]" : "border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--bg-primary)_72%,transparent)] text-[var(--text-secondary)]"}`}
              >
                {region.label}
              </button>
            );
          })}
        </div>
        {regions.length === 0 ? (
          <p className="mt-2 text-micro text-[var(--text-tertiary)]">
            This question has no answer regions.
          </p>
        ) : null}
      </div>
    );
  }
  if (question.type === "multipart") {
    const responses = responseRecord(response);
    return (
      <div className="mt-3 space-y-3">
        {(question.parts ?? []).map((part, index) => (
          <section
            key={part.id}
            className="rounded-[8px] border border-[var(--border-subtle)] p-3"
          >
            <p className="mb-2 text-[11px] font-semibold text-[var(--text-primary)]">
              Part {index + 1}: {richText(part.prompt) || "Untitled part"}
            </p>
            <QuestionResponse
              question={part}
              response={responses[part.id]}
              disabled={disabled}
              onChange={(next) =>
                onChange({ ...responses, [part.id]: next as string | string[] })
              }
              onCommit={(next) =>
                onCommit({ ...responses, [part.id]: next as string | string[] })
              }
            />
          </section>
        ))}
      </div>
    );
  }
  if (options.length > 0) {
    return (
      <div className="mt-3 space-y-1.5">
        {options.map((option, index) => {
          const active = response === option;
          return (
            <button
              key={`${option}:${index}`}
              type="button"
              disabled={disabled}
              onClick={() => onCommit(option)}
              className={`flex w-full items-center gap-2 rounded-[7px] border px-3 py-2 text-left text-[11px] disabled:opacity-55 ${active ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-primary))]" : "border-[var(--border-subtle)]"}`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-micro">
                {String.fromCharCode(65 + index)}
              </span>
              {richText(option) || "Empty option"}
            </button>
          );
        })}
      </div>
    );
  }
  const long = question.type === "long_response";
  const className =
    "mt-3 w-full rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-cyan)] disabled:opacity-55";
  return long ? (
    <textarea
      rows={4}
      disabled={disabled}
      value={answerText(response)}
      onChange={(event) => onChange(event.target.value)}
      onBlur={(event) => onCommit(event.currentTarget.value)}
      className={className}
      placeholder="Develop your response"
    />
  ) : (
    <input
      type={question.type === "numeric" ? "number" : "text"}
      disabled={disabled}
      value={answerText(response)}
      onChange={(event) => onChange(event.target.value)}
      onBlur={(event) => onCommit(event.currentTarget.value)}
      className={className}
      placeholder="Type your answer"
    />
  );
}
