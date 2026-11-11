"use client";

import { buttonVariants } from "@/components/ui/button";
import { useState, type CSSProperties } from "react";
import { Icon as Glyph } from "@/components/icons";
import { Loader2, ShieldCheck } from "@/components/icons/glyph-icons";
import Link from "next/link";
import { workTypeMeta } from "../artifacts/presentation";
import { calendarTouchHref, isCalendarTouch } from "../calendar/domain/touch";
import type { HarnessAnswerValue } from "../ai/harness-exchange";
import { mergeTouch } from "../ai/harness-exchange";
import { InlineEmphasis } from "./inline-emphasis";
import type { HarnessArtifactTouchView, HarnessInputView } from "../ai/stream-events";

/*
 * The parts of a harness run the thread shows besides its text: the open
 * question or approval, the work it created, edited or referenced (one card
 * each). Widgets it drew render in thread-widget.tsx.
 */

/** What was asked and what was said, once it has been answered. */
export function AnsweredInputs({ answers }: { answers: ReadonlyArray<{ key: string; question: string; label: string }> }) {
  if (!answers.length) return null;
  return (
    <div className="mt-4 grid gap-2.5" data-conversation-action="input-answered">
      {answers.map((answer) => (
        <section
          key={answer.key}
          aria-label="Answered"
          className="border-l-2 border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] pl-3"
        >
          {answer.question ? (
            <p className="whitespace-pre-wrap text-caption font-semibold leading-5 text-[var(--text-primary)]">
              <InlineEmphasis text={answer.question} />
            </p>
          ) : null}
          <p className="mt-0.5 text-micro text-[var(--text-secondary)]">
            {answer.label === "Allowed" || answer.label === "Not allowed" || answer.label === "Skipped" ? answer.label : `Answered: ${answer.label}`}
          </p>
        </section>
      ))}
    </div>
  );
}

export function HarnessInputPanel({
  input,
  onAnswer,
}: {
  input: HarnessInputView;
  onAnswer: (value: HarnessAnswerValue) => Promise<boolean> | boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState("");
  const send = async (key: string, value: HarnessAnswerValue) => {
    if (busy) return;
    setBusy(key);
    try {
      const accepted = await onAnswer(value);
      if (accepted !== false) setText("");
    } finally {
      setBusy(null);
    }
  };
  const approval = input.kind === "approval";
  const showText = !approval && (input.allowText || !input.options?.length);
  return (
    <section
      data-spectra-card="result"
      data-card-state="confirmation"
      aria-label={approval ? "Spectra asks for your OK" : "Spectra asks a question"}
      className="mt-4 px-3.5 py-3"
    >
      <div className="flex items-start gap-2.5">
        {approval ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" /> : null}
        <p className="min-w-0 flex-1 whitespace-pre-wrap text-caption leading-5 text-[var(--text-primary)]">
          <InlineEmphasis text={input.question} />
        </p>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {approval ? (
          <>
            <AnswerButton
              primary
              busy={busy === "allow"}
              disabled={Boolean(busy)}
              title="Spectra will not ask again for this kind of change in this thread"
              onClick={() => void send("allow", { kind: "approval", allowed: true })}
            >
              Allow
            </AnswerButton>
            {input.alwaysAllowLabel ? (
              <AnswerButton
                busy={busy === "always"}
                disabled={Boolean(busy)}
                onClick={() => void send("always", { kind: "approval", allowed: true, alwaysAllow: true })}
              >
                {input.alwaysAllowLabel}
              </AnswerButton>
            ) : null}
            <AnswerButton busy={busy === "deny"} disabled={Boolean(busy)} onClick={() => void send("deny", { kind: "approval", allowed: false })}>
              Don&apos;t allow
            </AnswerButton>
          </>
        ) : (
          input.options?.map((option) => (
            <AnswerButton
              key={option.key}
              busy={busy === option.key}
              disabled={Boolean(busy)}
              title={option.description}
              onClick={() => void send(option.key, { kind: "question", choiceKey: option.key })}
            >
              <InlineEmphasis text={option.label} />
            </AnswerButton>
          ))
        )}
      </div>
      {showText ? (
        <form
          className="mt-2 flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const clean = text.trim();
            if (clean) void send("text", { kind: "question", text: clean });
          }}
        >
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Write your answer"
            aria-label="Your answer"
            className="h-8 min-w-0 flex-1 rounded-chip border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 text-micro text-[var(--text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--accent-cyan)_35%,transparent)]"
          />
          <button
            type="submit"
            disabled={!text.trim() || Boolean(busy)}
            className={buttonVariants({ variant: "primary" })}
          >
            {busy === "text" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Send"}
          </button>
        </form>
      ) : null}
    </section>
  );
}

function AnswerButton({
  children,
  primary = false,
  busy = false,
  disabled,
  title,
  onClick,
}: {
  children: React.ReactNode;
  primary?: boolean;
  busy?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={buttonVariants({ variant: primary ? "primary" : "ghost" })}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      {children}
    </button>
  );
}

/** Touches from any source, one per piece of work. */
export function dedupeTouches(touches: readonly HarnessArtifactTouchView[]) {
  return touches.reduce<HarnessArtifactTouchView[]>((list, touch) => mergeTouch(list, touch), []);
}

/** Reads the work a saved assistant message records, ignoring anything malformed. */
export function messageTouches(metadata: Record<string, unknown> | undefined): HarnessArtifactTouchView[] {
  const rows = metadata?.artifacts;
  if (!Array.isArray(rows)) return [];
  return dedupeTouches(
    rows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const value = row as Record<string, unknown>;
      const action = value.action === "created" || value.action === "edited" || value.action === "referenced" ? value.action : null;
      if (typeof value.id !== "string" || typeof value.title !== "string" || !action) return [];
      return [
        {
          id: value.id,
          type: typeof value.type === "string" ? value.type : "document",
          title: value.title,
          action,
          ...(typeof value.change === "string" && value.change.trim() ? { change: value.change } : {}),
          ...(action === "edited" && typeof value.region === "string" && value.region ? { region: value.region } : {}),
        },
      ];
    }),
  );
}

const ACTION_COPY = { created: "Created", edited: "Edited", referenced: "Used" } as const;

/*
 * The work a response made or changed, as slips in each work's colour
 * (LANGUAGE.md, "Cards"): what happened to it, its name, and what changed.
 * The whole slip opens the work beside the thread.
 */
export function WorkTouchCards({
  touches,
  onOpen,
  currentTitles,
  undone = false,
}: {
  touches: readonly HarnessArtifactTouchView[];
  /** Opens the work; an edit lands on the region it changed. */
  onOpen?: (artifactId: string, regionId?: string) => void;
  /** Names as they are now, when known: a work renamed since keeps its new name here. */
  currentTitles?: ReadonlyMap<string, string>;
  /** The run was undone: a slip says what became of the work, not what the run did. */
  undone?: boolean;
}) {
  const unique = dedupeTouches(touches).map((touch) => {
    const title = currentTitles?.get(touch.id);
    return title && title !== touch.title ? { ...touch, title } : touch;
  });
  if (unique.length === 0) return null;
  return (
    <ul className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-2" aria-label="Artifact from this response">
      {unique.map((touch) => {
        const calendar = isCalendarTouch(touch.id);
        const meta = calendar
          ? { ...workTypeMeta.planner_task, glyph: "calendar" as const, label: "Calendar event" }
          : ((workTypeMeta as Record<string, (typeof workTypeMeta)[keyof typeof workTypeMeta] | undefined>)[touch.type] ?? workTypeMeta.document);
        const reversed = undone && touch.action !== "referenced";
        const action = reversed ? "Undone" : ACTION_COPY[touch.action];
        // A change that only repeats the action ("Edited", "Edited") says it once.
        const change = reversed
          ? touch.action === "created" ? "Moved to the Trash" : "Put back as it was"
          : touch.change?.trim() && touch.change.trim().toLowerCase() !== action.toLowerCase() ? touch.change : meta.label;
        // What the undo sent to the Trash doesn't open from here.
        const opens = reversed && touch.action === "created" ? undefined : onOpen;
        const body = (
          <>
            <span className="work-slip-glyph" aria-hidden>
              <Glyph name={meta.glyph} size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="work-slip-title">{touch.title}</span>
              <span className="work-slip-line">
                <span className="work-slip-action">{action}</span>
                <span className="truncate">{change}</span>
              </span>
            </span>
            {opens ? <span className="work-slip-open">Open</span> : null}
          </>
        );
        return (
          <li key={touch.id} data-work-slip style={{ "--work-hue": meta.color, "--work-tint": meta.soft } as CSSProperties}>
            {calendar && !reversed ? (
              // An event is not a work: it opens the calendar on its day.
              <Link href={calendarTouchHref(touch.region)} aria-label={`Show ${touch.title} in your calendar`} className="work-slip">
                {body}
              </Link>
            ) : opens && !calendar ? (
              <button type="button" onClick={() => opens(touch.id, touch.region)} aria-label={`Open ${touch.title}`} className="work-slip">
                {body}
              </button>
            ) : (
              <div className="work-slip">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
