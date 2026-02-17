"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, CheckCircle2, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichText } from "@/components/chat/rich-text";
import { useCompactSheet } from "@/hooks/use-compact-sheet";
import { useRightPanelDock } from "@/hooks/use-right-panel-dock";

export type QuizPanelQuestion = {
  id: string;
  prompt: string;
  options: Array<{ letter: string; text: string }>;
  correct?: string;
  explanation?: string;
};

type QuizPanelProps = {
  open: boolean;
  onClose: () => void;
  questions: QuizPanelQuestion[];
  answers: Record<string, string>;
  submitted: boolean;
  onSelectAnswer: (questionId: string, letter: string) => void;
  onSubmit: () => void;
};

export function QuizPanel({
  open,
  onClose,
  questions,
  answers,
  submitted,
  onSelectAnswer,
  onSubmit,
}: QuizPanelProps) {
  const [index, setIndex] = useState(0);
  const compact = useCompactSheet(860);
  const docked = useRightPanelDock({ id: "quiz-panel", open, compact, maxWidthPx: 576 });
  const [collapsed, setCollapsed] = useState(false);
  const current = questions[index];

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setCollapsed(compact);
  }, [open, compact]);

  useEffect(() => {
    if (!compact) {
      setCollapsed(false);
    }
  }, [compact]);

  const score = useMemo(
    () => questions.filter((question) => question.correct && answers[question.id] === question.correct).length,
    [answers, questions],
  );

  if (!open) return null;

  const isLast = index >= questions.length - 1;
  const selected = current ? answers[current.id] : undefined;

  return (
    <div className={`fixed z-50 ${docked ? "inset-y-0 right-0 pointer-events-none" : "inset-0"}`} style={docked ? { width: "var(--right-panel-space, 576px)" } : undefined}>
      {!docked ? (
        <button
          type="button"
          className="absolute inset-0 cursor-pointer bg-transparent"
          aria-label="Close quiz panel"
          onClick={onClose}
        />
      ) : null}
      <aside
        className={`right-panel-shell pointer-events-auto absolute flex w-full flex-col border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-soft)] ${
          docked ? "right-panel-shell--docked" : "right-panel-shell--sheet"
        } ${
          compact
            ? "bottom-3 left-3 right-3 max-h-[78vh] rounded-2xl border"
            : "inset-y-0 right-0 max-w-xl border-l"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Quiz Panel</p>
            <p className="text-sm text-[var(--text-secondary)]">
              Question {index + 1} / {questions.length}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {compact ? (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => setCollapsed((prev) => !prev)}
                aria-label={collapsed ? "Expand panel" : "Collapse panel"}
              >
                <ChevronDown className={`h-4 w-4 transition ${collapsed ? "-rotate-90" : "rotate-0"}`} />
              </Button>
            ) : null}
            <Button type="button" variant="secondary" size="icon" onClick={onClose} aria-label="Close panel">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {!collapsed && submitted ? (
          <div className="right-panel-content min-h-0 flex-1 overflow-y-auto space-y-2">
            {questions.map((q, qi) => {
              const userAnswer = answers[q.id];
              const isCorrect = q.correct && userAnswer === q.correct;
              return (
                <div
                  key={q.id}
                  className={`rounded-xl border p-3 ${
                    isCorrect
                      ? "border-[color-mix(in_oklab,var(--success)_40%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_6%,transparent)]"
                      : "border-[color-mix(in_oklab,var(--danger)_40%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_6%,transparent)]"
                  }`}
                >
                  <div className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 shrink-0">
                      {isCorrect ? (
                        <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                      ) : (
                        <XCircle className="h-4 w-4 text-[var(--danger)]" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <RichText content={`**Q${qi + 1}.** ${q.prompt}`} className="text-sm font-medium text-[var(--text-primary)]" />
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        Your answer: {userAnswer ?? "none"} {q.correct ? `• Correct: ${q.correct}` : ""}
                      </p>
                      {q.explanation ? (
                        <div className="mt-1.5 rounded-lg bg-[var(--bg-secondary)] p-2 text-xs text-[var(--text-secondary)]">
                          <RichText content={q.explanation} className="text-xs" />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : !collapsed && current ? (
          <div className="right-panel-content min-h-0 flex-1 overflow-y-auto">
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
              <RichText content={current.prompt} className="mb-3 text-sm font-medium text-[var(--text-primary)]" />
              <div className="space-y-2">
                {current.options.map((option) => {
                  const selectedOption = answers[current.id] === option.letter;
                  const isCorrect = current.correct === option.letter;
                  const isWrongSelected = selectedOption && current.correct && current.correct !== option.letter;
                  return (
                    <button
                      key={`${current.id}-${option.letter}`}
                      type="button"
                      disabled={submitted}
                      onClick={() => onSelectAnswer(current.id, option.letter)}
                      className={`flex w-full cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition disabled:cursor-default ${
                        isCorrect
                          ? "border-[color-mix(in_oklab,var(--success)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_10%,transparent)]"
                          : isWrongSelected
                            ? "border-[color-mix(in_oklab,var(--danger)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_10%,transparent)]"
                            : selectedOption
                              ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_18%,var(--bg-secondary))] ring-1 ring-[var(--accent-cyan)]/50"
                              : "border-[var(--border-default)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      <span className="font-medium">{option.letter}.</span>
                      <RichText content={option.text} className="flex-1 text-sm" />
                      {!submitted && selectedOption ? (
                        <CheckCircle2 className="h-4 w-4 text-[var(--accent-cyan)]" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {!collapsed ? (
          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {index > 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIndex((prev) => Math.max(0, prev - 1))}
                  className="gap-1.5"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {submitted ? (
                <>
                  {!isLast ? (
                    <Button
                      type="button"
                      onClick={() => setIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                      className="gap-1.5"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button type="button" onClick={onClose}>
                      Close
                    </Button>
                  )}
                </>
              ) : (
                <Button
                  type="button"
                  onClick={() => {
                    if (isLast) {
                      onSubmit();
                      return;
                    }
                    setIndex((prev) => Math.min(questions.length - 1, prev + 1));
                  }}
                  className="gap-1.5"
                >
                  {isLast ? "Check Answers" : "Next"}
                  {!isLast ? <ChevronRight className="h-4 w-4" /> : null}
                </Button>
              )}
            </div>
          </div>
        ) : null}

        {!collapsed && !submitted ? (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            Selected: {selected ? selected : "none"} • Answered {Object.keys(answers).length}/{questions.length}
          </p>
        ) : null}
        {!collapsed && submitted ? (
          <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">
            Score: {score}/{questions.length}
          </p>
        ) : null}
      </aside>
    </div>
  );
}
