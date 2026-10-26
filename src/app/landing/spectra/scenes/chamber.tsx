"use client";

import { motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from "framer-motion";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import type { PrismMode } from "@/features/spectra/life/prism";
import { LivePrism } from "../prism";
import { RevealLine } from "../reveal-line";
import { useArrived, useWide } from "../use-motion";
import { FLASHCARD, NOTES, QUIZ } from "../world";

/*
 * Inside the prism. The page goes dark as the reader steps into it (the dark
 * opens from the prism's own outline), a page of biology notes slides in and
 * disappears into the glass, and five colours leave the other side: a deck,
 * a quiz, flashcards, a mind map and a table, each one the same notes made
 * into something else. The quiz can be answered and the card turned over.
 *
 * The scene is scrubbed by scrolling, at the reader's own speed; on narrow
 * screens it is laid out as a plain column instead.
 */

const RAYS = [
  { hue: "#ff8a6b", x: 69, y: 26 },
  { hue: "#ff647f", x: 87, y: 39 },
  { hue: "#9176e8", x: 69, y: 53 },
  { hue: "#4f9fe6", x: 87, y: 66 },
  { hue: "#48c997", x: 69, y: 79 },
];
const PRISM_AT = { x: 38, y: 52 };
/** Where the light comes in, at the top of the stage. */
const ENTRY_X = 47;
/** Rays are drawn with screen-pixel dashes: non-scaling strokes ignore pathLength. */
const RAY_DASH = 1800;

/** The dark opens from the prism's outline and closes back into it. */
function outline(t: number) {
  const k = Math.max(0, Math.min(1, t));
  const e = 1 - Math.pow(1 - k, 3);
  const mix = (from: [number, number], to: [number, number]) => `${(from[0] + (to[0] - from[0]) * e).toFixed(2)}% ${(from[1] + (to[1] - from[1]) * e).toFixed(2)}%`;
  return `polygon(${[
    mix([PRISM_AT.x, 30], [0, 0]),
    mix([PRISM_AT.x, 30], [50, 0]),
    mix([PRISM_AT.x, 30], [100, 0]),
    mix([PRISM_AT.x + 13, 70], [100, 100]),
    mix([PRISM_AT.x, 70], [50, 100]),
    mix([PRISM_AT.x - 13, 70], [0, 100]),
  ].join(", ")})`;
}

export function Chamber() {
  const wide = useWide(900);
  return wide ? <ChamberScrubbed /> : <ChamberColumn />;
}

function ChamberScrubbed() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start end", "end start"] });
  // The section is 340vh: progress runs from its top entering to its bottom leaving, so the stage holds from 0.23 to 0.77.
  const clip = useTransform(p, (value) => outline(Math.min((value - 0.03) / 0.2, (0.87 - value) / 0.1)));
  const notesX = useTransform(p, [0.24, 0.4], ["-34vw", "0vw"]);
  const notesScale = useTransform(p, [0.24, 0.37, 0.43], [1, 0.8, 0.1]);
  const notesOpacity = useTransform(p, [0.22, 0.26, 0.4, 0.44], [0, 1, 1, 0]);
  const notesTilt = useTransform(p, [0.24, 0.43], [-8, 18]);
  const beamIn = useTransform(p, [0.2, 0.3], [RAY_DASH, 0]);
  const [mode, setMode] = useState<PrismMode>("rest");
  const [turns, setTurns] = useState(0);
  const [lit, setLit] = useState(0);
  const turnedRef = useRef(false);
  useMotionValueEvent(p, "change", (value) => {
    const next: PrismMode = value > 0.42 && value < 0.5 ? "working" : value >= 0.5 ? "done" : "rest";
    setMode((current) => (current === next ? current : next));
    if (value > 0.42 && !turnedRef.current) {
      turnedRef.current = true;
      setTurns((count) => count + 1);
    }
    if (value < 0.3) turnedRef.current = false;
    const count = RAYS.filter((_, index) => value > 0.5 + index * 0.03).length;
    setLit((current) => (current === count ? current : count));
  });
  const lineOn = lit >= RAYS.length;

  return (
    <section ref={ref} id="sp-chamber" className="sp-chamber" aria-label="Your notes, made into five kinds of revision">
      <span className="sp-chamber-door" data-beam="top" aria-hidden />
      <motion.div className="sp-chamber-stage" style={{ clipPath: clip }}>
        <div className="sp-chamber-glow" aria-hidden />
        <svg className="sp-chamber-rays" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="sp-chamber-in" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.95" />
            </linearGradient>
          </defs>
          <motion.line
            x1={ENTRY_X}
            y1="0"
            x2={PRISM_AT.x}
            y2={PRISM_AT.y}
            stroke="url(#sp-chamber-in)"
            strokeWidth="2.4"
            vectorEffect="non-scaling-stroke"
            strokeDasharray={RAY_DASH}
            style={{ strokeDashoffset: beamIn }}
          />
          {RAYS.map((ray, index) => (
            <line
              key={index}
              x1={PRISM_AT.x}
              y1={PRISM_AT.y}
              x2={ray.x - 9}
              y2={ray.y}
              stroke={ray.hue}
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
              strokeDasharray={RAY_DASH}
              className="sp-chamber-ray"
              data-lit={index < lit || undefined}
            />
          ))}
        </svg>

        <motion.div className="sp-chamber-notes" style={{ x: notesX, scale: notesScale, opacity: notesOpacity, rotate: notesTilt }} aria-hidden>
          <NotesPage />
        </motion.div>

        <div className="sp-chamber-prism" style={{ left: `${PRISM_AT.x}%`, top: `${PRISM_AT.y}%` }}>
          <LivePrism width="clamp(260px, 30vw, 440px)" mode={mode} turns={turns} palette="dark" interactive />
        </div>

        {RAYS.map((ray, index) => (
          <div key={index} className="sp-chamber-work" data-lit={index < lit || undefined} style={{ left: `${ray.x}%`, top: `${ray.y}%`, "--ray": ray.hue } as CSSProperties}>
            {WORKS[index]}
          </div>
        ))}

        <div className="sp-chamber-line">
          <RevealLine as="p" on={lineOn} text="Give it your notes." className="sp-chamber-say" />
          <RevealLine as="p" on={lineOn} text="Learn them any way you like." className="sp-chamber-say" delay={5} />
        </div>
        <Progress p={p} />
      </motion.div>
      <span className="sp-chamber-exit" data-beam="bottom" aria-hidden />
    </section>
  );
}

function Progress({ p }: { p: MotionValue<number> }) {
  const width = useTransform(p, [0.23, 0.77], [0, 1]);
  return (
    <div className="sp-chamber-progress" aria-hidden>
      <motion.span style={{ scaleX: width }} />
    </div>
  );
}

function ChamberColumn() {
  const ref = useRef<HTMLElement>(null);
  const on = useArrived(ref);
  return (
    <section ref={ref} id="sp-chamber" className="sp-chamber sp-chamber--column" data-on={on || undefined} aria-label="Your notes, made into five kinds of revision">
      <div className="sp-chamber-line">
        <RevealLine as="p" on={on} text="Give it your notes." className="sp-chamber-say" />
        <RevealLine as="p" on={on} text="Learn them any way you like." className="sp-chamber-say" delay={5} />
      </div>
      <div className="sp-chamber-notes">
        <NotesPage />
      </div>
      <div className="sp-chamber-prism">
        <LivePrism width="200px" mode={on ? "done" : "rest"} turns={on ? 1 : 0} palette="dark" interactive />
      </div>
      <div className="sp-chamber-works">
        {WORKS.map((work, index) => (
          <div key={index} className="sp-chamber-work" data-lit={on || undefined} style={{ "--ray": RAYS[index].hue } as CSSProperties}>
            {work}
          </div>
        ))}
      </div>
    </section>
  );
}

function NotesPage() {
  return (
    <div className="sp-notes">
      <span className="sp-notes-place">{NOTES.place}</span>
      <p className="sp-notes-title">{NOTES.title}</p>
      {NOTES.blocks.map((block) => (
        <div key={block.heading} className="sp-notes-block">
          <p className="sp-notes-heading">{block.heading}</p>
          {block.lines.map((line) => (
            <p key={line} className="sp-notes-line">
              {line}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

function Work({ glyph, label, hue, children }: { glyph: IconName; label: string; hue: string; children: ReactNode }) {
  return (
    <div className="sp-work" style={{ "--work-hue": hue } as CSSProperties}>
      <span className="sp-work-tab">
        <Icon name={glyph} size={13} />
        {label}
      </span>
      <div className="sp-work-face">{children}</div>
    </div>
  );
}

function SlidesWork() {
  return (
    <Work glyph="slides" label="Slides" hue="var(--type-slides)">
      <div className="sp-slide">
        <p className="sp-slide-title">Glycolysis</p>
        <div className="sp-slide-flow">
          <span>Glucose</span>
          <Icon name="arrowRight" size={14} />
          <span>2 pyruvate</span>
        </div>
        <div className="sp-slide-chips">
          <span>+2 ATP</span>
          <span>+2 NADH</span>
          <span>cytoplasm</span>
        </div>
      </div>
      <span className="sp-work-foot">Slide 1 of 8</span>
    </Work>
  );
}

function QuizWork() {
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <Work glyph="quiz" label="Quiz" hue="var(--type-quiz)">
      <p className="sp-quiz-q">{QUIZ.question}</p>
      <div className="sp-quiz-options" role="group" aria-label={QUIZ.question}>
        {QUIZ.options.map((option, index) => (
          <button
            key={option}
            type="button"
            className="sp-quiz-option"
            data-state={picked === null ? undefined : index === QUIZ.answer ? "right" : index === picked ? "wrong" : "rest"}
            onClick={() => setPicked(index)}
          >
            {option}
            {picked !== null && index === QUIZ.answer ? <Icon name="check" size={13} /> : null}
          </button>
        ))}
      </div>
      <span className="sp-work-foot">{picked === null ? "Question 1 of 12 · pick one" : picked === QUIZ.answer ? "Right. Before anything reaches a mitochondrion." : "Not quite. It happens in the cytoplasm."}</span>
    </Work>
  );
}

function CardWork() {
  const [flipped, setFlipped] = useState(false);
  return (
    <Work glyph="flashcards" label="Flashcards" hue="var(--type-flashcards)">
      <button type="button" className="sp-flash" data-flipped={flipped || undefined} onClick={() => setFlipped((current) => !current)} aria-label={flipped ? "Show the front" : "Turn the card over"}>
        <span className="sp-flash-side" data-side="front">
          {FLASHCARD.front}
        </span>
        <span className="sp-flash-side" data-side="back">
          {FLASHCARD.back}
        </span>
      </button>
      <span className="sp-work-foot">{flipped ? "Card 4 of 30" : "Press to turn it over"}</span>
    </Work>
  );
}

function MapWork() {
  const branches = [
    { x: 22, y: 22, text: "Glycolysis" },
    { x: 80, y: 20, text: "Krebs cycle" },
    { x: 20, y: 80, text: "Link reaction" },
    { x: 80, y: 80, text: "ETC" },
  ];
  return (
    <Work glyph="whiteboard" label="Mind map" hue="var(--type-whiteboard)">
      <div className="sp-map">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {branches.map((branch) => (
            <path key={branch.text} d={`M 50 50 Q ${(50 + branch.x) / 2} ${branch.y < 50 ? 50 : 50}, ${branch.x} ${branch.y}`} />
          ))}
        </svg>
        <span className="sp-map-node" data-root style={{ left: "50%", top: "50%" }}>
          Respiration
        </span>
        {branches.map((branch) => (
          <span key={branch.text} className="sp-map-node" style={{ left: `${branch.x}%`, top: `${branch.y}%` }}>
            {branch.text}
          </span>
        ))}
      </div>
    </Work>
  );
}

function SheetWork() {
  const rows = [
    ["Stage", "Where", "ATP"],
    ["Glycolysis", "Cytoplasm", "2"],
    ["Krebs cycle", "Matrix", "2"],
    ["ETC", "Inner membrane", "~34"],
  ];
  return (
    <Work glyph="sheet" label="Table" hue="var(--type-sheets)">
      <div className="sp-sheet">
        {rows.map((row, index) => (
          <div key={index} className="sp-sheet-row" data-head={index === 0 || undefined}>
            {row.map((cell) => (
              <span key={cell}>{cell}</span>
            ))}
          </div>
        ))}
        <div className="sp-sheet-row" data-total>
          <span>Total</span>
          <span />
          <span>~38</span>
        </div>
      </div>
    </Work>
  );
}

const WORKS = [<SlidesWork key="slides" />, <QuizWork key="quiz" />, <CardWork key="card" />, <MapWork key="map" />, <SheetWork key="sheet" />];
