"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SpectraMark } from "@/components/spectra-mark";
import { Button } from "@/components/ui/button";
import { placeNote, sameBox, spotlightBox, type Box, type Size } from "./tour-geometry";
import { useStreamedText } from "./use-streamed-text";
import { useTourStore } from "./tour-store";

/*
 * The tour on screen: a spotlight that leaves the target bright and dims the
 * rest of the app (the one place Spectra ever dims the screen), and Spectra's
 * note beside it, written the way its replies arrive. Both glide from step to
 * step. Pointing at the target lifts the dim, so the student can look at it
 * properly. Nothing blocks the page: the spotlight never catches the pointer.
 */

/** How long a step waits for its page and target before speaking from the middle. */
const TARGET_WAIT_MS = 4_000;

function boxOf(element: Element): Box | null {
  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function findTarget(selectors: readonly string[]) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const box = element ? boxOf(element) : null;
    if (box) return box;
  }
  return null;
}

/** The target's box, followed every frame so scrolling and layout changes carry the spotlight with them. */
function useTargetBox(stepKey: string, selectorKey: string) {
  // A layer arriving with a new page starts on the box the last one left.
  const [box, setBox] = useState<Box | null>(() => useTourStore.getState().lastBox);
  const rememberBox = useTourStore((state) => state.rememberBox);
  useEffect(() => rememberBox(box), [box, rememberBox]);
  useEffect(() => {
    const selectors = selectorKey ? selectorKey.split("\n") : [];
    if (!selectors.length) {
      setBox(null);
      return;
    }
    const started = performance.now();
    let frame = 0;
    let last: Box | null = null;
    const follow = () => {
      const found = findTarget(selectors);
      // While the page is still arriving the spotlight stays where it was;
      // a target that never comes leaves the note speaking from the middle.
      if (found && !sameBox(found, last)) {
        last = found;
        setBox(found);
      } else if (!found && last === null && performance.now() - started > TARGET_WAIT_MS) {
        setBox(null);
      }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [stepKey, selectorKey]);
  return box;
}

function useViewport(): Size {
  const [size, setSize] = useState<Size>({ width: 1280, height: 800 });
  useLayoutEffect(() => {
    const read = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return size;
}

export function TourLayer({
  stepKey,
  targets,
  text,
  position,
  total,
  onBack,
  onNext,
  onEnd,
}: {
  stepKey: string;
  targets: readonly string[];
  text: string;
  position: number;
  total: number;
  onBack: () => void;
  onNext: () => void;
  onEnd: () => void;
}) {
  const viewport = useViewport();
  const box = useTargetBox(stepKey, targets.join("\n"));
  const note = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const [noteSize, setNoteSize] = useState<Size>({ width: 380, height: 220 });
  const [lifted, setLifted] = useState(false);
  const [resumed] = useState(() => useTourStore.getState().lastBox !== null);
  const stream = useStreamedText(text);
  const last = position === total;

  useLayoutEffect(() => {
    const element = note.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setNoteSize({ width: element.offsetWidth, height: element.offsetHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => next.current?.focus({ preventScroll: true }), []);

  const spot = box ? spotlightBox(box, viewport) : null;
  // Pointing at what the step shows lifts the dim; leaving it brings it back.
  const spotKey = spot ? `${spot.left},${spot.top},${spot.width},${spot.height}` : "";
  useEffect(() => {
    setLifted(false);
    if (!spotKey) return;
    const [left, top, width, height] = spotKey.split(",").map(Number) as [number, number, number, number];
    const onMove = (event: PointerEvent) =>
      setLifted(event.clientX >= left && event.clientX <= left + width && event.clientY >= top && event.clientY <= top + height);
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [spotKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable='true']");
      if (event.key === "Escape") onEnd();
      else if (typing) return;
      else if (event.key === "ArrowRight") onNext();
      else if (event.key === "ArrowLeft" && position > 1) onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack, onEnd, onNext, position]);

  const place = placeNote(spot, noteSize, viewport);
  const hole = spot ?? { left: viewport.width / 2, top: viewport.height / 2, width: 0, height: 0 };

  return createPortal(
    <div className="spectra-tour" data-tour-step={stepKey} data-resumed={resumed || undefined}>
      <div
        aria-hidden
        className="spectra-tour-spot"
        data-lifted={lifted || undefined}
        data-empty={spot ? undefined : ""}
        style={{ transform: `translate3d(${hole.left}px, ${hole.top}px, 0)`, width: hole.width, height: hole.height }}
      />
      <div
        ref={note}
        role="dialog"
        aria-modal="false"
        aria-label="A tour of Spectra"
        className="spectra-tour-note"
        data-side={place.side}
        style={{ transform: `translate3d(${place.left}px, ${place.top}px, 0)` }}
      >
        <div className="flex gap-3">
          <SpectraMark size={22} className="mt-0.5 shrink-0" />
          {/* The whole note sits invisibly under the streamed words, so the
              note is its final size from the first word and never jumps. */}
          <p className="spectra-tour-text" onClick={stream.finish}>
            <span aria-hidden className="invisible">
              {text}
            </span>
            <span aria-hidden>
              {stream.shown}
              {stream.done ? null : <span className="spectra-tour-caret" />}
            </span>
            <span className="sr-only" aria-live="polite">
              {text}
            </span>
          </p>
        </div>
        <div className="mt-4 flex items-center gap-1.5 pl-[34px]">
          <Button variant="ghost" size="sm" onClick={onEnd}>
            End tour
          </Button>
          <span className="flex-1 text-micro tabular-nums text-[var(--text-tertiary)]">
            {position} of {total}
          </span>
          {position > 1 ? (
            <Button variant="ghost" size="sm" onClick={onBack}>
              Back
            </Button>
          ) : null}
          <Button ref={next} variant="primary" size="sm" onClick={onNext}>
            {last ? "Start" : "Next"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
