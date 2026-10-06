"use client";

import { ChevronLeft, ChevronUp, Loader2, Check, ChevronDown, ChevronRight } from "@/components/icons/glyph-icons";
import { useMemo, useState } from "react";
import { SelectField } from "@/components/ui/select";
import { embedCapabilityEnabled } from "../capabilities";
import {
  saveSpectraQuizPracticeResponse,
  startSpectraQuizPractice,
  submitSpectraQuizPractice,
  type SpectraArtifactEmbed,
  type SpectraQuizPracticeAttempt,
  type SpectraQuizPracticeQuestion,
} from "../data/api";
import { plainTextFromStored } from "../rich-content";
import { SpectraStoredText } from "./spectra-rich-content";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A stored question, option or match as words, for a label. */
function plainText(value: unknown) {
  return typeof value === "string" ? plainTextFromStored(value).replace(/\s+/g, " ") : "";
}

/** A stored question, option or match as it was written. */
function Stored({ value, fallback, inline = false, className }: { value: unknown; fallback: string; inline?: boolean; className?: string }) {
  return <SpectraStoredText value={typeof value === "string" ? value : ""} fallback={fallback} inline={inline} className={className} />;
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

function answerArray(value: string | string[] | undefined) {
  return Array.isArray(value) ? value : [];
}

function answerText(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
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

  async function saveResponse(questionId: string, response: string | string[]) {
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
      await saveSpectraQuizPracticeResponse({
        attemptId: attempt.attemptId,
        questionId,
        response,
        clientMutationId: crypto.randomUUID(),
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

  function updateLocalResponse(
    questionId: string,
    response: string | string[],
  ) {
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
            <div className="text-caption font-semibold text-[var(--text-primary)]">
              {previews.length}{" "}
              {previews.length === 1 ? "question" : "questions"}
            </div>
            <p className="mt-0.5 text-micro text-[var(--text-tertiary)]">
              {canAnswer ? "Publish to practice" : "Read-only preview"}
            </p>
          </div>
          <span className="rounded-chip border border-[var(--border-default)] px-2 py-1 text-micro font-medium text-[var(--text-secondary)]">
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
            className="rounded-control border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3"
          >
            <Stored value={question.prompt} fallback="Empty question" className="text-caption font-semibold leading-5" />
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
      <div className="flex min-h-24 items-center justify-between gap-4 rounded-control border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3.5">
        <div>
          <p className="text-caption font-semibold text-[var(--text-primary)]">
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
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control bg-[var(--text-primary)] px-3 text-micro font-semibold text-[var(--bg-primary)] disabled:opacity-45"
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
      <div className="rounded-control border border-[color-mix(in_oklab,var(--success)_32%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_5%,var(--bg-primary))] p-4">
        <p className="text-caption font-semibold text-[var(--text-primary)]">
          Practice submitted
        </p>
        <p className="mt-1 text-body font-semibold text-[var(--success)]">
          {attempt.score ?? 0} / {attempt.maxScore ?? 0}
          {typeof attempt.percentage === "number"
            ? ` (${Math.round(attempt.percentage)}%)`
            : ""}
        </p>
      </div>
    );
  }

  const question =
    attempt.questions[Math.min(activeIndex, attempt.questions.length - 1)];
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
        <Stored value={question.prompt} fallback="Empty question" className="min-w-0 text-ui font-semibold leading-5" />
        <span className="shrink-0 text-micro text-[var(--text-tertiary)]">
          {activeIndex + 1} / {attempt.questions.length}
        </span>
      </div>
      <QuestionResponse
        question={question}
        response={response}
        disabled={busy !== null}
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
            className="flex h-8 w-8 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30"
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
            className="flex h-8 w-8 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit || busy !== null}
          className="inline-flex h-8 items-center gap-1.5 rounded-control bg-[var(--text-primary)] px-3 text-micro font-semibold text-[var(--bg-primary)] disabled:opacity-45"
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
  disabled,
  onChange,
  onCommit,
}: {
  question: SpectraQuizPracticeQuestion;
  response: string | string[] | undefined;
  disabled: boolean;
  onChange: (response: string | string[]) => void;
  onCommit: (response: string | string[]) => void;
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
              className={`flex w-full items-center gap-2 rounded-control border px-3 py-2 text-left text-micro disabled:opacity-55 ${active ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-primary))]" : "border-[var(--border-subtle)]"}`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-chip border ${active ? "border-[var(--accent-cyan)] bg-[var(--accent-cyan)] text-white" : "border-[var(--border-default)]"}`}
              >
                {active ? <Check className="h-3 w-3" /> : null}
              </span>
              <Stored inline value={option} fallback="Empty option" />
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
            className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-control border border-[var(--border-subtle)] px-3 py-2 text-micro"
          >
            <span className="font-semibold text-[var(--text-tertiary)]">
              {index + 1}
            </span>
            <Stored inline value={option} fallback="Empty option" />
            <span className="flex items-center gap-1">
              <button
                type="button"
                aria-label={`Move ${plainText(option)} earlier`}
                disabled={disabled || index === 0}
                onClick={() => {
                  const next = [...order];
                  [next[index - 1], next[index]] = [
                    next[index]!,
                    next[index - 1]!,
                  ];
                  onCommit(next);
                }}
                className="rounded-chip p-1 disabled:opacity-25"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Move ${plainText(option)} later`}
                disabled={disabled || index === order.length - 1}
                onClick={() => {
                  const next = [...order];
                  [next[index], next[index + 1]] = [
                    next[index + 1]!,
                    next[index]!,
                  ];
                  onCommit(next);
                }}
                className="rounded-chip p-1 disabled:opacity-25"
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
              <span className="text-micro font-medium text-[var(--text-primary)]">
                <Stored inline value={pair.left} fallback="Untitled prompt" />
              </span>
              <SelectField
                ariaLabel={`Match for ${plainText(pair.left) || "untitled prompt"}`}
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
                  label: plainText(choice) || "Empty match",
                }))}
              />
            </div>
          );
        })}
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
              className={`flex w-full items-center gap-2 rounded-control border px-3 py-2 text-left text-micro disabled:opacity-55 ${active ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-primary))]" : "border-[var(--border-subtle)]"}`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-micro">
                {String.fromCharCode(65 + index)}
              </span>
              <Stored inline value={option} fallback="Empty option" />
            </button>
          );
        })}
      </div>
    );
  }
  const long = question.type === "long_response";
  const className =
    "mt-3 w-full rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-caption text-[var(--text-primary)] outline-none focus:border-[var(--accent-cyan)] disabled:opacity-55";
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
