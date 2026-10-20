"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "@/components/icons/glyph-icons";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { presentationSlideLabel, type PresentationSlide } from "../presentation/model";
import {
  clockDuration,
  longestSlide,
  spokenDuration,
  type RehearsalReport,
} from "../presentation/rehearsal";

/*
 * What a private rehearsal leaves behind: a run sheet. One sentence says how
 * long the talk took; a strip shows where the time went, each slide as wide
 * as the time spent on it; then every slide with its picture and its time.
 * Nothing in it changes the deck, and nobody else sees it.
 */
export function PresentationRehearsalReport({
  report,
  targetMs,
  preview,
  onClose,
  onRehearseAgain,
}: {
  report: RehearsalReport;
  /** The deck's own seconds per slide, when it advances by itself. */
  targetMs?: number;
  /** Draws one slide as a still picture, the same way the rail does. */
  preview: (slide: PresentationSlide) => ReactNode;
  onClose: () => void;
  onRehearseAgain: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [pointed, setPointed] = useState<number>();
  useModalFocus(sheetRef, { open: true, onClose });
  // The sheet itself takes focus, so it opens on the sentence rather than on a
  // ringed close button; Tab then walks its controls.
  useEffect(() => sheetRef.current?.focus(), []);

  const count = report.slides.length;
  const longest = longestSlide(report);
  const share = (duration: number) => (report.totalMs ? duration / report.totalMs : 1 / Math.max(1, count));

  return createPortal(
    <div className="presentation-rehearsal" role="presentation">
      <div
        ref={sheetRef}
        tabIndex={-1}
        className="presentation-rehearsal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rehearsal-total"
      >
        <header>
          <p>Your rehearsal. Only you can see it.</p>
          <button type="button" aria-label="Close" onClick={onClose}>
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <h2 id="rehearsal-total">You spoke for {spokenDuration(report.totalMs)}.</h2>
        <p className="presentation-rehearsal-gist">
          {count === 1 ? "One slide" : `${count} slides`}
          {count > 1 ? `, about ${spokenDuration(report.totalMs / count)} each` : ""}.
          {longest !== undefined
            ? ` You stayed longest on “${presentationSlideLabel(report.slides[longest]!, longest)}”.`
            : ""}
        </p>

        <div className="presentation-rehearsal-strip" aria-hidden onPointerLeave={() => setPointed(undefined)}>
          {report.slides.map((slide, index) => (
            <span
              key={slide.id}
              style={{ "--share": share(report.slideDurations[index]!), "--order": index } as CSSProperties}
              data-pointed={pointed === index || undefined}
              data-longest={longest === index || undefined}
              onPointerEnter={() => setPointed(index)}
            />
          ))}
        </div>

        <ol className="presentation-rehearsal-slides" onPointerLeave={() => setPointed(undefined)}>
          {report.slides.map((slide, index) => {
            const duration = report.slideDurations[index]!;
            const over = targetMs ? duration - targetMs : 0;
            return (
              <li
                key={slide.id}
                data-pointed={pointed === index || undefined}
                onPointerEnter={() => setPointed(index)}
              >
                {preview(slide)}
                <span className="presentation-rehearsal-title">{presentationSlideLabel(slide, index)}</span>
                <span className="presentation-rehearsal-time">
                  {clockDuration(duration)}
                  {over > 1_000 ? <small>{clockDuration(over)} over</small> : null}
                </span>
              </li>
            );
          })}
        </ol>

        <footer>
          {targetMs ? (
            <p>The deck moves on every {spokenDuration(targetMs)}; times past that are marked.</p>
          ) : (
            <p>The deck itself is unchanged.</p>
          )}
          <button type="button" className="presentation-rehearsal-quiet" onClick={onClose}>
            Done
          </button>
          <button type="button" className="presentation-rehearsal-again" onClick={onRehearseAgain}>
            Rehearse again
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
