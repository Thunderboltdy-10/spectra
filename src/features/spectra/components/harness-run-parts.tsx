"use client";

import { useState } from "react";
import { Loader2, ShieldCheck, ExternalLink, FileText } from "@/components/icons/glyph-icons";
import { cn } from "@/lib/utils";
import { workTypeMeta } from "../artifacts/presentation";
import type { HarnessAnswerValue } from "../ai/harness-exchange";
import { mergeTouch } from "../ai/harness-exchange";
import { InlineEmphasis } from "./inline-emphasis";
import type { HarnessArtifactTouchView, HarnessInputView } from "../ai/stream-events";

/*
 * The parts of a harness run the thread shows besides its text: the open
 * question or approval, the work it created, edited or referenced (one card
 * each). Widgets it drew render in thread-widget.tsx.
 */

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
            <AnswerButton primary busy={busy === "allow"} disabled={Boolean(busy)} onClick={() => void send("allow", { kind: "approval", allowed: true })}>
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
            className="h-8 rounded-chip bg-[var(--text-primary)] px-3 text-micro font-semibold text-[var(--bg-primary)] disabled:opacity-35"
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
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-chip px-3 text-micro font-semibold disabled:opacity-50",
        primary
          ? "bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-90"
          : "border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
      )}
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
        },
      ];
    }),
  );
}

const ACTION_COPY = { created: "Created", edited: "Edited", referenced: "Used" } as const;

export function WorkTouchCards({
  touches,
  onOpen,
}: {
  touches: readonly HarnessArtifactTouchView[];
  onOpen?: (artifactId: string) => void;
}) {
  const unique = dedupeTouches(touches);
  if (unique.length === 0) return null;
  return (
    <div className="mt-4 space-y-2" aria-label="Work from this response">
      {unique.map((touch) => {
        const meta = (workTypeMeta as Record<string, (typeof workTypeMeta)[keyof typeof workTypeMeta] | undefined>)[touch.type];
        const Icon = meta?.icon ?? FileText;
        const line = [ACTION_COPY[touch.action], meta?.label, touch.change].filter(Boolean).join(" · ");
        return (
          <div key={touch.id} data-spectra-card="result" data-card-state="normal" className="px-3.5 py-2.5">
            <div className="flex items-center gap-3">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)]"
                style={{ color: meta?.color ?? "var(--accent-gold)" }}
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                {onOpen ? (
                  <button
                    type="button"
                    onClick={() => onOpen(touch.id)}
                    className="block max-w-full truncate rounded-chip text-left text-caption font-semibold text-[var(--text-primary)] outline-none hover:text-[var(--accent-cyan)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--accent-cyan)_35%,transparent)]"
                  >
                    {touch.title}
                  </button>
                ) : (
                  <div className="truncate text-caption font-semibold text-[var(--text-primary)]">{touch.title}</div>
                )}
                <div className="mt-0.5 truncate text-micro text-[var(--text-secondary)]">{line}</div>
              </div>
              {onOpen ? (
                <button
                  type="button"
                  onClick={() => onOpen(touch.id)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                  aria-label={`Open ${touch.title}`}
                  title="Open work"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
