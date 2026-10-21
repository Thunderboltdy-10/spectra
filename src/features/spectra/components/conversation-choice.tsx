"use client";

import { buttonVariants } from "@/components/ui/button";
import { useId, useState } from "react";
import { toast } from "@/components/ui/toast";
import type {
  ConversationBatchSelection,
  ConversationChoice,
} from "./conversation-surface";

/* Clarifications are part of the conversation, not a modal: the student can
   pick an option, skip, or type any answer in the composer and the same run
   continues. A failed save always says so; the choice is released so it can
   be tried again. */
const TYPED_ANSWER_HINT = "Or type your own answer in the message box.";

function saveFailure(error: unknown, fallback: string) {
  // postSpectra throws the route's public sentence (codes stripped) or its
  // own connection sentence, so the message is already safe to show.
  toast.error(error instanceof Error && error.message ? error.message : fallback);
}

export function ChoiceBlock({
  question,
  options,
  selectedTitle,
  onChoose,
  onSkip,
}: {
  question: string;
  options: ConversationChoice[];
  selectedTitle?: string | null;
  onChoose?: (
    choice: ConversationChoice,
    index: number,
  ) => Promise<void> | void;
  onSkip?: () => Promise<void> | void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const hintId = useId();
  const selected = selectedTitle ?? pending;
  if (selectedTitle)
    return (
      <section
        className="mt-4 border-l-2 border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] py-1 pl-3"
        data-conversation-action="choice-answered"
        aria-label="Answered question"
      >
        <div className="text-caption font-semibold text-[var(--text-primary)]">
          {question}
        </div>
        <p className="mt-1 text-micro text-[var(--text-secondary)]">
          {selectedTitle === "Skipped"
            ? "Skipped"
            : `Answered: ${selectedTitle}`}
        </p>
      </section>
    );
  return (
    <section
      className="mt-4 overflow-hidden rounded-card border border-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_4%,var(--bg-elevated))] p-3"
      data-conversation-action="choice"
      aria-label="Choose one response"
      aria-describedby={hintId}
    >
      <div className="mb-2 text-caption font-semibold text-[var(--text-primary)]">
        {question}
      </div>
      <div
        className={`grid gap-2 ${options.length === 2 ? "sm:grid-cols-2" : "grid-cols-1"}`}
      >
        {options.map((option, index) => (
          <button
            key={`${option.title}:${index}`}
            type="button"
            disabled={Boolean(selected)}
            aria-pressed={selected === option.title}
            onClick={() => {
              setPending(option.title);
              Promise.resolve(onChoose?.(option, index)).catch((error) => {
                setPending(null);
                saveFailure(error, "Could not save that choice. Try again.");
              });
            }}
            className={`group min-h-11 rounded-card border px-3 py-2.5 text-left transition motion-reduce:transition-none ${selected === option.title ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-primary))]" : "border-[var(--border-default)] bg-[var(--bg-primary)] hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 hover:border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] hover:shadow-[0_5px_18px_rgba(27,20,12,0.06)] disabled:opacity-55"}`}
          >
            <span className="block text-caption font-semibold text-[var(--text-primary)]">
              {option.title}
            </span>
            {option.description ? (
              <span className="mt-1 block text-micro leading-4 text-[var(--text-secondary)]">
                {option.description}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p id={hintId} className="text-micro text-[var(--text-tertiary)]">
          {TYPED_ANSWER_HINT}
        </p>
        {onSkip ? (
          <button
            type="button"
            disabled={Boolean(selected)}
            onClick={() => {
              setPending("Skipped");
              Promise.resolve(onSkip()).catch((error) => {
                setPending(null);
                saveFailure(error, "Could not skip this question. Try again.");
              });
            }}
            className="h-7 rounded-chip px-2 text-micro font-semibold text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] disabled:opacity-45"
          >
            Skip for now
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function BatchedChoiceBlock({
  questions,
  selectedTitle,
  onSubmit,
}: {
  questions: Array<{
    id: string;
    question: string;
    options: ConversationChoice[];
  }>;
  selectedTitle?: string | null;
  onSubmit: (answer: string, selections: ConversationBatchSelection[]) => Promise<void> | void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const hintId = useId();
  if (selectedTitle)
    return (
      <section
        className="mt-4 border-l-2 border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] py-1 pl-3"
        data-conversation-action="choice-batch-answered"
        aria-label="Answered questions"
      >
        <p className="text-caption font-semibold text-[var(--text-primary)]">
          {questions.length} questions asked
        </p>
        <p className="mt-1 text-micro text-[var(--text-secondary)]">
          {selectedTitle}
        </p>
      </section>
    );
  const remaining = questions.filter((question) => !answers[question.id]).length;
  const complete = remaining === 0;
  return (
    <section
      className="mt-4 rounded-card border border-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_4%,var(--bg-elevated))] p-3"
      aria-label="Answer multiple questions"
    >
      <p className="mb-2 text-caption font-bold text-[var(--text-primary)]">
        A few quick questions
      </p>
      <div className="max-h-72 space-y-3 overflow-y-auto pr-1 [scrollbar-width:thin]">
        {questions.map((question, index) => (
          <fieldset key={question.id}>
            <legend className="text-micro font-semibold leading-4 text-[var(--text-primary)]">
              {index + 1}. {question.question}
            </legend>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {question.options.map((option) => (
                <button
                  key={option.key ?? option.title}
                  type="button"
                  aria-pressed={answers[question.id] === option.key}
                  onClick={() =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: option.key ?? "",
                    }))
                  }
                  className={`rounded-chip border px-2 py-1.5 text-left text-micro font-semibold ${answers[question.id] === option.key ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_9%,var(--bg-primary))]" : "border-[var(--border-default)] bg-[var(--bg-primary)] hover:border-[var(--accent-cyan)]"}`}
                >
                  {option.title}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={answers[question.id] === "skip"}
                onClick={() =>
                  setAnswers((current) => ({
                    ...current,
                    [question.id]: "skip",
                  }))
                }
                className="rounded-chip px-2 py-1.5 text-left text-micro text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
              >
                Skip this question
              </button>
            </div>
          </fieldset>
        ))}
      </div>
      <p id={hintId} className="mt-3 text-micro text-[var(--text-tertiary)]">
        {complete
          ? TYPED_ANSWER_HINT
          : `Answer or skip ${remaining === 1 ? "the last question" : `the ${remaining} remaining questions`} to continue. ${TYPED_ANSWER_HINT}`}
      </p>
      <button
        type="button"
        disabled={!complete || pending}
        aria-describedby={hintId}
        onClick={() => {
          const selections = questions.map((question) => {
            const choiceKey = answers[question.id] ?? "skip";
            const choice = question.options.find((option) => option.key === choiceKey);
            return {
              questionId: question.id,
              choiceKey,
              choiceTitle: choice?.title ?? "Skipped",
            };
          });
          const answer = selections
            .map((selection, index) => `${index + 1}) ${selection.choiceTitle}`)
            .join("; ");
          setPending(true);
          void Promise.resolve(onSubmit(answer, selections)).catch((error) => {
            setPending(false);
            saveFailure(error, "Could not send these answers. Try again.");
          });
        }}
        className={buttonVariants({ variant: "primary", className: "mt-2 w-full" })}
      >
        {pending ? "Sending answers…" : "Continue with these answers"}
      </button>
    </section>
  );
}
