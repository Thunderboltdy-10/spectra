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
import { Written } from "../../kit/written";
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

const MAKING: Record<string, string> = {
  [WORKS.quiz._id]: "Writing a quiz",
  [WORKS.cards._id]: "Writing flashcards",
  [WORKS.deck._id]: "Making slides",
};

const placeOf = (work: StoryWork) =>
  work.placements?.[0]?.workspaceTitle ?? "Inbox";

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
  const [making, setMaking] = useState<ReadonlySet<string>>(() => new Set());
  const [active, setActive] = useState<string | null>(null);
  const running = useRef(false);

  const land = (id: string) => {
    setMade((was) => (was.has(id) ? was : new Set(was).add(id)));
    setActive((was) => was ?? id);
  };

  // While Spectra makes each one, its place on the desk shows it being made, as a card does in the app.
  useWorldEvent((event) => {
    if (!running.current) return;
    if (event.type === "reading" && event.workId && HUES[event.workId])
      setMaking((was) => new Set(was).add(event.workId!));
    if (event.type === "run_finished" && event.reply.key === "make")
      running.current = false;
  });

  // The scene's light: cool where the notes are, and the colours of what was made once it is there.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    shine("make-notes", {
      el: stage,
      at: [0.12, 0.2],
      rx: 420,
      ry: 320,
      strength: 0.38,
      hues: [3.6, 4.6],
      flow: 0.5,
      ease: 1200,
    });
    return () => dimAll("make");
  }, []);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || made.size < MADE.length) return;
    shine("make-made", {
      el: stage,
      at: [0.7, 0.42],
      rx: 640,
      ry: 420,
      strength: 0.5,
      hues: [4.8, 7.2],
      flow: 0.8,
      ease: 1600,
    });
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
      world.quiet = true;
      void typeIntoIsland(QUESTION, {
        fresh: true,
        perLetter: 12,
        references: [
          {
            id: WORKS.notes._id,
            type: WORKS.notes.blueprintKey,
            title: WORKS.notes.title,
          },
        ],
      });
      await henry.hide();
      // Spectra brings each one out of the island and sets it in its place.
      while (running.current && !signal.aborted) await wait(120);
      const spectra = hand(PEOPLE.spectra, signal);
      for (const work of MADE) {
        const card = cardRefs.current[work._id];
        if (card) card.dataset.brought = "coming";
        land(work._id);
        await wait(40);
        if (!card || signal.aborted) continue;
        await spectra.bring(card, islandField(), { ms: 540 });
        flash({
          el: card,
          rx: 220,
          ry: 180,
          strength: 0.6,
          hues: HUES[work._id],
          hold: 520,
        });
        setMaking((was) => {
          const next = new Set(was);
          next.delete(work._id);
          return next;
        });
      }
      await spectra.hide();
    },
    2600,
  );

  const shown = active
    ? (MADE.find((work) => work._id === active) ?? null)
    : null;

  return (
    <section
      ref={sectionRef}
      className="sp-scene sp-make"
      aria-labelledby="sp-make-title"
    >
      <div className="sp-scene-copy" data-settle-to>
        <Written
          id="sp-make-title"
          className="sp-heading"
          text="Make anything from your notes."
        />
        <p className="sp-lede">
          Hand Spectra your notes and get a quiz on what you know least, cards
          to flip and slides, filed in the class.
        </p>
      </div>

      <div ref={stageRef} className="sp-make-stage">
        <div className="sp-make-cards work-desk">
          <div ref={notesRef} className="sp-make-card" data-source>
            <WorkCard
              type={WORKS.notes.blueprintKey}
              title={WORKS.notes.title}
              preview={previewOf(WORKS.notes)}
              summary={meaningfulSummary(
                WORKS.notes.blueprintKey,
                WORKS.notes.summary,
              )}
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
              data-making={
                (making.has(work._id) && !made.has(work._id)) || undefined
              }
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
                <span className="sp-make-slot" aria-hidden>
                  {making.has(work._id) ? (
                    <span className="sp-make-slot-label">
                      {MAKING[work._id]}
                    </span>
                  ) : null}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="sp-make-studio" data-empty={!shown || undefined}>
          {shown ? (
            <InlineStudio
              key={shown._id}
              work={shown}
              instanceKey={`landing-make-${shown._id}`}
              className="sp-studio"
            />
          ) : (
            <p className="sp-make-wait">What Spectra makes opens here.</p>
          )}
        </div>
        {layer}
      </div>
    </section>
  );
}
