"use client";

import { useEffect, useRef, useState } from "react";
import { ShowcaseTime } from "@/features/spectra/showcase/showcase-time";
import { HomeDay } from "@/features/spectra/today/home-day";
import { typeIntoIsland } from "../../kit/landing-island";
import { Written } from "../../kit/written";
import { useWorld } from "../../kit/world-context";
import { SUGGESTED } from "../../world/replies";
import { STORY } from "../../world/story";
import { dimAll, shine, travel } from "../light/light";
import { Window } from "../window";

/*
 * The first thing on the page: Henry's Spectra on a school night, as it is.
 * His Home has the week from ManageBac, the work he was last in and the
 * threads still going. The visitor can ask it one of three questions, or
 * their own, and the island answers from his work beside the page.
 */

const TITLE = "All your schoolwork, in one place.";
const noop = () => undefined;

export function Hero() {
  const world = useWorld();
  const copyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const busy = useRef(false);

  const ask = async (text: string) => {
    if (busy.current) return;
    busy.current = true;
    setAsked(text);
    await world.whenIdle();
    await typeIntoIsland(text, { fresh: true, perLetter: 30 });
    busy.current = false;
  };

  // Light comes up around Henry's Spectra, cool over the window and warm under the questions, and runs through the title.
  useEffect(() => {
    const stage = stageRef.current;
    const copy = copyRef.current;
    const title = titleRef.current;
    if (!stage || !copy || !title) return;
    shine("hero-cool", {
      el: stage,
      at: [0.04, 0.02],
      rx: 620,
      ry: 380,
      strength: 0.66,
      hues: [4.3, 6.6],
      flow: 0.7,
      ease: 1100,
    });
    shine("hero-warm", {
      el: copy,
      at: [0.18, 0.78],
      rx: 420,
      ry: 280,
      strength: 0.42,
      hues: [0.4, 2.3],
      flow: 0.5,
      ease: 1600,
    });
    const box = title.getBoundingClientRect();
    const y = box.top + window.scrollY;
    travel(
      "hero-title",
      [box.left - 160, y + box.height * 0.3],
      [box.right - 60, y + box.height * 0.62],
      {
        rx: 300,
        ry: 190,
        strength: 0.8,
        hues: [4.6, 6.8],
        ease: 400,
        ms: 1800,
      },
    );
    return () => {
      dimAll("hero");
    };
  }, []);

  return (
    <section className="sp-hero" aria-labelledby="sp-hero-title">
      <div ref={copyRef} className="sp-hero-copy">
        <div ref={titleRef}>
          <Written
            as="h1"
            id="sp-hero-title"
            className="sp-hero-title"
            text={TITLE}
            delay={60}
          />
        </div>
        <p className="sp-hero-sub">
          Classes, notes, files and deadlines together, with an AI that already
          knows them.
        </p>
        <div
          className="sp-hero-asks"
          role="group"
          aria-label="Ask Henry's Spectra"
        >
          {SUGGESTED.map((text) => (
            <button
              key={text}
              type="button"
              className="sp-hero-ask"
              data-asked={asked === text || undefined}
              onClick={() => void ask(text)}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      <div ref={stageRef} className="sp-hero-stage">
        <Window
          at="home"
          width={1180}
          height={820}
          threads={[
            "What's due this week",
            "Revision for Thursday",
            "IA source paragraph",
          ]}
          label="Henry's Home in Spectra"
        >
          <ShowcaseTime.Provider value={STORY.evening}>
            <div className="sp-home">
              <HomeDay onAllThreads={noop} />
            </div>
          </ShowcaseTime.Provider>
        </Window>
      </div>
    </section>
  );
}
