"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ShowcaseTime } from "@/features/spectra/showcase/showcase-time";
import { skyAt, skyColours } from "@/features/spectra/today/day-sky";
import { TodayBrief } from "@/features/spectra/today/today-brief";
import type { BriefState } from "@/features/spectra/today/use-daily-brief";
import { Written } from "../../kit/written";
import { DAYS, DEADLINES } from "../../world/school";
import { dayAt, dayName } from "../../world/story";
import { WORKS } from "../../world/works";
import { PEOPLE, useHands } from "../hands";
import { dimAll, flash, shine, travel } from "../light/light";
import { useLoop, type Beat } from "../loop";
import { Window } from "../window";

/*
 * Henry's days, one after another, under the whole sky. The section opens on a
 * morning, in the paper's own light, with the day's brief written. The clock
 * never stops: he does the brief's moves one by one as the sun crosses, it
 * sets in a glow, the moon and the stars come out, Spectra writes the next
 * brief in the night, and the sun comes up on it. The moves are his to press,
 * not the reader's. Scrolled away, the sky hurries on to the first morning
 * and waits there, so it always meets the page in daylight.
 */

const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;
/** Where the section starts and comes back to: mid-morning, when the sky is nearest the paper. */
const START = 8 * 60 + 40;

type Day = { offset: number; recap: string; moves: Array<{ kind: "make" | "open" | "task" | "ask"; title: string; why: string; workType?: string; targetId?: string; steps?: string[] }> };

const source = DEADLINES.sourceAnalysis;
const test = DEADLINES.biologyTest;

const DAYS_SHOWN: Day[] = [
  {
    offset: DAYS.tomorrow,
    recap: "You finished the yeast lab results and Spectra made you a quiz, cards and slides for the Biology test.",
    moves: [
      { kind: "open", title: "Do the cell respiration quiz", why: "Your notes are thinnest on the electron transport chain, and the quiz starts there.", workType: "quiz", targetId: WORKS.quiz._id },
      { kind: "task", title: "Read the two sources", why: `The first step of the source analysis, due ${source.startAt ? dayName(source.startAt) : "soon"}.` },
      { kind: "make", title: "Flashcards for the Spanish oral", why: "Vocabulary for el medio ambiente, from your notes.", workType: "flashcard_deck" },
    ],
  },
  {
    offset: DAYS.biologyTest,
    recap: "You did the quiz twice and got all five the second time. Both sources are read, with notes on each.",
    moves: [
      { kind: "open", title: "Run through the respiration cards", why: `The test is ${test.startAt ? `at ${new Date(test.startAt).getHours()}:${String(new Date(test.startAt).getMinutes()).padStart(2, "0")}` : "today"}; ten minutes is enough.`, workType: "flashcard_deck", targetId: WORKS.cards._id },
      { kind: "task", title: "Write the source analysis", why: "Origin, purpose and content for each source, then one value and one limitation." },
      { kind: "ask", title: "Plan the English essay", why: "Nothing is started yet and it is due next week." },
    ],
  },
  {
    offset: DAYS.sourceAnalysis,
    recap: "The Biology test is behind you. The source analysis is at 420 of 600 words, with the limitations still to write.",
    moves: [
      { kind: "task", title: "Finish the source analysis", why: "The limitation of Wels's speech is the part left. It is due today." },
      { kind: "open", title: "Reply to Ms Gonzalez's comment", why: "She answered on your IA's second source.", workType: "document", targetId: WORKS.ia._id },
      { kind: "task", title: "Write up the yeast lab", why: "Your results are in the sheet; the method and evaluation are left." },
    ],
  },
];

const weekday = (offset: number) => new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(dayAt(offset, 12));
/** The days go on, each the next date; their briefs take turns. */
const FIRST = DAYS_SHOWN[0]!.offset;
const WEEK = Array.from({ length: 7 }, (_, index) => weekday(FIRST + index));
/** How often, in sky minutes, Home's own clock is told the time: the sky itself moves every frame. */
const TOLD = 30;

/** Where the sky's arc runs: the horizon line and the top of the arc, from the top of the sky, and its width. */
type Arc = { width: number; horizon: number; apex: number };

export function Day() {
  const sceneRef = useRef<HTMLElement>(null);
  const skyRef = useRef<HTMLDivElement>(null);
  const homeRef = useRef<HTMLDivElement>(null);
  const heavenRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const placeRef = useRef<HTMLDivElement>(null);
  const { layer, hand } = useHands();
  /** How many days on from the first; never wraps, so the dates keep going. */
  const [at, setAt] = useState(0);
  /** The sky's minute, to the fraction: it is painted straight onto the page every frame, never through a render. */
  const now = useRef(START);
  /** The minute as Home is told it, and which body is up: the only parts of the clock that render. */
  const [clock, setClock] = useState(START);
  const [body, setBody] = useState(skyAt(START).body);
  const arcRef = useRef<Arc | null>(null);
  /** Counts each time the scene is left; a round that began before stops where it is. */
  const left = useRef(0);
  const [written, setWritten] = useState(true);
  const [done, setDone] = useState(0);
  const [arc, setArc] = useState<Arc | null>(null);

  const day = DAYS_SHOWN[at % DAYS_SHOWN.length]!;
  const offset = FIRST + at;
  const time = dayAt(offset, 0) + clock * MINUTE;
  const brief: BriefState = useMemo(
    () =>
      written
        ? {
            status: "ready",
            day: new Date(dayAt(offset, 12)).toISOString().slice(0, 10),
            wakeTime: "07:00",
            recap: day.recap,
            suggestions: day.moves.map((move, index) => ({ ...move, done: index < done })),
          }
        : { status: "writing", wakeTime: "07:00" },
    [day, done, offset, written],
  );

  /** Paints the sky at a minute: the body on its arc, the colours, the dark. */
  const draw = (minute: number) => {
    now.current = minute;
    const scene = sceneRef.current;
    const arc = arcRef.current;
    const up = skyAt(((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES);
    const sky = skyColours(minute);
    if (scene) {
      scene.style.setProperty("--sky-top", sky.top);
      scene.style.setProperty("--sky-horizon", sky.horizon);
      scene.style.setProperty("--sky-land", sky.land);
      scene.style.setProperty("--sky-glow", sky.glow);
      scene.style.setProperty("--night", String(sky.night));
      // How near the horizon the body is: its glow spreads as it sinks.
      scene.style.setProperty("--low", String(up.body === "sun" ? Math.pow(1 - Math.sin(Math.PI * up.across), 2) : 0.15));
      if (sky.night > 0.3) scene.dataset.dark = "";
      else delete scene.dataset.dark;
    }
    if (arc) {
      const transform = `translate(${(0.07 + 0.86 * up.across) * arc.width}px, ${arc.horizon - (arc.horizon - arc.apex) * Math.sin(Math.PI * up.across)}px)`;
      if (glowRef.current) glowRef.current.style.transform = transform;
      if (placeRef.current) placeRef.current.style.transform = transform;
    }
    setBody(up.body);
    setClock((was) => (Math.floor(was / TOLD) === Math.floor(minute / TOLD) ? was : Math.floor(minute / TOLD) * TOLD));
  };

  // The arc is measured from the page: it rises from beside the brief and tops out under the heading.
  useLayoutEffect(() => {
    const sky = skyRef.current;
    const home = homeRef.current;
    const heaven = heavenRef.current;
    if (!sky || !home || !heaven) return;
    const measure = () => {
      const room = sky.getBoundingClientRect();
      const card = home.getBoundingClientRect();
      const open = heaven.getBoundingClientRect();
      arcRef.current = { width: room.width, horizon: card.top - room.top + card.height * 0.42, apex: open.top - room.top + open.height * 0.42 };
      setArc(arcRef.current);
      draw(now.current);
    };
    measure();
    const sized = new ResizeObserver(measure);
    sized.observe(sky);
    sized.observe(home);
    return () => sized.disconnect();
  }, []);

  // The light sits on the sun (or the moon), wherever it is on its arc.
  useEffect(() => {
    const glyph = bodyRef.current;
    if (!glyph) return;
    shine("day-body", {
      el: glyph,
      rx: body === "sun" ? 170 : 110,
      ry: body === "sun" ? 170 : 110,
      strength: body === "sun" ? 0.55 : 0.35,
      hues: body === "sun" ? [2.15, 1.05] : [4.4, 5.3],
      flow: 0.4,
      disc: true,
      ease: 900,
    });
  }, [body]);
  useEffect(() => () => dimAll("day"), []);

  // Scrolled away, the sky goes on quickly to the first morning and holds it there.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) return;
        left.current += 1;
        window.cancelAnimationFrame(frame);
        setAt(0);
        setDone(0);
        setWritten(true);
        const from = now.current % DAY_MINUTES;
        const to = from > START ? START + DAY_MINUTES : START;
        const begun = performance.now();
        const step = () => {
          const t = Math.min(1, (performance.now() - begun) / 700);
          draw(t < 1 ? from + (to - from) * (1 - (1 - t) ** 3) : START);
          if (t < 1) frame = window.requestAnimationFrame(step);
        };
        step();
      },
      { threshold: 0.38 },
    );
    observer.observe(scene);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  /**
   * Moves the clock on from where it is to another minute over `ms`, evenly
   * and on every frame, so the day never stops or steps. It holds while the
   * scene is out of view.
   */
  const pass = (to: number, ms: number, { signal }: Beat, since: number) =>
    new Promise<void>((resolve) => {
      const from = now.current;
      let spent = 0;
      let last = performance.now();
      const step = (stamp: number) => {
        if (signal.aborted || left.current !== since) return resolve();
        if (sceneRef.current?.dataset.visible !== "false") spent += stamp - last;
        last = stamp;
        const t = Math.min(1, spent / ms);
        draw(from + (to - from) * t);
        if (t < 1) window.requestAnimationFrame(step);
        else resolve();
      };
      window.requestAnimationFrame(step);
    });

  /** Henry does the first move still to do: his hand goes to it and presses. */
  const doMove = async (count: number, beat: Beat, since: number) => {
    const move = homeRef.current?.querySelector<HTMLElement>(".morning-move:not([data-done]) .morning-move-action");
    if (!move) return void setDone(count);
    const henry = hand(PEOPLE.henry, beat.signal);
    await henry.show(move);
    if (left.current === since) {
      await henry.press();
      if (left.current === since) {
        setDone(count);
        const row = move.closest<HTMLElement>(".morning-move");
        if (row) flash({ el: row, rx: 260, ry: 60, strength: 0.4, hues: [3, 3.9], hold: 500 });
      }
      await beat.wait(200);
    }
    await henry.hide();
    henry.remove();
  };

  useLoop(sceneRef, {
    open: async ({ wait }) => {
      const title = sceneRef.current?.querySelector(".sp-heading");
      const home = homeRef.current;
      if (title && home) {
        const box = title.getBoundingClientRect();
        travel("day-title", [box.left + box.width * 0.5, box.top + window.scrollY + box.height * 0.5], home, {
          at: [0.5, 0.3],
          rx: 380,
          ry: 200,
          strength: 0.3,
          hues: [1, 2.4],
          flow: 0.5,
          ease: 500,
          ms: 1500,
        });
        window.setTimeout(() => dimAll("day-title", 1500), 1900);
      }
      await wait(300);
    },
    round: async (beat) => {
      const since = left.current;
      const going = () => !beat.signal.aborted && left.current === since;
      // The days go on for as long as the reader watches.
      for (let index = 0; going(); index += 1) {
        // Each day but the first morning starts in the night: Spectra writes its brief before the sun is up.
        if (now.current >= 12 * 60) {
          if (now.current >= DAY_MINUTES) draw(now.current - DAY_MINUTES);
          setAt(index);
          setDone(0);
          setWritten(false);
          await pass(6 * 60 + 20, 900, beat, since);
          if (!going()) return;
          setWritten(true);
          await pass(START, 700, beat, since);
          if (!going()) return;
        } else setAt(index);
        // Through the day the moves are done one by one, while the sun keeps crossing.
        const sunset = pass(19 * 60 + 30, 4200, beat, since);
        for (let count = 1; count <= DAYS_SHOWN[index % DAYS_SHOWN.length]!.moves.length && going(); count += 1) {
          // Morning, after lunch, after school.
          while (going() && now.current < [10 * 60, 13 * 60, 16 * 60][count - 1]!) await beat.wait(48);
          await doMove(count, beat, since);
        }
        await sunset;
        if (!going()) return;
        // The sun goes down in a glow and the moon comes up over the day that was.
        await pass(DAY_MINUTES, 1200, beat, since);
      }
    },
  });

  return (
    <section
      ref={sceneRef}
      className="sp-scene sp-day"
      aria-labelledby="sp-day-title"
      // The sky's colours and the dark are painted on by `draw`; only the horizon is laid out here.
      style={{ "--horizon": arc ? `${arc.horizon}px` : "70%" } as CSSProperties}
    >
      <div ref={skyRef} className="sp-day-sky" aria-hidden>
        <span className="sp-day-stars" />
        <svg className="sp-day-cloud" data-cloud="1" viewBox="0 0 120 44">
          <path d="M14 40a14 14 0 0 1 4-27 20 20 0 0 1 37-6 17 17 0 0 1 29 4 15 15 0 0 1 22 13 13 13 0 0 1 0 16Z" />
        </svg>
        <svg className="sp-day-cloud" data-cloud="2" viewBox="0 0 120 44">
          <path d="M10 40a12 12 0 0 1 6-22 18 18 0 0 1 32-8 16 16 0 0 1 28 6 13 13 0 0 1 24 10 12 12 0 0 1 4 14Z" />
        </svg>
        <svg className="sp-day-cloud" data-cloud="3" viewBox="0 0 120 44">
          <path d="M16 40a13 13 0 0 1 2-25 19 19 0 0 1 35-5 15 15 0 0 1 27 7 14 14 0 0 1 20 23Z" />
        </svg>
        <div ref={glowRef} className="sp-day-glow" />
        <div ref={placeRef} className="sp-day-place">
          <div ref={bodyRef} key={body} className="sp-day-body" data-body={body}>
            {body === "sun" ? (
              <svg viewBox="-110 -110 220 220">
                <g className="sp-day-rays">
                  {Array.from({ length: 12 }, (_, ray) => (
                    <path key={ray} d="M0-80V-102" transform={`rotate(${ray * 30})`} />
                  ))}
                </g>
                <circle r="64" className="sp-day-sun" />
                <path d="M-40-28A48 48 0 0 1-6-48" className="sp-day-shine" />
              </svg>
            ) : (
              <svg viewBox="-80 -80 160 160">
                <path className="sp-day-moon" d="M22-44A50 50 0 1 0 22 44 44 44 0 0 1 22-44Z" transform="rotate(-20)" />
              </svg>
            )}
          </div>
        </div>
        <svg className="sp-day-hills" viewBox="0 0 1600 300" preserveAspectRatio="none">
          <path data-far d="M0 70C160 30 300 26 470 56S760 96 930 60 1260 14 1420 44 1560 70 1600 62V300H0Z" />
          <path d="M0 120C200 80 360 92 560 116S900 140 1080 106 1420 82 1600 108V300H0Z" />
        </svg>
      </div>

      <div className="sp-scene-copy" data-centred>
        <Written id="sp-day-title" className="sp-heading" text={"A new brief\nevery {}."} flip={{ words: WEEK, index: at % WEEK.length }} />
        <p className="sp-lede">
          Before you wake, Spectra reads what you did yesterday and what is coming, and writes the day&apos;s few moves at the top of Home.
          Do them, and tomorrow&apos;s starts from there.
        </p>
      </div>

      <div ref={heavenRef} className="sp-day-heaven" />

      <ShowcaseTime.Provider value={time}>
        <div className="sp-day-stage">
          <div ref={homeRef} className="sp-day-home">
            <Window at="home" width={1040} height={360} label={`Henry's Home, ${weekday(offset)}`}>
              <div className="sp-day-page">
                <TodayBrief key={`${at}-${written}`} brief={brief} agenda={null} />
              </div>
            </Window>
          </div>
          {layer}
        </div>
      </ShowcaseTime.Provider>
    </section>
  );
}
