"use client";

import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { plainTextFromStored } from "../rich-content/adapters";
import type { IslandTab } from "./island-model";
import { runTabCard } from "./run-tabs";

/*
 * The reply peek (ISLAND.md, "Sending"): when a thread finishes while its card
 * is not open, a small card rises out of its tab with the answer. It never
 * takes focus, has no header and no close button; it folds back into its tab
 * after a while, and resting on it grows it into the whole thread.
 */

/** How long a peek stays, while nothing holds it. */
export const PEEK_LIFE_MS = 8_000;
/** Resting the pointer on a peek this long opens the thread. */
export const PEEK_REST_MS = 300;

export type PeekLine =
  | { kind: "reply"; text: string }
  | { kind: "changed"; text: string; artifactId: string; regionId?: string; canUndo: boolean }
  | { kind: "made"; text: string; artifactId: string };

/** The first sentence of a reply, for a one-line peek: "Added a closing sentence to Physics progress." */
export function firstSentence(text: string) {
  const plain = text.replace(/\s+/g, " ").trim();
  const match = /^.+?[.!?](?=\s|$)/.exec(plain);
  return (match ? match[0] : plain).trim();
}

/** What the peek says for a finished thread. */
export function peekLine(tab: IslandTab): PeekLine | null {
  const card = runTabCard(tab.source);
  const reply = plainTextFromStored(tab.source.run.finalSummary ?? card?.summary ?? "").trim();
  const provenance = card?.provenance;
  const created = new Set(provenance?.createdIds ?? []);
  const ids = provenance?.artifactIds ?? [];
  const titles = provenance?.artifactTitles ?? [];
  const canUndo = Boolean(card?.actions?.some((action) => action.key === "revert"));
  const madeIndex = ids.findIndex((id) => created.has(id));
  if (madeIndex >= 0) return { kind: "made", text: titles[madeIndex]?.trim() || tab.title, artifactId: ids[madeIndex]! };
  const changedId = ids[0];
  if (changedId && canUndo) {
    const regionId = provenance?.regions?.find((region) => region.artifactId === changedId)?.regionId;
    return { kind: "changed", text: firstSentence(reply) || `Changed ${titles[0] ?? tab.title}`, artifactId: changedId, regionId, canUndo };
  }
  return reply ? { kind: "reply", text: reply } : null;
}

export const ReplyPeek = forwardRef<
  HTMLDivElement,
  {
    line: PeekLine;
    title: string;
    visible: boolean;
    onOpen: () => void;
    onRest: () => void;
    onLeave: () => void;
    onUndo: () => void;
    onShow: (artifactId: string, regionId?: string) => void;
  }
>(function ReplyPeek({ line, title, visible, onOpen, onRest, onLeave, onUndo, onShow }, ref) {
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body) setClipped(body.scrollHeight > body.clientHeight + 1);
  }, [line.text]);
  const action = (label: string, run: () => void) => (
    <button
      type="button"
      // A press here does its one thing; it never moves the keyboard from where the person is typing.
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation();
        run();
      }}
      className="h-7 shrink-0 rounded-control px-2 text-caption font-medium text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
    >
      {label}
    </button>
  );
  return (
    <div
      ref={ref}
      data-island-peek
      role="status"
      aria-label={`${title}: ${line.text}`}
      aria-hidden={!visible}
      onPointerEnter={onRest}
      onPointerLeave={onLeave}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onOpen}
      className={cn(
        "box-border w-[min(360px,calc(100vw-var(--spectra-rail-width,0px)-var(--spectra-lead-width,0px)-var(--spectra-side-width,0px)-32px))] cursor-pointer rounded-surface border border-[var(--card-border)] bg-[var(--card-paper)] shadow-[var(--shadow-lg)]",
        "transition-opacity duration-200 ease-[var(--ease-standard)]",
        visible ? "opacity-100 delay-[110ms]" : "pointer-events-none opacity-0",
      )}
    >
      {line.kind === "reply" ? (
        <p
          ref={bodyRef}
          data-peek-reply
          className={cn(
            "max-h-[4.5rem] overflow-hidden px-4 py-3 text-ui leading-6 text-[var(--text-primary)]",
            clipped && "[mask-image:linear-gradient(to_bottom,black_60%,transparent)]",
          )}
        >
          {line.text}
        </p>
      ) : (
        <div className="flex items-center gap-2 py-1.5 pl-4 pr-1.5">
          <p data-peek-line className="min-w-0 flex-1 truncate text-ui leading-6 text-[var(--text-primary)]">
            {line.text}
          </p>
          {line.kind === "changed" ? (
            <>
              {line.canUndo ? action("Undo", onUndo) : null}
              {action("Show", () => onShow(line.artifactId, line.regionId))}
            </>
          ) : (
            action("Open", () => onShow(line.artifactId))
          )}
        </div>
      )}
    </div>
  );
});
