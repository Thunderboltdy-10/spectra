"use client";

import { useEffect, useRef } from "react";
import { ShowcaseTime } from "@/features/spectra/showcase/showcase-time";
import { HomeDay } from "@/features/spectra/today/home-day";
import { useBuild, useSteps } from "../kit/build";
import { useWorld } from "../kit/world-context";
import { DEADLINES } from "../world/school";
import { clock, dayName, STORY } from "../world/story";

/*
 * The night and the morning on Henry's real Home. At midnight it is dark and
 * the sky over the week has stars; Spectra keeps working while he sleeps, and
 * says what it did. At seven the sky is light, and the brief it wrote is
 * waiting with what to do first.
 */

const noop = () => undefined;

const NIGHT = [
  { at: STORY.night, text: "Ms Gonzalez posted the source analysis" },
  { at: STORY.night + 5 * 60_000, text: "Read the source pack she attached" },
  { at: STORY.night + 9 * 60_000, text: `Planned two blocks before ${dayName(DEADLINES.sourceAnalysis.startAt!)}` },
  { at: STORY.morning - 22 * 60_000, text: "Wrote this morning's brief" },
];

function Home({ at, label }: { at: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Home reads its threads and works only when it is close to the screen.
  const near = useBuild(ref, 0.02);
  return (
    <div ref={ref} className="landing-home" aria-label={label}>
      <ShowcaseTime.Provider value={at}>{near.started ? <HomeDay onAllThreads={noop} /> : <div className="landing-home-ghost" />}</ShowcaseTime.Provider>
    </div>
  );
}

export function Night() {
  const ref = useRef<HTMLElement>(null);
  const build = useBuild(ref, 0.4);
  const near = useBuild(ref, 0.02);
  const step = useSteps(build, NIGHT.map(() => 1500));
  const world = useWorld();
  useEffect(() => {
    if (near.started) world.catchUp();
  }, [near.started, world]);
  return (
    <section ref={ref} id="night" className="landing-section landing-night" data-stage="night" data-dark="on" aria-labelledby="night-title">
      <div className="landing-night-inner dark">
        <div className="landing-copy">
          <h2 id="night-title" className="landing-heading">
            While Henry sleeps, it keeps up.
          </h2>
          <p className="landing-lede">
            Something new from school at midnight is read, planned for and waiting in the morning, without anyone staying up
            for it.
          </p>
          <ol className="landing-overnight" aria-label="Overnight">
            {NIGHT.map((entry, index) => (
              <li key={entry.text} data-on={index < step || undefined}>
                <time>{clock(entry.at)}</time>
                {entry.text}
              </li>
            ))}
          </ol>
        </div>
        <Home at={STORY.night} label="Henry's Home at midnight" />
      </div>
    </section>
  );
}

export function Morning() {
  return (
    <section id="morning" className="landing-section landing-morning" data-stage="morning" data-island="on" aria-labelledby="morning-title">
      <div className="landing-copy">
        <h2 id="morning-title" className="landing-heading">
          Wake up to a plan, not a pile.
        </h2>
        <p className="landing-lede">
          Seven o&rsquo;clock: the brief says what changed overnight and what to do first, and each suggestion opens the work
          it is about.
        </p>
      </div>
      <Home at={STORY.morning} label="Henry's Home at seven" />
    </section>
  );
}
