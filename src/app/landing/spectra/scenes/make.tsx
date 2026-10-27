"use client";

import { useEffect, useRef, useState } from "react";
import { useWorkPreviews } from "@/features/spectra/artifacts/use-work-previews";
import { meaningfulSummary } from "@/features/spectra/artifacts/work-preview";
import { openWorkInSide } from "@/features/spectra/components/side-open";
import { WorkCard } from "@/features/spectra/components/work-card";
import { useClassBook } from "@/features/spectra/school/use-class-book";
import { InlineStudio } from "../../kit/inline-studio";
import { islandField, typeIntoIsland } from "../../kit/landing-island";
import { useWorld, useWorldEvent } from "../../kit/world-context";
import { WORKS, type StoryWork } from "../../world/works";
import { useScene } from "../director";
import { PEOPLE, useHands } from "../hands";
import { dimAll, flash, shine } from "../light/light";

/*
 * Henry hands Spectra his Biology notes and asks for something to revise
 * from. The island runs as it does in the app, and what it makes lands here
 * as Spectra's own cards: a quiz, flashcards, slides. Each card opens its real
 * editor beside it on hover, so the quiz can be answered and the cards
 * flipped right here; pressing one opens it beside the page.
 */

const QUESTION = "make me something to revise for thursday's test";
const MADE = [WORKS.quiz, WORKS.cards, WORKS.deck];
/** Each kind of work lights the paper in its own colour (quiz red, cards violet, slides orange). */
const HUES: Record<string, [number, number]> = {
  [WORKS.quiz._id]: [5.8, 6.4],
  [WORKS.cards._id]: [4.6, 5.4],
  [WORKS.deck._id]: [0.4, 1.2],
};

const placeOf = (work: StoryWork) => work.placements?.[0]?.workspaceTitle ?? "Inbox";

export function Make() {
  const world = useWorld();
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const { layer, hand } = useHands();
  const previewOf = useWorkPreviews([WORKS.notes, ...MADE]);
  const book = useClassBook();
  const [made, setMade] = useState<ReadonlySet<string>>(() => new Set());
  const [active, setActive] = useState<string | null>(null);
  const running = useRef(false);

  const land = (id: string) => {
    setMade((was) => (was.has(id) ? was : new Set(was).add(id)));
    setActive((was) => was ?? id);
    const card = cardRefs.current[id];
    if (card) flash({ el: card, rx: 240, ry: 200, strength: 0.7, hues: HUES[id], hold: 700 });
  };

  useWorldEvent((event) => {
    if (!running.current) return;
    if (event.type === "reading" && event.workId && HUES[event.workId]) land(event.workId);
    if (event.type === "run_finished" && event.reply.key === "make") {
      for (const work of MADE) land(work._id);
      running.current = false;
    }
  });

  // The scene's light: cool where the notes are, and the colours of what was made once it is there.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    shine("make-notes", { el: stage, at: [0.12, 0.2], rx: 420, ry: 320, strength: 0.38, hues: [3.6, 4.6], flow: 0.5, ease: 1200 });
    return () => dimAll("make");
  }, []);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || made.size < MADE.length) return;
    shine("make-made", { el: stage, at: [0.7, 0.42], rx: 640, ry: 420, strength: 0.5, hues: [4.8, 7.2], flow: 0.8, ease: 1600 });
  }, [made]);

  useScene(
    sectionRef,
    async ({ wait, skipped, signal }) => {
      if (skipped) {
        setMade(new Set(MADE.map((work) => work._id)));
        setActive(WORKS.quiz._id);
        return;
      }
      const henry = hand(PEOPLE.henry, signal);
      const notes = notesRef.current;
      await henry.show(notes, [0.42, 0.4]);
      await wait(160);
      await henry.press({ light: false });
      if (notes) henry.grab(notes);
      // He hands the notes to the island at the bottom of the screen.
      await henry.move(islandField(), { ms: 700, aim: [0.5, 0.5] });
      await henry.drop();
      if (signal.aborted) return;
      running.current = true;
      await world.whenIdle();
      world.pace = 0.32;
      void typeIntoIsland(QUESTION, {
        fresh: true,
        perLetter: 12,
        references: [{ id: WORKS.notes._id, type: WORKS.notes.blueprintKey, title: WORKS.notes.title }],
      });
      await henry.hide();
      // Once the three are in, he looks through them: each opens in its own editor as his hand passes.
      while (running.current && !signal.aborted) await wait(120);
      await wait(400);
      for (const work of [WORKS.quiz, WORKS.cards, WORKS.deck]) {
        await henry.move(cardRefs.current[work._id], { aim: [0.5, 0.42] });
        setActive(work._id);
        await wait(work === WORKS.deck ? 500 : 1100);
      }
      await henry.hide();
    },
    2600,
  );

  const shown = active ? (MADE.find((work) => work._id === active) ?? null) : null;

  return (
    <section ref={sectionRef} className="sp-scene sp-make" aria-labelledby="sp-make-title">
      <div className="sp-scene-copy" data-settle-to>
        <h2 id="sp-make-title" className="sp-heading" data-light-text>
          Make anything from what you already have.
        </h2>
        <p className="sp-lede">
          Hand Spectra your notes and ask for something to revise from. It writes a quiz on the parts you know least, cards to
          flip and slides to talk through, and files them in the class.
        </p>
      </div>

      <div ref={stageRef} className="sp-make-stage">
        <div className="sp-make-cards work-desk">
          <div ref={notesRef} className="sp-make-card" data-source>
            <WorkCard
              type={WORKS.notes.blueprintKey}
              title={WORKS.notes.title}
              preview={previewOf(WORKS.notes)}
              summary={meaningfulSummary(WORKS.notes.blueprintKey, WORKS.notes.summary)}
              place={placeOf(WORKS.notes)}
              ink={book.named(placeOf(WORKS.notes))?.ink}
              href="#"
              onOpen={() => openWorkInSide(WORKS.notes._id)}
            />
          </div>
          {MADE.map((work) => (
            <div
              key={work._id}
              ref={(node) => {
                cardRefs.current[work._id] = node;
              }}
              className="sp-make-card"
              data-made={made.has(work._id) || undefined}
              data-active={active === work._id || undefined}
              onPointerEnter={() => made.has(work._id) && setActive(work._id)}
              onFocus={() => made.has(work._id) && setActive(work._id)}
            >
              {made.has(work._id) ? (
                <WorkCard
                  type={work.blueprintKey}
                  title={work.title}
                  preview={previewOf(work)}
                  summary={meaningfulSummary(work.blueprintKey, work.summary)}
                  place={placeOf(work)}
                  ink={book.named(placeOf(work))?.ink}
                  href="#"
                  onOpen={() => openWorkInSide(work._id)}
                />
              ) : (
                <span className="sp-make-slot" aria-hidden />
              )}
            </div>
          ))}
        </div>

        <div className="sp-make-studio" data-empty={!shown || undefined}>
          {shown ? (
            <InlineStudio key={shown._id} work={shown} instanceKey={`landing-make-${shown._id}`} className="sp-studio" />
          ) : (
            <p className="sp-make-wait">What Spectra makes opens here.</p>
          )}
        </div>
        {layer}
      </div>
    </section>
  );
}
