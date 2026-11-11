"use client";

import { forwardRef, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { workTypeMeta, type PresentedWorkType } from "../artifacts/presentation";
import { plainTextFromStored } from "../rich-content/adapters";
import type { IslandTab } from "./island-model";
import { runTabCard } from "./run-tabs";

/*
 * The reply peek (ISLAND.md, "Sending"): when a thread finishes while its card
 * is not open, a small card rises out of its tab. The works the run made or
 * changed stand along its top as tabs, one press from opening; under them is
 * the start of what Spectra said at the end. It never takes focus, has no
 * header and no close button; it folds back into its tab after a while, and
 * resting on it grows it into the whole thread.
 */

/** How long a peek stays, while nothing holds it. */
export const PEEK_LIFE_MS = 8_000;
/** Resting the pointer on a peek this long opens the thread. */
export const PEEK_REST_MS = 300;
/** Works named on the peek; a run that touched more says how many. */
const PEEK_WORKS = 4;
/** A calendar event the run added wears the task's ink and the calendar's glyph. */
const CALENDAR_META = { ...workTypeMeta.planner_task, glyph: "calendar" as const };

export type PeekWork = { id: string; title: string; type: string; created: boolean; regionId?: string };

export type PeekLine = {
  /** The start of the closing reply. */
  text: string;
  /** What the run made or changed, new work first. */
  works: PeekWork[];
  canUndo: boolean;
};

/** The first sentence of a reply: "Added a closing sentence to Physics progress." */
export function firstSentence(text: string) {
  const plain = text.replace(/\s+/g, " ").trim();
  const match = /^.+?[.!?](?=\s|$)/.exec(plain);
  return (match ? match[0] : plain).trim();
}

/** What the peek shows for a finished thread. */
export function peekLine(tab: IslandTab): PeekLine | null {
  const card = runTabCard(tab.source);
  const text = plainTextFromStored(tab.source.run.finalSummary ?? card?.summary ?? "").trim();
  const provenance = card?.provenance;
  const created = new Set(provenance?.createdIds ?? []);
  const titles = provenance?.artifactTitles ?? [];
  const types = provenance?.artifactTypes ?? [];
  const works = (provenance?.artifactIds ?? [])
    .map((id, index): PeekWork => ({
      id,
      title: titles[index]?.trim() || tab.title,
      type: types[index] ?? "document",
      created: created.has(id),
      regionId: provenance?.regions?.find((region) => region.artifactId === id)?.regionId,
    }))
    .sort((a, b) => Number(b.created) - Number(a.created));
  const canUndo = Boolean(card?.actions?.some((action) => action.key === "revert"));
  if (!text && !works.length) return null;
  return { text, works, canUndo };
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
  // A press here does its one thing; it never moves the keyboard from where the person is typing.
  const quiet = { onMouseDown: (event: { preventDefault(): void }) => event.preventDefault() };
  const shown = line.works.slice(0, PEEK_WORKS);
  const more = line.works.length - shown.length;
  return (
    <div
      ref={ref}
      data-island-peek
      role="status"
      aria-label={`${title}: ${line.text || line.works.map((work) => work.title).join(", ")}`}
      aria-hidden={!visible}
      onPointerEnter={onRest}
      onPointerLeave={onLeave}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onOpen}
      className={cn(
        "box-border w-[min(420px,calc(100vw-var(--spectra-rail-width,0px)-var(--spectra-lead-width,0px)-var(--spectra-side-width,0px)-32px))] cursor-pointer overflow-hidden rounded-surface border border-[var(--card-border)] bg-[var(--card-paper)] shadow-[var(--shadow-lg)]",
        "transition-opacity duration-200 ease-[var(--ease-standard)]",
        visible ? "opacity-100 delay-[110ms]" : "pointer-events-none opacity-0",
      )}
    >
      {shown.length || line.canUndo ? (
        <div data-peek-works className="flex items-center gap-1.5 border-b border-[var(--card-border-soft)] px-2 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            {shown.map((work) => {
              const meta = work.type === "calendar_event" ? CALENDAR_META : (workTypeMeta[work.type as PresentedWorkType] ?? workTypeMeta.document);
              return (
                <button
                  key={work.id}
                  type="button"
                  {...quiet}
                  onClick={(event) => {
                    event.stopPropagation();
                    onShow(work.id, work.regionId);
                  }}
                  aria-label={`${work.created ? "Open" : "Show"} ${work.title}`}
                  style={{ "--work-hue": meta.color, "--work-tint": meta.soft } as CSSProperties}
                  className="peek-work"
                >
                  <Icon name={meta.glyph} size={14} />
                  <span className="min-w-0 truncate">{work.title}</span>
                </button>
              );
            })}
            {more > 0 ? <span className="shrink-0 px-1 text-micro text-[var(--text-tertiary)]">+{more}</span> : null}
          </div>
          {line.canUndo ? (
            <button
              type="button"
              {...quiet}
              onClick={(event) => {
                event.stopPropagation();
                onUndo();
              }}
              className="h-7 shrink-0 rounded-control px-2 text-caption font-medium text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
      {line.text ? (
        <p
          ref={bodyRef}
          data-peek-reply
          className={cn(
            "max-h-[4.5rem] overflow-hidden px-4 py-2.5 text-ui leading-6 text-[var(--text-primary)]",
            clipped && "[mask-image:linear-gradient(to_bottom,black_60%,transparent)]",
          )}
        >
          {line.text}
        </p>
      ) : null}
    </div>
  );
});
