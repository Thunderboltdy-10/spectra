"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { ShowcaseTime } from "@/features/spectra/showcase/showcase-time";
import { HomeDay } from "@/features/spectra/today/home-day";
import { arrival, glide, morph, settle, snapshot } from "../../kit/filing";
import { Written } from "../../kit/written";
import { useWorld } from "../../kit/world-context";
import { DEADLINES, ZONE, schoolDay, type WireItem } from "../../world/school";
import { STORY, dayAt, dayName } from "../../world/story";
import { PEOPLE, useHands } from "../hands";
import { dimAll, flash, shine, travel } from "../light/light";
import { useLoop, type Beat } from "../loop";
import { Window } from "../window";

/*
 * The first thing on the page: Henry's Home on a school night, as Spectra
 * shows it. Around it, school arrives the way it really does: a message in
 * the class group, a third copy of a draft in Downloads, an email, a photo of
 * the board. One at a time Spectra takes each one in, and it becomes part of
 * Home: a plan on the week, a deadline on its day, a document on the desk.
 * Then the evening starts again. A visitor can hurry any of them along by
 * pressing it.
 */

type Arrival = {
  key: string;
  word: string;
  side: "left" | "right";
  top: number;
  hue: number;
  /** What it becomes, as Home shows it. */
  lands: { selector: string; text: string };
  card: ReactNode;
};

const TRIP_FORM: WireItem = {
  id: "hero-trip-form",
  kind: "reminder",
  title: "Museum trip form",
  startAt: dayAt(1, 8, 30),
  endAt: dayAt(1, 8, 30),
  timezone: ZONE,
  status: "active",
  sourceLocked: false,
  linkedWorkIds: [],
  revision: 1,
};


/** The email's lab report, on a free school day later in the week so the week has room to show it. */
const LAB: WireItem = { ...DEADLINES.labReport, id: "hero-lab", startAt: dayAt(schoolDay(4), 16, 0), endAt: dayAt(schoolDay(4), 16, 0) };

const ARRIVALS: Arrival[] = [
  {
    key: "message",
    word: "message",
    side: "left",
    top: 0.16,
    hue: 3,
    lands: { selector: ".today-day-item", text: TRIP_FORM.title },
    card: (
      <div className="sp-drift-card sp-drift-message">
        <span className="sp-drift-app">
          <Icon name="conversations" size={13} />
          History HL group
          <time>21:32</time>
        </span>
        <strong>Leo</strong>
        <p>don&apos;t forget the museum trip form is due tomorrow morning!! signed by a parent</p>
      </div>
    ),
  },
  {
    key: "email",
    word: "email",
    side: "right",
    top: 0.3,
    hue: 1,
    lands: { selector: ".today-day-item", text: LAB.title },
    card: (
      <div className="sp-drift-card sp-drift-mail">
        <span className="sp-drift-app">
          <Icon name="mail" size={13} />
          Mr Okafor
          <time>20:05</time>
        </span>
        <strong>Lab report: yeast respiration</strong>
        <p>Due {dayName(LAB.startAt!)} at 4. Use your own data from the practical, and keep the evaluation short.</p>
      </div>
    ),
  },
];

/** Stops a page inside the window from leaving the landing: it is a picture of Spectra, not Spectra. */
const stay = (event: React.MouseEvent) => {
  if ((event.target as HTMLElement).closest("a[href]")) event.preventDefault();
};

export function Hero() {
  const world = useWorld();
  const sceneRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const homeRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const { layer, hand } = useHands();
  const [time, setTime] = useState(STORY.evening);
  const [states, setStates] = useState<Record<string, "away" | "here" | "taken">>({});
  const hurry = useRef<Record<string, () => void>>({});

  const refresh = () => setTime((at) => at + 1);
  const setState = (key: string, state: "away" | "here" | "taken") => setStates((was) => ({ ...was, [key]: state }));

  // Light behind Home, and once, across the heading on the way down to it.
  useEffect(() => {
    const stage = stageRef.current;
    const title = titleRef.current;
    if (!stage || !title) return;
    const box = title.getBoundingClientRect();
    const y = box.top + window.scrollY;
    travel("hero-title", [box.left - 120, y + box.height * 0.4], stage, {
      at: [0.5, 0.42],
      rx: 440,
      ry: 240,
      strength: 0.34,
      hues: [4.2, 6.6],
      flow: 0.45,
      ease: 600,
      ms: 2200,
    });
    // Around Home the light hugs the window, going round it through the spectrum, and slowly turns.
    const window_ = stage.querySelector(".sp-hero-window");
    shine("hero-halo", { el: window_, halo: { radius: 16 }, rx: 96, ry: 74, strength: 0.8, hues: [0, 6], flow: 1, ease: 1200 });
    return () => dimAll("hero");
  }, []);

  const file = async (item: Arrival, { wait, signal }: Beat) => {
    const home = homeRef.current;
    const stage = stageRef.current;
    const drift = stage?.querySelector<HTMLElement>(`[data-drift="${item.key}"] .sp-drift-card`);
    if (!home || !stage || !drift) return;

    setState(item.key, "here");
    // It floats there a while, unless the visitor hurries it along.
    await Promise.race([wait(450), new Promise<void>((resolve) => (hurry.current[item.key] = resolve))]);
    delete hurry.current[item.key];
    if (signal.aborted) return;

    const spectra = hand(PEOPLE.spectra, signal);
    // It takes the card by its corner, so the card does not jump into the hand.
    const card = drift.getBoundingClientRect();
    await spectra.show(drift, [24 / card.width, 18 / card.height]);
    await spectra.press();
    const copy = spectra.grab(drift);
    setState(item.key, "taken");

    // Spectra files it: Home is told, and shows it where it belongs.
    home.dataset.filing = "";
    // Everything already on Home is known, so only what is filed now waits to be set down.
    const before = snapshot(home, ".today-day-item, .work-desk > *");
    if (item.key === "message") world.place(TRIP_FORM);
    if (item.key === "email") world.place(LAB);
    refresh();
    const target = await arrival(home, item.lands.selector, item.lands.text, signal);
    glide(before);
    if (!target) {
      copy.remove();
      await spectra.drop();
      delete home.dataset.filing;
      settle(home);
      await spectra.hide();
      spectra.remove();
      return;
    }
    const box = target.getBoundingClientRect();
    const layerBox = stage.getBoundingClientRect();
    await spectra.move([box.left - layerBox.left + 24, box.top - layerBox.top + 18], { ms: 620, overshoot: false });
    flash({ el: target, at: [0.5, 0.5], rx: 120, ry: 90, strength: 0.6, hues: [item.hue - 0.5, item.hue + 0.5], hold: 360 });
    await morph(copy, target, stage.querySelector(".sp-hands") as HTMLElement);
    target.dataset.filed = "";
    await spectra.drop();
    delete home.dataset.filing;
    settle(home);
    await spectra.move(target, { ms: 500, aim: [0.9, 1.3] });
    await spectra.hide();
    spectra.remove();
    await wait(250);
  };

  useLoop(sceneRef, {
    threshold: 0.2,
    open: async ({ wait }) => {
      // Home comes together first (the stylesheet), then the evening starts.
      await wait(700);
    },
    round: async (beat) => {
      for (const item of ARRIVALS) {
        if (beat.signal.aborted) return;
        await file(item, beat);
      }
      // Everything is where it belongs. A while later the evening starts over.
      await beat.wait(1600);
      const home = homeRef.current;
      if (!home) return;
      home.dataset.tidying = "";
      await beat.wait(500);
      world.unplace(TRIP_FORM.id, LAB.id);
      setStates({});
      refresh();
      await beat.wait(500);
      delete home.dataset.tidying;
      await beat.wait(300);
    },
  });

  return (
    <section ref={sceneRef} className="sp-hero" aria-labelledby="sp-hero-title">
      <div className="sp-hero-copy">
        <div ref={titleRef}>
          <Written as="h1" id="sp-hero-title" className="sp-hero-title" text={"All your schoolwork,\nin one place."} delay={80} />
        </div>
        <p className="sp-hero-sub">
          Classes, deadlines, notes and files on one calm page, with an AI that already knows them and keeps your week in order.
        </p>
        <div className="sp-hero-actions">
          <a href="#talk" className="landing-button" data-tone="primary">
            Bring Spectra to your school
          </a>
          <Link href="/sign-in" className="landing-button">
            Sign in
          </Link>
        </div>
      </div>

      <div ref={stageRef} className="sp-hero-stage">
        <div className="sp-hero-window" onClickCapture={stay}>
          <Window at="home" width={1240} height={800} label="Henry's Home in Spectra">
            <ShowcaseTime.Provider value={time}>
              <div ref={homeRef} className="sp-home">
                <HomeDay onAllThreads={() => undefined} />
              </div>
            </ShowcaseTime.Provider>
          </Window>
        </div>
        {ARRIVALS.map((item) => (
          <button
            key={item.key}
            type="button"
            className="sp-drift"
            data-drift={item.key}
            data-side={item.side}
            data-state={states[item.key] ?? "away"}
            style={{ top: `${item.top * 100}%` }}
            tabIndex={states[item.key] === "here" ? 0 : -1}
            aria-label={`Let Spectra file the ${item.word}`}
            onClick={() => hurry.current[item.key]?.()}
          >
            <span className="sp-drift-bob">{item.card}</span>
          </button>
        ))}
        {layer}
      </div>
    </section>
  );
}
