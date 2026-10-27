"use client";

import { useEffect, useRef, useState } from "react";
import { ShowcaseTime } from "@/features/spectra/showcase/showcase-time";
import { HomeDay } from "@/features/spectra/today/home-day";
import { typeIntoIsland } from "../../kit/landing-island";
import { useWorld } from "../../kit/world-context";
import { SUGGESTED } from "../../world/replies";
import { STORY } from "../../world/story";
import { PEOPLE, sleep, useHands } from "../hands";
import { dimAll, shine, travel } from "../light/light";
import { Window } from "../window";

/*
 * The first thing on the page: Henry's Spectra on a school night, as it is.
 * His Home has the week from ManageBac, the work he was last in and the
 * threads still going. A moment after the page opens his hand goes to the
 * first question and asks it, and the island answers from his own work, with
 * the places it read. The visitor can ask the other two, or their own.
 */

const TITLE = "All your schoolwork, in one place.";
const noop = () => undefined;

export function Hero() {
  const world = useWorld();
  const copyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const askRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const { layer, hand } = useHands();
  const [asked, setAsked] = useState<string | null>(null);
  const busy = useRef(false);

  const ask = async (text: string, pace = 1) => {
    if (busy.current) return;
    busy.current = true;
    setAsked(text);
    await world.whenIdle();
    world.pace = pace;
    await typeIntoIsland(text, { fresh: true, perLetter: pace < 1 ? 18 : 30 });
    busy.current = false;
  };

  // Light comes up around Henry's Spectra, cool over the window and warm under the questions, and runs through the title.
  useEffect(() => {
    const stage = stageRef.current;
    const copy = copyRef.current;
    const title = titleRef.current;
    if (!stage || !copy || !title) return;
    shine("hero-cool", { el: stage, at: [0.04, 0.02], rx: 620, ry: 380, strength: 0.66, hues: [4.3, 6.6], flow: 0.7, ease: 1100 });
    shine("hero-warm", { el: copy, at: [0.18, 0.78], rx: 420, ry: 280, strength: 0.42, hues: [0.4, 2.3], flow: 0.5, ease: 1600 });
    const box = title.getBoundingClientRect();
    const y = box.top + window.scrollY;
    travel("hero-title", [box.left - 160, y + box.height * 0.3], [box.right - 60, y + box.height * 0.62], {
      rx: 300,
      ry: 190,
      strength: 0.8,
      hues: [4.6, 6.8],
      ease: 400,
      ms: 1800,
    });
    return () => {
      dimAll("hero");
    };
  }, []);

  // Henry asks the first question himself.
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    void (async () => {
      await sleep(1500, signal);
      if (signal.aborted || window.scrollY > window.innerHeight * 0.5) return;
      const henry = hand(PEOPLE.henry, signal);
      const first = askRefs.current[0];
      await henry.show(first, [0.62, 0.7]);
      await sleep(260, signal);
      await henry.press();
      if (signal.aborted) return;
      void ask(SUGGESTED[0]!, 0.5);
      await sleep(500, signal);
      await henry.hide();
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand]);

  return (
    <section className="sp-hero" aria-labelledby="sp-hero-title">
      <div ref={copyRef} className="sp-hero-copy">
        <h1 ref={titleRef} id="sp-hero-title" className="sp-hero-title" data-light-text>
          {TITLE}
        </h1>
        <p className="sp-hero-sub">
          Classes, notes, files and deadlines live together in Spectra, with an AI that knows all of it and works right beside you.
        </p>
        <div className="sp-hero-asks" role="group" aria-label="Ask Henry's Spectra">
          {SUGGESTED.map((text, index) => (
            <button
              key={text}
              ref={(node) => {
                askRefs.current[index] = node;
              }}
              type="button"
              className="sp-hero-ask"
              data-asked={asked === text || undefined}
              onClick={() => void ask(text)}
            >
              {text}
            </button>
          ))}
        </div>
        {layer}
      </div>

      <div ref={stageRef} className="sp-hero-stage">
        <Window at="home" width={1180} height={820} threads={["What's due this week", "Revision for Thursday", "IA source paragraph"]} label="Henry's Home in Spectra">
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
