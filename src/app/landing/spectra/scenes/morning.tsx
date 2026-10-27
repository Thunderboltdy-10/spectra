"use client";

import { useEffect, useRef, useState } from "react";
import { ShowcaseTime } from "@/features/spectra/showcase/showcase-time";
import { HomeDay } from "@/features/spectra/today/home-day";
import { useNear } from "../../kit/build";
import { useWorld } from "../../kit/world-context";
import { DEADLINES } from "../../world/school";
import { clock, dayName, STORY } from "../../world/story";
import { Written } from "../../kit/written";
import { useScene } from "../director";
import { PEOPLE, useHands } from "../hands";
import { dimAll, shine, travel } from "../light/light";
import { Window } from "../window";

/*
 * Seven the next morning, on Henry's real Home. Overnight Ms Gonzalez posted
 * a task; Spectra read it, planned for it and wrote the morning brief, which
 * is waiting at the top of Home under its little sky. Beside the window the
 * sun comes up over the page, and the night's work is listed as it happened.
 */

const noop = () => undefined;

const NIGHT = [
  { at: STORY.night, text: "Ms Gonzalez posted the source analysis" },
  { at: STORY.night + 5 * 60_000, text: "Read the source pack she attached" },
  {
    at: STORY.night + 9 * 60_000,
    text: `Planned two hours before ${dayName(DEADLINES.sourceAnalysis.startAt!)}`,
  },
  { at: STORY.morning - 22 * 60_000, text: "Wrote Henry's morning" },
];

export function Morning() {
  const world = useWorld();
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const skyRef = useRef<HTMLDivElement>(null);
  const homeRef = useRef<HTMLDivElement>(null);
  const near = useNear(sectionRef);
  const [shown, setShown] = useState(0);
  const { layer, hand } = useHands();

  // The night's work is done by the time anyone scrolls this far.
  useEffect(() => {
    if (near) world.catchUp();
  }, [near, world]);

  useEffect(() => () => dimAll("morning"), []);

  const sunUp = () => {
    const sky = skyRef.current;
    if (!sky) return;
    shine("morning-sun", {
      el: sky,
      at: [0.52, 0.44],
      rx: 128,
      ry: 128,
      strength: 0.95,
      hues: [2.15, 1.05],
      flow: 0.4,
      disc: true,
      ease: 500,
    });
    shine("morning-air", {
      el: sky,
      at: [0.4, 0.7],
      rx: 560,
      ry: 420,
      strength: 0.45,
      hues: [1.2, 2.6],
      flow: 0.5,
      ease: 1400,
    });
  };

  useScene(
    sectionRef,
    async ({ wait, skipped, signal }) => {
      const sky = skyRef.current;
      if (skipped || !sky) {
        setShown(NIGHT.length);
        sunUp();
        return;
      }
      // The sun climbs from below the page's edge to its place over the night's log.
      const box = sky.getBoundingClientRect();
      const x = box.left + box.width * 0.52;
      const y = box.top + window.scrollY + box.height * 0.44;
      travel("morning-sun", [x + 120, y + 520], [x, y], {
        rx: 128,
        ry: 128,
        strength: 0.95,
        hues: [2.15, 1.05],
        flow: 0.4,
        disc: true,
        ease: 300,
        ms: 1500,
      });
      shine("morning-air", {
        el: sky,
        at: [0.4, 0.7],
        rx: 560,
        ry: 420,
        strength: 0.45,
        hues: [1.2, 2.6],
        flow: 0.5,
        ease: 1800,
      });
      for (let index = 0; index < NIGHT.length; index += 1) {
        await wait(240);
        setShown(index + 1);
      }
      // Henry opens how to do the first thing on his list.
      await wait(300);
      const how =
        homeRef.current?.querySelector<HTMLDetailsElement>(".morning-move-how");
      if (!how) return;
      const henry = hand(PEOPLE.henry, signal);
      await henry.show(how.querySelector("summary"), [0.3, 0.5]);
      await wait(120);
      await henry.press();
      how.open = true;
      await wait(900);
      await henry.hide();
    },
    2400,
  );

  return (
    <section
      ref={sectionRef}
      className="sp-scene sp-morning"
      aria-labelledby="sp-morning-title"
    >
      <div className="sp-scene-copy" data-settle-to>
        <Written
          id="sp-morning-title"
          className="sp-heading"
          text="Wake up to a plan, not a pile."
        />
        <p className="sp-lede">
          Overnight, Spectra reads what school posted and writes your morning:
          what changed, and what to do first.
        </p>
      </div>

      <div ref={stageRef} className="sp-morning-stage">
        <div ref={homeRef} className="sp-morning-window">
          <Window
            at="home"
            width={1180}
            height={780}
            threads={[
              "Revision for Thursday",
              "What's due this week",
              "IA source paragraph",
            ]}
            label="Henry's Home at seven in the morning"
          >
            <ShowcaseTime.Provider value={STORY.morning}>
              <div className="sp-home">
                {near ? <HomeDay onAllThreads={noop} /> : null}
              </div>
            </ShowcaseTime.Provider>
          </Window>
        </div>
        <aside className="sp-morning-night" aria-label="Overnight">
          <div ref={skyRef} className="sp-morning-sky" aria-hidden />
          <p className="sp-morning-night-head">While Henry slept</p>
          <ol>
            {NIGHT.map((entry, index) => (
              <li key={entry.text} data-shown={index < shown || undefined}>
                <time>{clock(entry.at)}</time>
                <span>{entry.text}</span>
              </li>
            ))}
          </ol>
        </aside>
        {layer}
      </div>
    </section>
  );
}
