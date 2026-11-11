"use client";

import { ChevronLeft, ChevronUp, Loader2, Check, ChevronDown, ChevronRight } from "@/components/icons/glyph-icons";
import { useMemo, useRef, useState } from "react";
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

/** A stored question as the learner may see it, before a practice attempt exists. */
function practiceQuestion(question: Record<string, unknown>, index: number): SpectraQuizPracticeQuestion {
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);
  return {
    id: typeof question.id === "string" ? question.id : `q${index}`,
    prompt: typeof question.prompt === "string" ? question.prompt : "",
    type: (typeof question.type === "string" ? question.type : "short_answer") as SpectraQuizPracticeQuestion["type"],
    options: strings(question.options),
    matchingPairs: Array.isArray(question.matchingPairs)
      ? question.matchingPairs.map(record).map((pair, at) => ({ id: String(pair.id ?? at), left: String(pair.left ?? "") }))
      : undefined,
    matchingChoices: strings(question.matchingChoices),
    points: typeof question.points === "number" ? question.points : 1,
  };
}

/*
 * An embedded quiz is its questions, one at a time, answered where they sit.
 * Answers are a private practice attempt (never in the quiz itself) that the full
 * quiz carries on from, and they are checked at the end. Your own quiz can be
 * practised before it's published; someone else's draft can only be read.
 */
export function ArtifactEmbedQuiz({ embed }: { embed: SpectraArtifactEmbed }) {
  const interaction = embed.effectiveInteraction ?? embed.interaction;
  const published = embeddedQuizIsPublished(embed);
  const canPractice = (published || Boolean(embed.canEditSource)) && embedCapabilityEnabled("quiz", interaction, "attempt.answer");
  const previews = useMemo(() => previewQuestions(embed).map(practiceQuestion), [embed]);
  const [attempt, setAttempt] = useState<SpectraQuizPracticeAttempt | null>(null);
  const [responses, setResponses] = useState<Record<string, string | string[]>>({});
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Two quick answers share one attempt, however long the first takes to start.
  const starting = useRef<Promise<SpectraQuizPracticeAttempt> | null>(null);
  const questions = attempt?.questions ?? previews;

  if (!questions.length) return <p className="work-embed-empty">No questions yet</p>;

  if (attempt?.status === "submitted")
    return (
      <div className="work-embed-stage work-embed-quiz-result">
        <strong>
          {attempt.score ?? 0} of {attempt.maxScore ?? 0}
        </strong>
        <span>{typeof attempt.percentage === "number" ? `${Math.round(attempt.percentage)}% right` : "Checked"}</span>
        <button
          type="button"
          className="work-embed-quiz-check"
          onClick={() => {
            starting.current = null;
            setAttempt(null);
            setResponses({});
            setIndex(0);
          }}
        >
          Try again
        </button>
      </div>
    );

  async function practiceAttempt() {
    if (attempt) return attempt;
    starting.current ??= startSpectraQuizPractice({
      artifactId: embed.source!.artifactId,
      clientAttemptId: crypto.randomUUID(),
      ...(published ? {} : { ownDraft: true }),
    }).catch((reason) => {
      starting.current = null;
      throw reason;
    });
    const started = await starting.current;
    setAttempt(started);
    return started;
  }

  async function answer(questionId: string, response: string | string[]) {
    setResponses((current) => ({ ...current, [questionId]: response }));
    if (!canPractice || !embed.source) return;
    setBusy("save");
    setError(null);
    try {
      const current = await practiceAttempt();
      await saveSpectraQuizPracticeResponse({
        attemptId: current.attemptId,
        questionId,
        response,
        clientMutationId: crypto.randomUUID(),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That answer could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  async function check() {
    if (!canPractice || busy) return;
    setBusy("submit");
    setError(null);
    try {
      const current = await practiceAttempt();
      setAttempt(
        await submitSpectraQuizPractice({ attemptId: current.attemptId, clientSubmissionId: crypto.randomUUID() }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The answers could not be checked.");
    } finally {
      setBusy(null);
    }
  }

  const at = Math.min(index, questions.length - 1);
  const question = questions[at]!;
  const last = at === questions.length - 1;
  return (
    <div className="work-embed-stage">
      <div className="work-embed-question">
        <span key={question.id} className="work-embed-turn">
          <Stored value={question.prompt} fallback="Empty question" className="work-embed-question-prompt" />
          <QuestionResponse
            question={question}
            response={responses[question.id]}
            disabled={busy === "submit"}
            onChange={(value) => setResponses((current) => ({ ...current, [question.id]: value }))}
            onCommit={(value) => void answer(question.id, value)}
          />
        </span>
        {error ? <p className="work-embed-quiz-error">{error}</p> : null}
      </div>
      <div className="work-embed-stepper">
        <button type="button" onClick={() => setIndex(Math.max(0, at - 1))} disabled={at === 0} aria-label="Previous question">
          <ChevronLeft className="size-4" />
        </button>
        <span aria-live="polite">
          Question {at + 1} of {questions.length}
        </span>
        <button type="button" onClick={() => setIndex(Math.min(questions.length - 1, at + 1))} disabled={last} aria-label="Next question">
          <ChevronRight className="size-4" />
        </button>
        {canPractice && (last || Object.keys(responses).length > 0) ? (
          <button type="button" className="work-embed-quiz-check" onClick={() => void check()} disabled={busy !== null}>
            {busy === "submit" ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : null}
            Check answers
          </button>
        ) : null}
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
      <div className="work-embed-choices">
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
              className="work-embed-choice"
              data-active={active || undefined}
              data-many=""
            >
              <span className="work-embed-choice-mark">
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
      <div className="work-embed-choices">
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
      <div className="work-embed-choices">
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
      <div className="work-embed-choices">
        {options.map((option, index) => {
          const active = response === option;
          return (
            <button
              key={`${option}:${index}`}
              type="button"
              disabled={disabled}
              onClick={() => onCommit(option)}
              className="work-embed-choice"
              data-active={active || undefined}
            >
              <span className="work-embed-choice-mark">
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
  const className = "work-embed-answer";
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
