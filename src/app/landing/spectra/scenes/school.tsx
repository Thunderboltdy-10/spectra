"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { spectraBus } from "@/features/spectra/events";
import { useNear } from "../../kit/build";
import { islandField, typeIntoIsland } from "../../kit/landing-island";
import { useWorld, useWorldEvent } from "../../kit/world-context";
import { DEADLINES, LAB_BLOCK } from "../../world/school";
import { dayName } from "../../world/story";
import { Written } from "../../kit/written";
import { useScene } from "../director";
import { PEOPLE, useHands } from "../hands";
import { dimAll, flash, shine } from "../light/light";
import { Window } from "../window";

/*
 * Henry's week in Spectra's own calendar: lessons and deadlines from
 * ManageBac, the blocks Spectra planned, his own events. Mr Okafor posts a
 * lab report in ManageBac; the calendar sees ManageBac is ahead and syncs it
 * in by itself, and it lands on Friday. Henry looks at what it needs and asks
 * for time to do it, and the block appears after his test on Thursday.
 */

const CalendarApplication = dynamic(
  () =>
    import("@/features/spectra/calendar/ui/calendar-application").then(
      (module) => module.CalendarApplication,
    ),
  {
    ssr: false,
    loading: () => <div className="sp-calendar-ghost" />,
  },
);

const QUESTION = "find me time for the lab report";
const lab = DEADLINES.labReport;

/** The calendar's button for an item, found by the title it carries. */
const itemIn = (root: HTMLElement | null, title: string) =>
  [...(root?.querySelectorAll<HTMLElement>("button[title]") ?? [])].find(
    (button) => button.title.includes(title),
  ) ?? null;

export function School() {
  const world = useWorld();
  const sectionRef = useRef<HTMLElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const near = useNear(sectionRef);
  const { layer, hand } = useHands();
  const planned = useRef<(() => void) | null>(null);

  useWorldEvent((event) => {
    if (event.type === "run_finished" && event.reply.key === "lab")
      planned.current?.();
  });

  useEffect(() => {
    const calendar = calendarRef.current;
    if (calendar)
      shine("school-week", {
        el: calendar,
        at: [0.5, 0.2],
        rx: 820,
        ry: 300,
        strength: 0.28,
        hues: [4.4, 5.6],
        flow: 0.5,
        ease: 1400,
      });
    return () => dimAll("school");
  }, []);

  /** The week scrolls to the afternoon, where the story's hours are: the hour given just under the days. */
  const toAfternoon = (instant: boolean, hour = "14:00") => {
    const scroller = calendarRef.current?.querySelector<HTMLElement>(
      ".spectra-calendar-scroll",
    );
    const noon = [...(scroller?.querySelectorAll<HTMLElement>("*") ?? [])].find(
      (element) =>
        !element.children.length && element.textContent?.trim() === hour,
    );
    if (!scroller || !noon) return;
    const box = scroller.getBoundingClientRect();
    const scale = box.height / scroller.clientHeight || 1;
    const top =
      scroller.scrollTop +
      (noon.getBoundingClientRect().top - box.top) / scale -
      64;
    scroller.scrollTo({ top, behavior: instant ? "auto" : "smooth" });
  };

  /** Waits for the calendar to show an item, up to a limit. */
  const appear = async (
    title: string,
    wait: (ms: number) => Promise<void>,
    signal: AbortSignal,
    limit = 4000,
  ) => {
    for (let waited = 0; waited < limit && !signal.aborted; waited += 100) {
      const found = itemIn(calendarRef.current, title);
      if (found) return found;
      await wait(100);
    }
    return null;
  };

  useScene(
    sectionRef,
    async ({ wait, skipped, signal }) => {
      world.post(lab);
      window.setTimeout(() => toAfternoon(true), 600);
      if (skipped) return;
      // ManageBac has it; the calendar syncs it in and it lands on Friday.
      spectraBus.emit("island.notify", {
        id: "landing-lab-posted",
        title: "Mr Okafor posted a task",
        detail: `${lab.title}, due ${dayName(lab.startAt!)}`,
        tone: "info",
      });
      const task = await appear(lab.title, wait, signal);
      toAfternoon(false);
      await wait(500);
      if (!task) return;
      flash({
        el: task,
        rx: 220,
        ry: 120,
        strength: 0.75,
        hues: [2.6, 3.6],
        hold: 900,
      });

      // Henry rests on it to see what it needs, then asks for the time.
      const henry = hand(PEOPLE.henry, signal);
      await henry.show(task, [0.4, 0.5]);
      task.dispatchEvent(
        new PointerEvent("pointerover", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
      await wait(1500);
      task.dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" }),
      );
      void henry.hide();
      await world.whenIdle();
      world.pace = 0.4;
      world.quiet = true;
      const done = new Promise<void>((resolve) => {
        planned.current = resolve;
        window.setTimeout(resolve, 9000);
      });
      // The block Spectra plans is kept back until its hand has carried it in from the island.
      sectionRef.current?.setAttribute("data-bringing", "");
      void typeIntoIsland(QUESTION, { fresh: true, perLetter: 14 });
      await done;
      planned.current = null;
      const block = await appear(LAB_BLOCK.title, wait, signal, 2000);
      if (block) {
        const look = document.createElement("div");
        look.className = "sp-carried-event";
        look.innerHTML = `<strong></strong><span>17:30 – 18:20</span>`;
        look.querySelector("strong")!.textContent = LAB_BLOCK.title;
        // The week moves down an hour so the evening it lands in is in view.
        toAfternoon(false, "15:00");
        await wait(520);
        const spectra = hand(PEOPLE.spectra, signal);
        await spectra.bring(block, islandField(), { look, ms: 640 });
        sectionRef.current?.removeAttribute("data-bringing");
        flash({
          el: block,
          rx: 200,
          ry: 140,
          strength: 0.7,
          hues: [4.6, 5.6],
          hold: 900,
        });
        await spectra.hide();
      }
      sectionRef.current?.removeAttribute("data-bringing");
      await wait(600);
    },
    2600,
  );

  return (
    <section
      ref={sectionRef}
      className="sp-scene sp-school"
      aria-labelledby="sp-school-title"
    >
      <div className="sp-scene-copy" data-settle-to>
        <Written
          id="sp-school-title"
          className="sp-heading"
          text="Your week, with time for the work."
        />
        <p className="sp-lede">
          Tasks arrive from ManageBac by themselves, and Spectra finds the hour
          to do them.
        </p>
      </div>
      <div className="sp-school-stage">
        <div ref={calendarRef} className="sp-school-calendar">
          <Window
            at="calendar"
            width={1320}
            height={580}
            threads={["Planned the source analysis", "Revision for Thursday"]}
            label="Henry's calendar"
          >
            <div className="sp-calendar">
              {near ? (
                <CalendarApplication />
              ) : (
                <div className="sp-calendar-ghost" />
              )}
            </div>
          </Window>
        </div>
        {layer}
      </div>
    </section>
  );
}
