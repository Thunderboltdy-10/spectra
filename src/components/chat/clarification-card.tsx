"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, MessageSquareQuote } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClarificationBlock } from "@/types";

type ClarificationCardProps = {
  block: ClarificationBlock;
  disabled?: boolean;
  onSubmit?: (payload: { message: string; answers: Answers }) => void;
};

type Answers = Record<string, string | string[] | boolean>;

function initialAnswers(block: ClarificationBlock): Answers {
  const next: Answers = {};
  for (const question of block.questions) {
    if (question.type === "multi_choice") {
      next[question.id] = [];
      continue;
    }
    if (question.type === "confirmation") {
      next[question.id] = false;
      continue;
    }
    next[question.id] = "";
  }
  return next;
}

function formatAnswer(value: string | string[] | boolean) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value.trim();
}

export function ClarificationCard({ block, disabled = false, onSubmit }: ClarificationCardProps) {
  const [answers, setAnswers] = useState<Answers>(() => initialAnswers(block));
  const [submittedAnswers, setSubmittedAnswers] = useState<Answers | null>(null);

  useEffect(() => {
    setAnswers(initialAnswers(block));
    setSubmittedAnswers(null);
  }, [block]);

  const canSubmit = useMemo(() => {
    for (const question of block.questions) {
      const value = answers[question.id];
      if (question.type === "multi_choice") {
        if (!Array.isArray(value) || value.length === 0) return false;
        continue;
      }
      if (question.type === "confirmation") {
        if (typeof value !== "boolean") return false;
        continue;
      }
      if (typeof value !== "string" || value.trim().length === 0) return false;
    }
    return true;
  }, [answers, block.questions]);

  return (
    <section data-spectra-card="result" data-card-state="confirmation" className="p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
        <MessageSquareQuote className="h-3.5 w-3.5" />
        Clarification Needed
      </div>
      <p className="mb-4 text-sm text-[var(--text-primary)]">{block.context}</p>

      <div className="space-y-4">
        {block.questions.map((question, index) => {
          const value = answers[question.id];
          return (
            <div key={question.id} className="space-y-2">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {index + 1}. {question.text}
              </p>

              {(question.type === "free_text") && (
                <textarea
                  value={typeof value === "string" ? value : ""}
                  onChange={(event) => {
                    const next = event.target.value;
                    setAnswers((prev) => ({ ...prev, [question.id]: next }));
                  }}
                  rows={2}
                  className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent-cyan)]"
                  placeholder="Type your answer"
                  disabled={disabled}
                />
              )}

              {(question.type === "single_choice" || question.type === "confirmation") && Array.isArray(question.options) && question.options.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {question.options.map((option) => {
                    const selected = value === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setAnswers((prev) => ({ ...prev, [question.id]: option.id }))}
                        data-spectra-card="side"
                        data-card-state={selected ? "selected" : "normal"}
                        className={`group px-3 py-2 text-left text-sm transition ${
                          selected
                            ? ""
                            : "hover:border-[color-mix(in_oklab,var(--warning)_26%,var(--border-default))]"
                        }`}
                        disabled={disabled}
                      >
                        <p className="flex items-center gap-2 font-medium text-[var(--text-primary)]">
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--card-border-soft)] text-[var(--warning)]">
                            {selected ? <Check className="h-3 w-3" /> : null}
                          </span>
                          {option.label}
                        </p>
                        {option.description ? (
                          <p className="mt-1 text-xs text-[var(--text-secondary)]">{option.description}</p>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {question.type === "single_choice" && (!question.options || question.options.length === 0) ? (
                <input
                  value={typeof value === "string" ? value : ""}
                  onChange={(event) => setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))}
                  className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent-cyan)]"
                  placeholder="Type your choice"
                  disabled={disabled}
                />
              ) : null}

              {question.type === "multi_choice" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {(question.options ?? []).map((option) => {
                    const selectedValues = Array.isArray(value) ? value : [];
                    const selected = selectedValues.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setAnswers((prev) => {
                            const current = Array.isArray(prev[question.id]) ? (prev[question.id] as string[]) : [];
                            const next = current.includes(option.id)
                              ? current.filter((item) => item !== option.id)
                              : [...current, option.id];
                            return { ...prev, [question.id]: next };
                          });
                        }}
                        data-spectra-card="side"
                        data-card-state={selected ? "selected" : "normal"}
                        className={`group px-3 py-2 text-left text-sm transition ${
                          selected
                            ? ""
                            : "hover:border-[color-mix(in_oklab,var(--warning)_26%,var(--border-default))]"
                        }`}
                        disabled={disabled}
                      >
                        <p className="flex items-center gap-2 font-medium text-[var(--text-primary)]">
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--card-border-soft)] text-[var(--warning)]">
                            {selected ? <Check className="h-3 w-3" /> : null}
                          </span>
                          {option.label}
                        </p>
                        {option.description ? (
                          <p className="mt-1 text-xs text-[var(--text-secondary)]">{option.description}</p>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex justify-end">
        {submittedAnswers ? (
          <div data-spectra-card="side" data-card-state="edited" className="mr-auto px-3 py-2 text-xs text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--text-primary)]">Submitted inline:</span>{" "}
            {block.questions
              .map((question) => `${question.text}: ${formatAnswer(submittedAnswers[question.id] ?? "")}`)
              .join(" · ")}
          </div>
        ) : null}
        <Button
          type="button"
          size="sm"
          onClick={() => {
            const lines = ["Clarification answers:"];
            for (const question of block.questions) {
              const raw = answers[question.id];
              const answer = formatAnswer(
                typeof raw === "string" || Array.isArray(raw) || typeof raw === "boolean"
                  ? raw
                  : "",
              );
              lines.push(`- ${question.id}: ${answer || "(not provided)"}`);
            }
            lines.push("Please continue with this scope.");
            setSubmittedAnswers(answers);
            onSubmit?.({ message: lines.join("\n"), answers });
          }}
          disabled={disabled || !canSubmit || Boolean(submittedAnswers)}
          className="rounded-[9px]"
        >
          {submittedAnswers ? "Continuing…" : "Continue"}
        </Button>
      </div>
    </section>
  );
}
