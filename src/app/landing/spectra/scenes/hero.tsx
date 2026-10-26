"use client";

import Link from "next/link";
import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "@/components/icons";
import type { PrismMode } from "@/features/spectra/life/prism";
import { AppWindow, Scaled, type HomeState, type IslandState } from "../app-window";
import { LivePrism } from "../prism";
import { greetingFor, prefersStill, useWeekdays, useWide } from "../use-motion";
import { HERO_RUN, SCATTER, SUGGESTED_RUNS, type IslandRun } from "../world";

/*
 * The first thing on the page. A school evening arrives in pieces (a
 * deadline, a stray Word file, a flashcard, the group chat) and they fall
 * into one window. The arrival is pure CSS, so it plays before the page
 * has even hydrated; then Maya asks Spectra to get her ready for a test, and
 * the window fills in front of the reader: a plan in her week, a quiz and a
 * deck of flashcards on her desk.
 */

const TITLE = "All your schoolwork, in one place.";

const SCATTER_GLYPH: Record<(typeof SCATTER)[number]["kind"], IconName> = {
  deadline: "school",
  file: "document",
  card: "flashcards",
  chat: "conversations",
  note: "edit",
  slot: "calendar",
  slide: "slides",
};

const fill = (text: string, day: string) => text.replaceAll("{day}", day);

export function Hero() {
  const heroRef = useRef<HTMLElement>(null);
  const wide = useWide(760);
  const week = useWeekdays();
  const testDay = week.long[3];

  const [island, setIsland] = useState<IslandState>({ phase: "idle" });
  const [plans, setPlans] = useState<HomeState["plans"]>([]);
  const [made, setMade] = useState<HomeState["made"]>([]);
  const [mode, setMode] = useState<PrismMode>("rest");
  const [turns, setTurns] = useState(0);
  const [played, setPlayed] = useState(false);
  const tokenRef = useRef(0);

  const play = useCallback(
    async (run: IslandRun) => {
      const token = ++tokenRef.current;
      const still = prefersStill();
      const alive = () => tokenRef.current === token;
      const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, still ? 0 : ms));
      const ask = fill(run.ask, testDay);
      setMode("thinking");
      if (still) setIsland({ phase: "typing", text: ask });
      else
        for (let index = 1; index <= ask.length; index += 1) {
          if (!alive()) return;
          setIsland({ phase: "typing", text: ask.slice(0, index) });
          await wait(index % 7 === 0 ? 70 : 30);
        }
      await wait(420);
      if (!alive()) return;
      setTurns((count) => count + 1);
      setMode("working");
      const cards = run.cards ?? [];
      const firstCard = run.steps.length - cards.length;
      for (let step = 0; step < run.steps.length; step += 1) {
        setIsland({ phase: "working", run, done: step });
        await wait(980);
        if (!alive()) return;
        if (step === Math.min(1, run.steps.length - 1)) {
          for (const plan of run.plans ?? []) {
            setPlans((current) => (current.some((entry) => entry.item.id === plan.item.id) ? current : [...current, plan]));
            await wait(240);
          }
        }
        const card = cards[step - firstCard];
        if (card) setMade((current) => [card, ...current.filter((entry) => entry.id !== card.id)]);
      }
      if (!alive()) return;
      setTurns((count) => count + 1);
      setMode("done");
      setIsland(run.reply ? { phase: "reply", run } : { phase: "done", run });
      await wait(run.reply ? 6200 : 2800);
      if (!alive()) return;
      setMode("rest");
      setIsland({ phase: "idle", notice: run.notice });
    },
    [testDay],
  );

  // The demo starts once the window has landed, and only if the hero is still in view.
  useEffect(() => {
    if (played) return;
    const still = prefersStill();
    const timer = window.setTimeout(
      () => {
        const rect = heroRef.current?.getBoundingClientRect();
        if (rect && rect.bottom < 0) return;
        setPlayed(true);
        void play(HERO_RUN);
      },
      still ? 0 : 2700,
    );
    return () => window.clearTimeout(timer);
  }, [play, played]);

  const onIsland = () => {
    if (island.phase === "typing" || island.phase === "working") return;
    tokenRef.current += 1;
    setMode("rest");
    setIsland(island.phase === "choosing" ? { phase: "idle" } : { phase: "choosing" });
  };

  // The window starts tilted back on its desk and comes upright as you scroll into it.
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const eased = useSpring(scrollYProgress, { stiffness: 120, damping: 26 });
  const tilt = useTransform(eased, [0, 0.32], [11, 0]);
  const lift = useTransform(eased, [0, 0.32], [0.95, 1]);
  const drop = useTransform(eased, [0, 0.4], [0, -36]);

  const home: HomeState = {
    greeting: greetingFor(week.hour),
    days: week,
    testDay,
    plans,
    made,
  };

  return (
    <section ref={heroRef} className="sp-hero" aria-labelledby="sp-hero-title">
      <div className="sp-hero-copy">
        <h1 id="sp-hero-title" className="sp-hero-title" aria-label={TITLE}>
          {TITLE.split(" ").map((word, index) => (
            <span key={index} className="sp-hero-word" aria-hidden style={{ "--i": index } as CSSProperties}>
              <span>{word}</span>
            </span>
          ))}
        </h1>
        <p className="sp-hero-sub">
          Classes, notes, files and deadlines live together in Spectra, with an AI that knows all of it and works right beside you.
        </p>
        <div className="sp-hero-actions">
          <Link href="/contact" className="landing-button" data-tone="primary">
            Talk to us
          </Link>
          <a href="#sp-chamber" className="landing-button" data-tone="quiet">
            See what it does
          </a>
        </div>
      </div>

      <div className="sp-hero-stage">
        <div className="sp-scatter" aria-hidden>
          {SCATTER.map((piece, index) => (
            <span
              key={index}
              className="sp-scatter-piece"
              data-kind={piece.kind}
              style={{ "--x": piece.x, "--y": piece.y, "--r": `${piece.r}deg`, "--i": index } as CSSProperties}
            >
              <span className="sp-scatter-face">
                <Icon name={SCATTER_GLYPH[piece.kind]} size={15} />
                <span>
                  <span className="sp-scatter-text">{piece.text}</span>
                  {piece.meta ? <span className="sp-scatter-meta">{piece.meta}</span> : null}
                </span>
              </span>
            </span>
          ))}
        </div>

        <motion.div className="sp-hero-desk" style={{ rotateX: tilt, scale: lift, y: drop }}>
          <div className="sp-hero-window">
            <Scaled width={wide ? 1200 : 640} height={wide ? 760 : 900}>
              <AppWindow
                home={home}
                island={island}
                prismMode={mode}
                compact={!wide}
                onIsland={onIsland}
                onChoose={(run) => void play(run)}
                suggestions={SUGGESTED_RUNS}
              />
            </Scaled>
          </div>
          <div className="sp-hero-fan" data-mode={mode} aria-hidden>
            <svg viewBox="0 0 1000 600" preserveAspectRatio="none">
              {["#ff647f", "#ffab4a", "#f6d75d", "#48c997", "#4f9fe6", "#9176e8"].map((hue, index) => (
                <polygon key={hue} points={`1000,0 ${-40 + index * 58},600 ${18 + index * 58},600`} fill={hue} />
              ))}
            </svg>
          </div>
        </motion.div>

        <div className="sp-hero-prism" data-beam>
          <LivePrism width="clamp(150px, 17vw, 270px)" mode={mode} turns={turns} interactive label="Spectra's prism. Drag it to spin it." />
        </div>
      </div>

      <p className="sp-hero-hint" data-shown={island.phase === "idle" && Boolean(island.notice) ? true : undefined}>
        <Icon name="pointer" size={14} />
        Press the bar at the bottom of the window to ask something else.
      </p>
    </section>
  );
}
