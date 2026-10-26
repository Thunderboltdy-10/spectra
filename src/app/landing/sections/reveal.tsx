"use client";

import { useEffect, useRef } from "react";
import { useBuild, useSteps } from "../kit/build";
import { InlineStudio } from "../kit/inline-studio";
import { Surface, usePresence } from "../kit/presence";
import { PAGE_BOARD, SUPERCHARGE_INDEX } from "../world/board";

/*
 * The reveal: the page was a board. The view starts close on the hero's frame,
 * where the words are the page's own, and pulls back until the whole board is
 * in view, every section a frame, with the notes left while it was made. It is
 * the real whiteboard studio: move a frame, write on a note.
 */

const DURATIONS = [3200, 1600, 3600];

export function Reveal() {
  const ref = useRef<HTMLElement>(null);
  const step = useSteps(useBuild(ref, 0.5), DURATIONS);
  const presence = usePresence(PAGE_BOARD._id);
  const { move, leave } = presence;

  useEffect(() => {
    if (step === 2) move("henry", { path: `/nodes/${SUPERCHARGE_INDEX}`, primitive: "canvasObject", act: { kind: "hover" }, label: "Supercharge your learning", note: "no" });
    if (step === 4) leave("henry");
  }, [leave, move, step]);

  return (
    <section ref={ref} id="board" className="landing-section landing-reveal" data-stage="reveal" data-rail="off" aria-labelledby="reveal-title">
      <div className="landing-copy landing-copy-center">
        <h2 id="reveal-title" className="landing-heading">
          This page was made in Spectra.
        </h2>
        <p className="landing-lede">
          Every section you scrolled through is a frame on one board, with the notes we left while making it. It is the real
          board: move things around, write on it.
        </p>
      </div>
      <Surface id={PAGE_BOARD._id} states={presence.states} className="landing-board">
        <div className="landing-board-zoom" data-out={step >= 1 || undefined}>
          <InlineStudio work={PAGE_BOARD} instanceKey="landing-board" label="Spectra" compact={false} className="landing-studio landing-studio-board" />
        </div>
      </Surface>
    </section>
  );
}
