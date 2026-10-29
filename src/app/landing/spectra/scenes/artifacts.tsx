"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { SpectraArtifact } from "@/features/spectra/data/api";
import { atRest } from "../../kit/build";
import { InlineStudio } from "../../kit/inline-studio";
import { Written } from "../../kit/written";
import { GALLERY } from "../../world/gallery";
import { dimAll, shine, travel } from "../light/light";
import { useLoop } from "../loop";
import { Scaled } from "../window";

/*
 * Every kind of work Spectra has an editor for, named down the left in large
 * type, and that editor open on the right: Spectra's own studio, with
 * something real from Henry's classes in it. The open name fills with its
 * colour from left to right and keeps it a moment; then the next kind opens,
 * so the list keeps its own time. A visitor can open any of them, and while
 * they are in the editor it waits.
 */

type Kind = { key: string; name: string; ink: string; hue: number; work: SpectraArtifact; full?: boolean };

const KINDS: Kind[] = [
  { key: "document", name: "Documents", ink: "#4f9fe6", hue: 4.2, work: GALLERY.document },
  { key: "slides", name: "Slides", ink: "#ffab4a", hue: 1, work: GALLERY.presentation },
  { key: "sheets", name: "Sheets", ink: "#48c997", hue: 3, work: GALLERY.sheets },
  { key: "quiz", name: "Quizzes", ink: "#ff647f", hue: 0.1, work: GALLERY.quiz },
  { key: "cards", name: "Flashcards", ink: "#9176e8", hue: 5.1, work: GALLERY.flashcard_deck },
  { key: "board", name: "Whiteboards", ink: "#e6bf2e", hue: 2, work: GALLERY.whiteboard, full: true },
  { key: "code", name: "Code", ink: "#4a4852", hue: 3.6, work: GALLERY.code },
];

export function Artifacts() {
  const sceneRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  /** Counts every opening, so the fill starts again even on the same name. */
  const [turn, setTurn] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [holding, setHolding] = useState(false);
  /** Every editor opened so far stays open behind the current one, so coming back to it is instant. */
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set([0]));
  const kind = KINDS[index]!;

  const open = (next: number) => {
    const at = (next + KINDS.length) % KINDS.length;
    setIndex(at);
    setSeen((was) => (was.has(at) ? was : new Set(was).add(at)));
    setTurn((count) => count + 1);
  };

  // The next editor opens out of sight while this one is read, once the scroll rests, so it is ready when its turn comes.
  useEffect(() => {
    if (!playing || seen.has(index + 1) || index + 1 >= KINDS.length) return;
    return atRest(() => setSeen((was) => new Set(was).add(index + 1)));
  }, [index, playing, seen]);

  // The fill only moves while the list is on screen.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const observer = new IntersectionObserver(([entry]) => setPlaying(Boolean(entry?.isIntersecting)), { threshold: 0.35 });
    observer.observe(scene);
    return () => observer.disconnect();
  }, []);

  // The open editor lies in its own colour.
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    shine("artifacts-card", { el: card, at: [0.62, 0.42], rx: 380, ry: 320, strength: 0.3, hues: [kind.hue - 0.6, kind.hue + 0.6], flow: 0.5, ease: 1300 });
  }, [kind.hue]);
  useEffect(() => () => dimAll("artifacts"), []);

  useLoop(sceneRef, {
    open: async ({ wait }) => {
      const title = sceneRef.current?.querySelector(".sp-heading");
      const card = cardRef.current;
      if (title && card) {
        const box = title.getBoundingClientRect();
        travel("artifacts-title", [box.left + box.width * 0.5, box.top + window.scrollY + box.height * 0.6], card, {
          at: [0.5, 0.3],
          rx: 420,
          ry: 220,
          strength: 0.36,
          hues: [0, 6],
          flow: 0.6,
          ease: 500,
          ms: 1500,
        });
        window.setTimeout(() => dimAll("artifacts-title", 1400), 1800);
      }
      await wait(400);
    },
  });

  return (
    <section ref={sceneRef} className="sp-scene sp-artifacts" aria-labelledby="sp-artifacts-title">
      <div className="sp-ed" data-playing={(playing && !holding) || undefined}>
        <div className="sp-ed-copy">
          <Written id="sp-artifacts-title" className="sp-heading" text={"Everything you'd open\nanother app for."} />
          <p className="sp-lede">All built in, all in your classes, and Spectra can work in every one of them beside you.</p>
          <nav className="sp-ed-list" aria-label="Editors">
            {KINDS.map((entry, at) => (
              <button
                key={entry.key}
                type="button"
                className="sp-ed-name"
                aria-current={at === index || undefined}
                style={{ "--kind": entry.ink } as CSSProperties}
                onClick={() => open(at)}
              >
                <i aria-hidden />
                <span key={at === index ? turn : undefined} data-text={entry.name} onAnimationEnd={at === index ? () => open(index + 1) : undefined}>
                  {entry.name}
                </span>
              </button>
            ))}
          </nav>
        </div>

        <div
          ref={cardRef}
          className="sp-ed-room"
          onPointerEnter={() => setHolding(true)}
          onPointerLeave={() => setHolding(false)}
          style={{ "--kind": kind.ink } as CSSProperties}
        >
          <Scaled width={900} height={700} least={0.7}>
            {KINDS.map((entry, at) =>
              seen.has(at) ? (
                <div key={entry.key} className="sp-ed-desk" data-kind={entry.key} data-open={at === index || undefined} inert={at !== index}>
                  <InlineStudio work={entry.work} instanceKey={`landing-editors-${entry.key}`} className="sp-studio" compact={!entry.full} />
                </div>
              ) : null,
            )}
          </Scaled>
        </div>
      </div>
    </section>
  );
}
