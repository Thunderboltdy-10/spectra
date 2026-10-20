"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { Loader2 } from "@/components/icons/glyph-icons";
import { Button } from "@/components/ui/button";

/*
 * Making an agent is an interview: one question at a time, asked plainly, in
 * the words of whoever is asking (no name, no thread). What a question needs
 * (a sentence, a choice, worked examples) is its answer field; Continue takes
 * the answer and the next question follows from it.
 */

export function InterviewQuestion({
  id,
  prompt,
  detail,
  children,
  canContinue,
  busy = false,
  continueLabel = "Continue",
  onContinue,
  onSkip,
  aside,
}: {
  /** Which question this is: a new one arrives as a new question. */
  id: string;
  prompt: ReactNode;
  detail?: ReactNode;
  children: ReactNode;
  canContinue: boolean;
  busy?: boolean;
  continueLabel?: string;
  onContinue: () => void;
  /** Questions that may not apply can be passed over. */
  onSkip?: () => void;
  /** A quieter control on the far side of the answer, such as going back. */
  aside?: ReactNode;
}) {
  // Enter writes a new line in a long answer; Ctrl or Cmd with Enter answers.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || !canContinue || busy) return;
    event.preventDefault();
    onContinue();
  };
  return (
    <section key={id} className="interview-ask" data-foundry-question={id} onKeyDown={onKeyDown}>
      <h3 className="interview-prompt">{prompt}</h3>
      {detail ? <p className="interview-detail">{detail}</p> : null}
      <div className="interview-answer">{children}</div>
      <div className="interview-actions">
        {aside}
        <span className="flex-1" />
        {onSkip ? (
          <button type="button" className="interview-skip" disabled={busy} onClick={onSkip}>
            Skip
          </button>
        ) : null}
        <Button variant="primary" size="sm" disabled={!canContinue || busy} onClick={onContinue} title="Ctrl Enter">
          {busy ? <Loader2 size={14} className="foundry-spin" /> : null}
          {continueLabel}
        </Button>
      </div>
    </section>
  );
}

/** While the next question is being worked out from the last answer. */
export function InterviewThinking({ label = "Thinking about what to ask next" }: { label?: string }) {
  return (
    <p className="interview-thinking" role="status">
      <span className="interview-thinking-dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      {label}
    </p>
  );
}
