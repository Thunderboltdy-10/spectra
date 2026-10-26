"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PrismMode } from "@/features/spectra/life/prism";
import { HeroPrism, type PrismSlot } from "../kit/hero-prism";
import { DEADLINES } from "../world/school";
import { clock, dayName, STORY } from "../world/story";

/*
 * The first screen. Henry's evening is in nine places around the prism; the
 * moment the visitor scrolls, they are drawn into it, and the prism then flies
 * down into the island, where it lives for the rest of the page. The words
 * never change: the line says what Spectra is, the nine pieces show why.
 */


type Piece = { id: string; x: number; y: number; depth: number; tilt: number; body: React.ReactNode; label: string };

const test = DEADLINES.biologyTest;

/** Positions are around the prism, in fractions of the hero's art box. */
const PIECES: Piece[] = [
  {
    id: "notice",
    x: 0.16,
    y: 0.12,
    depth: 1,
    tilt: -2,
    label: "A school portal notification",
    body: (
      <div className="piece-notice">
        <span className="piece-notice-app">School portal</span>
        <strong>Biology SL: {test.title}</strong>
        <span>{dayName(test.startAt!)}, in class</span>
      </div>
    ),
  },
  {
    id: "file",
    x: 0.82,
    y: 0.1,
    depth: 0.8,
    tilt: 3,
    label: "A file called History IA final (2).docx",
    body: (
      <div className="piece-file">
        <span className="piece-file-icon" data-kind="doc" aria-hidden />
        <span>History IA - final (2).docx</span>
      </div>
    ),
  },
  {
    id: "chat",
    x: 0.9,
    y: 0.42,
    depth: 1,
    tilt: 1.5,
    label: "A group chat message",
    body: (
      <div className="piece-chat">
        <span className="piece-chat-group">DP1 Bio</span>
        <p>does anyone have the notes from friday</p>
        <span className="piece-chat-meta">Alex · 21:12</span>
      </div>
    ),
  },
  {
    id: "bot",
    x: 0.1,
    y: 0.5,
    depth: 0.9,
    tilt: -1,
    label: "A chatbot that cannot see your files",
    body: (
      <div className="piece-bot">
        <p className="piece-bot-ask">use my biology notes</p>
        <p className="piece-bot-answer">I don&rsquo;t have access to your files. Could you paste them here?</p>
      </div>
    ),
  },
  {
    id: "pdf",
    x: 0.78,
    y: 0.76,
    depth: 0.7,
    tilt: -3,
    label: "A scanned PDF in Downloads",
    body: (
      <div className="piece-file">
        <span className="piece-file-icon" data-kind="pdf" aria-hidden />
        <span>ch7_respiration_scan.pdf</span>
      </div>
    ),
  },
  {
    id: "sticky",
    x: 0.26,
    y: 0.82,
    depth: 0.85,
    tilt: 4,
    label: "A sticky note",
    body: <div className="piece-sticky">ask Ms Gonzalez about the second source!!</div>,
  },
  {
    id: "calendar",
    x: 0.58,
    y: 0.9,
    depth: 0.75,
    tilt: 1,
    label: "Another calendar",
    body: (
      <div className="piece-calendar">
        <span className="piece-calendar-day">Thu</span>
        <span>Bio test</span>
        <span>Maths set 4</span>
        <span>CAS meeting</span>
      </div>
    ),
  },
  {
    id: "mail",
    x: 0.5,
    y: 0.04,
    depth: 0.7,
    tilt: -1.5,
    label: "An email thread",
    body: (
      <div className="piece-mail">
        <strong>Re: Fwd: rubric (UPDATED, use this one)</strong>
        <span>3 attachments</span>
      </div>
    ),
  },
  {
    id: "folder",
    x: 0.06,
    y: 0.26,
    depth: 0.65,
    tilt: 2,
    label: "A cloud folder",
    body: (
      <div className="piece-folder">
        <span className="piece-folder-tab" aria-hidden />
        <span>School stuff (old)</span>
      </div>
    ),
  },
];

const ease = (t: number) => t * t * (3 - 2 * t);
const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function Hero({ onHanded }: { onHanded: (handed: boolean) => void }) {
  const sectionRef = useRef<HTMLElement>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const [gathered, setGathered] = useState(false);
  const [mode, setMode] = useState<PrismMode>("rest");
  const [travelling, setTravelling] = useState(false);
  const [turns, setTurns] = useState(0);
  const travel = useRef(0);

  // The first scroll, however small, gathers the evening into the prism.
  useEffect(() => {
    if (gathered) return;
    const gather = () => setGathered(true);
    const onScroll = () => window.scrollY > 2 && gather();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", gather, { passive: true, once: true });
    window.addEventListener("touchmove", gather, { passive: true, once: true });
    if (window.scrollY > 2) gather();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", gather);
      window.removeEventListener("touchmove", gather);
    };
  }, [gathered]);

  // As the pieces arrive the prism works through them, then settles.
  useEffect(() => {
    if (!gathered) return;
    setMode("working");
    const settle = window.setTimeout(() => setMode("rest"), 2600);
    return () => window.clearTimeout(settle);
  }, [gathered]);

  /** Where the prism is: the hero's middle, carried to the island's prism as the page scrolls. */
  const slot = useCallback((): PrismSlot | null => {
    const art = artRef.current;
    if (!art) return null;
    const box = art.getBoundingClientRect();
    const from = { x: box.left + box.width * 0.5, y: box.top + box.height * 0.5, size: Math.min(box.width * 0.42, box.height * 0.5, 340) };
    const t = ease(travel.current);
    if (t <= 0) return from;
    const home = document.querySelector("[data-landing-island] [data-island-home]")?.getBoundingClientRect();
    const to = home && home.width ? { x: home.left + home.width / 2, y: home.top + home.height / 2, size: 24 } : { x: window.innerWidth / 2, y: window.innerHeight - 40, size: 24 };
    // Size shrinks geometrically, so the flight reads as moving away, not deflating.
    const size = from.size * Math.pow(to.size / from.size, t);
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, size };
  }, []);

  // The flight is scrubbed by the scroll, because it is a move and not content.
  useEffect(() => {
    let raf = 0;
    let wasLanded = false;
    let wasTravelling = false;
    const measure = () => {
      raf = 0;
      const section = sectionRef.current;
      if (!section) return;
      const height = window.innerHeight;
      const t = clamp((window.scrollY - height * 0.18) / (height * 0.95));
      travel.current = t;
      const copy = copyRef.current;
      if (copy) {
        copy.style.opacity = String(1 - clamp(t * 2.2));
        copy.style.transform = `translate3d(0, ${(-30 * clamp(t * 2)).toFixed(1)}px, 0)`;
      }
      const nowTravelling = t > 0.02;
      if (nowTravelling !== wasTravelling) {
        wasTravelling = nowTravelling;
        setTravelling(nowTravelling);
        // It turns once as it leaves, and once more when it comes back.
        setTurns((count) => count + 1);
      }
      const nowLanded = t >= 0.985;
      if (nowLanded !== wasLanded) {
        wasLanded = nowLanded;
        // The island's own prism takes over where the big one lands.
        const root = section.closest<HTMLElement>(".landing-root");
        if (root) root.dataset.prism = nowLanded ? "island" : "hero";
      }
      onHanded(t > 0.6);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [onHanded]);

  return (
    <section data-stage="hero" ref={sectionRef} className="landing-hero" aria-labelledby="hero-title" data-gathered={gathered || undefined}>
      <div className="landing-hero-pin">
        <div ref={copyRef} className="landing-hero-copy">
          <p className="landing-hero-when">
            {gathered ? "Now it is in one." : `Tonight, ${clock(STORY.evening)}. Henry’s schoolwork is in nine places.`}
          </p>
          <h1 id="hero-title" className="landing-hero-title">
            All your schoolwork, in one place.
          </h1>
          <p className="landing-hero-lede">
            Your classes, deadlines, files and everything you make, on the web and on your own computer, with an AI that has
            already read all of it.
          </p>
          <div className="landing-hero-actions">
            <a href="#door" className="landing-button" data-tone="primary">
              Ask for a walkthrough
            </a>
            <Link href="/sign-in" className="landing-button">
              Sign in
            </Link>
          </div>
        </div>
        <div ref={artRef} className="landing-hero-art" aria-hidden>
          {PIECES.map((piece, index) => (
            <div
              key={piece.id}
              className="landing-piece"
              aria-label={piece.label}
              style={
                {
                  "--x": piece.x,
                  "--y": piece.y,
                  "--depth": piece.depth,
                  "--tilt": `${piece.tilt}deg`,
                  "--order": index,
                } as React.CSSProperties
              }
            >
              {piece.body}
            </div>
          ))}
        </div>
      </div>
      {/* One prism on the page, carried from here to the island. */}
      <div className="landing-glass" aria-hidden>
        <HeroPrism slot={slot} mode={mode} interactive={!travelling} turns={turns} />
      </div>
    </section>
  );
}
