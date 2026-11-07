"use client";

import { buttonVariants } from "@/components/ui/button";
import { forwardRef, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { SplitButton } from "@/components/ui/split-button";
import { cn } from "@/lib/utils";
import { InlineEmphasis } from "../components/inline-emphasis";
import { readCommandAttachment } from "../components/command-attachments";
import type { PendingQuestion, QuestionAnswer } from "./questions";

/*
 * A question or approval from Spectra (ISLAND.md, "Questions and
 * approvals"): the question in plain words, up to four choices or a short
 * answer, and for approvals Allow (with "Always allow" in its menu) and
 * Don't allow. Typing answers a question, or declines an approval with what
 * to do instead.
 */

const chip = buttonVariants({ variant: "secondary" });

const footerLink =
  "rounded-control underline-offset-2 outline-none hover:text-[var(--text-primary)] hover:underline focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] disabled:opacity-45";

/** The card a moment longer, saying the answer landed, before it goes. */
export function AnsweredCard({ question, label }: { question: string; label: string }) {
  return (
    <div
      role="status"
      data-island-question-answered
      className="box-border w-[min(440px,calc(100vw-32px))] rounded-surface border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-3 shadow-[var(--shadow-lg)]"
    >
      <p className="line-clamp-2 text-caption text-[var(--text-secondary)]">{question}</p>
      <p className="mt-1 flex items-center gap-1.5 text-ui font-medium text-[var(--text-primary)]">
        <Icon name="check" size={14} className="shrink-0 text-[var(--accent-cyan)]" />
        <span className="min-w-0 truncate">{label}</span>
      </p>
    </div>
  );
}

export const QuestionCard = forwardRef<
  HTMLDivElement,
  {
    question: PendingQuestion;
    index: number;
    count: number;
    visible: boolean;
    onStep: (delta: number) => void;
    onAnswer: (answer: QuestionAnswer) => Promise<boolean>;
    onOpenThread?: () => void;
    /** Puts the question aside, still waiting: its thread's tab counts it until it is answered. */
    onLater: () => void;
    /** The reader is with the question (pointer, keys): it is not put aside for being idle. */
    onActivity: () => void;
  }
>(function QuestionCard({ question, index, count, visible, onStep, onAnswer, onOpenThread, onLater, onActivity }, ref) {
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [batch, setBatch] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const approval = question.kind === "approval";

  useEffect(() => {
    setText("");
    setBatch({});
    setBusy(null);
  }, [question.key]);

  const send = async (key: string, answer: QuestionAnswer) => {
    if (busy) return;
    setBusy(key);
    try {
      const accepted = await onAnswer(answer);
      if (!accepted) setBusy(null);
    } catch {
      setBusy(null);
    }
  };

  const submitText = () => {
    const clean = text.trim();
    if (!clean) return;
    void send("text", approval ? { kind: "deny", text: clean } : { kind: "text", text: clean });
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={approval ? "Spectra asks for your OK" : "Spectra asks a question"}
      data-island-question
      inert={!visible}
      aria-hidden={!visible}
      onPointerMove={onActivity}
      onKeyDown={onActivity}
      onFocus={onActivity}
      className={cn(
        "box-border w-[min(440px,calc(100vw-32px))] rounded-surface border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 pb-3 pt-3.5 shadow-[var(--shadow-lg)]",
        "transition-opacity duration-150",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="mt-[7px] size-2 shrink-0 rounded-full bg-[var(--warning)]" />
        <div className="min-w-0 flex-1">
          {/* Several questions at once: each says which thread asks it. */}
          {count > 1 && question.threadTitle ? (
            <p data-question-thread className="truncate text-micro leading-5 text-[var(--text-tertiary)]">
              {question.threadTitle}
            </p>
          ) : null}
          <p data-question-text className="whitespace-pre-wrap text-ui font-medium leading-6 text-[var(--text-primary)]">
            <InlineEmphasis text={question.prompt} />
          </p>
        </div>
        {count > 1 ? (
          <span className="flex shrink-0 items-center gap-0.5 text-micro text-[var(--text-tertiary)]">
            <IconButton icon="chevronRight" label="Previous question" size="compact" className="size-6 rotate-180" onClick={() => onStep(-1)} />
            {index + 1} of {count}
            <IconButton icon="chevronRight" label="Next question" size="compact" className="size-6" onClick={() => onStep(1)} />
          </span>
        ) : null}
      </div>

      {question.batch ? (
        <div className="mt-3 space-y-3">
          {question.batch.map((item) => (
            <fieldset key={item.id}>
              {question.batch!.length > 1 ? <legend className="mb-1.5 text-caption text-[var(--text-secondary)]">{item.prompt}</legend> : null}
              <div className="flex flex-wrap gap-1.5">
                {item.options.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={batch[item.id] === option.key}
                    title={option.description}
                    onClick={() => setBatch((current) => ({ ...current, [item.id]: option.key }))}
                    className={cn(chip, batch[item.id] === option.key && "border-[var(--text-primary)] bg-[var(--bg-hover)]")}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {approval ? (
          <>
            {question.alwaysAllow ? (
              <SplitButton
                label={busy === "allow" ? "Allowing…" : "Allow"}
                onClick={() => void send("allow", { kind: "allow" })}
                items={[{ key: "always", label: question.alwaysAllow.label, description: question.alwaysAllow.description }]}
                onSelect={() => void send("allow", { kind: "allow", always: true })}
                menuLabel="More ways to allow"
                layer="toast"
                disabled={Boolean(busy)}
              />
            ) : (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void send("allow", { kind: "allow" })}
                className={buttonVariants({ variant: "primary" })}
              >
                {busy === "allow" ? "Allowing…" : "Allow"}
              </button>
            )}
            <button type="button" disabled={Boolean(busy)} onClick={() => void send("deny", { kind: "deny" })} className={chip}>
              Don&apos;t allow
            </button>
          </>
        ) : question.batch ? (
          <button
            type="button"
            disabled={Boolean(busy) || question.batch.some((item) => !batch[item.id])}
            onClick={() => void send("batch", { kind: "batch", selections: batch })}
            className={buttonVariants({ variant: "primary" })}
          >
            Continue
          </button>
        ) : (
          question.options.map((option) => (
            <button
              key={option.key}
              type="button"
              disabled={Boolean(busy)}
              title={option.description}
              onClick={() => void send(option.key, { kind: "choice", key: option.key, label: option.label })}
              className={cn(chip, busy === option.key && "bg-[var(--bg-hover)]")}
            >
              <InlineEmphasis text={option.label} />
            </button>
          ))
        )}
        {question.file ? (
          <>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept={question.file.accept}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                const attachment = await readCommandAttachment(file);
                if (attachment.error) return;
                void send("file", { kind: "text", text: `Here is ${file.name}.`, attachments: [attachment] });
              }}
            />
            <button type="button" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()} className={chip}>
              <Icon name="attach" size={14} className="mr-1.5" />
              Choose a file
            </button>
          </>
        ) : null}
      </div>

      {question.allowText ? (
        <form
          className="mt-2.5 flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            submitText();
          }}
        >
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={approval ? "Or say what to do instead" : "Write your answer"}
            aria-label={approval ? "What to do instead" : "Your answer"}
            className="h-8 min-w-0 flex-1 rounded-control border border-[var(--border-default)] bg-transparent px-2.5 text-caption text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus-visible:border-[var(--border-strong)]"
          />
          <IconButton icon="send" label="Send answer" type="submit" disabled={!text.trim() || Boolean(busy)} />
        </form>
      ) : null}

      <div className="mt-2.5 flex items-center gap-3 text-micro text-[var(--text-tertiary)]">
        {onOpenThread ? (
          <button type="button" onClick={onOpenThread} className={footerLink}>
            Open thread
          </button>
        ) : null}
        <button type="button" onClick={onLater} title="Spectra waits; the thread's tab keeps the question until you answer" className={footerLink}>
          Answer later
        </button>
        {!approval && !question.batch ? (
          <button type="button" disabled={Boolean(busy)} onClick={() => void send("skip", { kind: "skip" })} className={cn(footerLink, "ml-auto")}>
            Skip, use your judgement
          </button>
        ) : null}
      </div>
    </div>
  );
});
