"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { spectraBus } from "@/features/spectra/events";
import { useBuild } from "../kit/build";
import { typeIntoIsland } from "../kit/landing-island";
import { useWorld, useWorldEvent } from "../kit/world-context";
import { DEADLINES } from "../world/school";
import { dayName } from "../world/story";

/*
 * Henry's real calendar: lessons and deadlines from ManageBac, his own
 * events, and the blocks Spectra plans. Tonight Ms Gonzalez posts the source
 * analysis; ManageBac has it, the calendar syncs it in, and Henry asks when to
 * do it. Everything here is the app's calendar: hover a task to see what it
 * needs, drag a block, make an event.
 */

const CalendarApplication = dynamic(() => import("@/features/spectra/calendar/ui/calendar-application").then((module) => module.CalendarApplication), {
  ssr: false,
  loading: () => <div className="landing-calendar-ghost" />,
});

const QUESTION = "when should I do the source analysis";
const source = DEADLINES.sourceAnalysis;

export function School() {
  const ref = useRef<HTMLElement>(null);
  const build = useBuild(ref, 0.5);
  // The calendar loads as the section comes near, so it is there when the story starts.
  const near = useBuild(ref, 0.02);
  const world = useWorld();
  const [posted, setPosted] = useState(false);
  const [planned, setPlanned] = useState(false);
  const started = useRef(false);

  useWorldEvent((event) => {
    if (event.type === "calendar" && world.calendar.some((item) => item.id === source.id)) setPosted(true);
    if (event.type === "run_finished" && event.reply.key === "plan") setPlanned(true);
  });

  useEffect(() => {
    if (!build.started || started.current) return;
    started.current = true;
    const timers: number[] = [];
    timers.push(
      window.setTimeout(() => {
        world.postSourceAnalysis();
        spectraBus.emit("island.notify", {
          id: "landing-source-posted",
          title: "Ms Gonzalez posted a task",
          detail: `${source.title}, due ${dayName(source.startAt!)}`,
          tone: "info",
        });
      }, build.skipped ? 0 : 1600),
    );
    if (!build.skipped) timers.push(window.setTimeout(() => void world.whenIdle().then(() => typeIntoIsland(QUESTION, { fresh: true })), 4200));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [build.skipped, build.started, world]);

  return (
    <section ref={ref} id="school" className="landing-section landing-school" data-stage="school" data-island="on" aria-labelledby="school-title">
      <div className="landing-copy">
        <h2 id="school-title" className="landing-heading">
          Your school&rsquo;s calendar, with time to do the work in it.
        </h2>
        <p className="landing-lede">
          Lessons and deadlines come from ManageBac by themselves. When a teacher posts something new it is on your week
          straight away, and Spectra finds the hours to do it around everything else.
        </p>
        <p className="landing-aside" aria-live="polite">
          {planned
            ? "Two blocks, after lessons. Drag one to move it, or press an empty hour to add your own."
            : posted
              ? `New from ManageBac: ${source.title}, due ${dayName(source.startAt!)}.`
              : "Hover a deadline to see what it needs."}
        </p>
      </div>
      <div className="landing-calendar" data-spectra-app-frame>
        {near.started ? <CalendarApplication /> : <div className="landing-calendar-ghost" />}
      </div>
    </section>
  );
}
