"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { useWorld } from "../../kit/world-context";
import { Written } from "../../kit/written";
import { DAYS, DEADLINES, LAB_BLOCK, type WireItem } from "../../world/school";
import { TODAY, dayAt, dayName } from "../../world/story";
import { CLASSES, type ClassKey } from "../../world/works";
import { likeness, sleep } from "../hands";
import { dimAll, flash, shine, travel } from "../light/light";
import { useLoop, type Beat } from "../loop";
import { Window } from "../window";

/*
 * Henry's week in Spectra's own calendar, kept light: an afternoon lesson a
 * day and what is due. Things arrive from outside the page and land on their
 * day: Mr Okafor sets a lab report in ManageBac and it comes in from one side;
 * Spectra finds the time to write it and that comes in from the other. Then he
 * moves the test a day and it moves. Then a new week, and the same again.
 */

const CalendarApplication = dynamic(() => import("@/features/spectra/calendar/ui/calendar-application").then((module) => module.CalendarApplication), {
  ssr: false,
  loading: () => <div className="sp-calendar-ghost" />,
});

const DAY = 86_400_000;
const LAB: WireItem = { ...DEADLINES.labReport, id: "week-lab" };
/** Tomorrow, straight after school. */
const BLOCK: WireItem = { ...LAB_BLOCK, id: "week-lab-block", startAt: dayAt(DAYS.tomorrow, 15, 40), endAt: dayAt(DAYS.tomorrow, 16, 30) };
const MOVED = DEADLINES.biologyTest;
/** The calendar's height for an hour, and the room left above the first one shown for its label. */
const HOUR = 60;
const LEAD = 14;

const classOf = (item: WireItem) => (Object.keys(CLASSES) as ClassKey[]).find((key) => CLASSES[key].providerClassId === item.classId) ?? "biology";

/** The calendar's button for an item, found by the title it carries. */
const itemIn = (root: HTMLElement | null, title: string) =>
  [...(root?.querySelectorAll<HTMLElement>("button[title]") ?? [])].find((button) => button.title.includes(title)) ?? null;

export function Week() {
  const world = useWorld();
  const sceneRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  /** Hides what is on its way in, from the moment the calendar first draws it until it lands. */
  const comingRef = useRef<HTMLStyleElement>(null);
  const coming = useRef(new Set<string>());
  const shifted = useRef(false);

  const hold = (title: string, hidden: boolean) => {
    if (hidden) coming.current.add(title);
    else coming.current.delete(title);
    if (comingRef.current)
      comingRef.current.textContent = [...coming.current].map((each) => `.sp-week [title*=${JSON.stringify(each)}]{visibility:hidden}`).join("");
  };

  useEffect(() => {
    const calendar = calendarRef.current?.querySelector<HTMLElement>(".sp-window");
    if (calendar) shine("week-pool", { el: calendar, at: [0.5, 0.7], rx: 620, ry: 260, strength: 0.18, hues: [3.8, 5.2], flow: 0.5, ease: 1600 });
    return () => {
      dimAll("week");
      // The story's own week is left as it was found.
      world.unplace(LAB.id, BLOCK.id);
      if (shifted.current) world.shift(MOVED.id, -DAY);
    };
  }, [world]);

  /** The week shows the whole school day, from eight; the hours run under the dates, an hour to sixty pixels. */
  const toHour = (hour: number) => {
    const scroller = calendarRef.current?.querySelector<HTMLElement>(".spectra-calendar-scroll");
    scroller?.scrollTo({ top: hour * HOUR - LEAD });
  };

  /** Waits for the calendar to show an item (or show it somewhere else than `away`). */
  const appear = async (title: string, { wait, signal }: Beat, away?: DOMRect, limit = 4000) => {
    for (let waited = 0; waited < limit && !signal.aborted; waited += 60) {
      const found = itemIn(calendarRef.current, title);
      const box = found?.getBoundingClientRect();
      if (found && box && box.width && (!away || Math.abs(box.left - away.left) > 4 || Math.abs(box.top - away.top) > 4)) return found;
      await wait(60);
    }
    return null;
  };

  /** A word beside something on the calendar: who set it, or what changed. */
  const label = (text: string, tone: "school" | "spectra") => {
    const tag = document.createElement("span");
    tag.className = "sp-week-tag";
    tag.dataset.tone = tone;
    tag.textContent = text;
    return tag;
  };

  /**
   * Something new comes in from beyond the edge of the page, on a long low
   * arc, and lands square on its place; the real item takes over under it.
   */
  const arrive = async (item: WireItem, side: "left" | "right", said: string, tone: "school" | "spectra", beat: Beat) => {
    const stage = stageRef.current;
    if (!stage) return null;
    hold(item.title, true);
    world.place(item);
    const target = await appear(item.title, beat);
    if (!target || beat.signal.aborted) {
      hold(item.title, false);
      return null;
    }
    const box = target.getBoundingClientRect();
    const room = stage.getBoundingClientRect();
    const scale = box.width / (target.offsetWidth || box.width) || 1;
    const flyer = document.createElement("div");
    flyer.className = "sp-week-flyer";
    flyer.dataset.side = side;
    Object.assign(flyer.style, { width: `${box.width}px`, height: `${box.height}px` });
    const copy = likeness(target);
    // The item is still held out of sight; its copy is not.
    for (const node of [copy, ...copy.querySelectorAll<HTMLElement>("*")]) node.style.setProperty("visibility", "visible");
    copy.style.setProperty("transform", `scale(${scale})`);
    copy.style.setProperty("transform-origin", "0 0");
    copy.style.setProperty("z-index", "auto");
    flyer.append(copy, label(said, tone));
    stage.append(flyer);

    const end = { x: box.left - room.left, y: box.top - room.top };
    const start = { x: side === "left" ? -room.left - box.width - 60 : window.innerWidth - room.left + 60, y: end.y - 150 };
    const lean = side === "left" ? -1 : 1;
    const flight = flyer.animate(
      [
        { transform: `translate(${start.x}px, ${start.y}px) rotate(${lean * 9}deg) scale(1.35)`, offset: 0 },
        { transform: `translate(${start.x + (end.x - start.x) * 0.62}px, ${end.y - 120}px) rotate(${lean * 3}deg) scale(1.22)`, offset: 0.55 },
        { transform: `translate(${end.x}px, ${end.y - 6}px) rotate(0deg) scale(1.04)`, offset: 0.86 },
        { transform: `translate(${end.x}px, ${end.y}px) rotate(0deg) scale(1)`, offset: 1 },
      ],
      { duration: 820, easing: "cubic-bezier(0.3, 0.6, 0.25, 1)", fill: "forwards" },
    );
    await flight.finished.catch(() => undefined);
    // The real item is shown under the copy before the copy goes, so nothing blinks.
    hold(item.title, false);
    target.dataset.brought = "here";
    flyer.dataset.landed = "";
    flash({ el: target, rx: 170, ry: 90, strength: 0.42, hues: tone === "spectra" ? [3.8, 5.4] : [0.2, 1.2], hold: 500 });
    await sleep(700, beat.signal).catch(() => undefined);
    flyer.remove();
    delete target.dataset.brought;
    return target;
  };

  /** ManageBac moved it: it glides from where it was to where it is now. */
  const move = async (by: number, beat: Beat, said?: string) => {
    const before = itemIn(calendarRef.current, MOVED.title);
    const was = before?.getBoundingClientRect();
    world.shift(MOVED.id, by);
    shifted.current = by > 0;
    const now = was ? await appear(MOVED.title, beat, was, 2400) : null;
    if (!now || !was) return null;
    const box = now.getBoundingClientRect();
    const scale = box.width / (now.offsetWidth || box.width) || 1;
    now.animate(
      [
        { transform: `translate(${(was.left - box.left) / scale}px, ${(was.top - box.top) / scale}px)`, offset: 0 },
        { transform: `translate(${(was.left - box.left) / scale / 2}px, ${(was.top - box.top) / scale / 2 - 26}px) scale(1.08)`, offset: 0.5 },
        { transform: "none", offset: 1 },
      ],
      { duration: 700, easing: "cubic-bezier(0.3, 0.6, 0.25, 1)" },
    );
    const stage = stageRef.current;
    if (said && stage) {
      const room = stage.getBoundingClientRect();
      const tag = label(said, "school");
      tag.classList.add("sp-week-tag--alone");
      Object.assign(tag.style, { left: `${box.left - room.left + box.width / 2}px`, top: `${box.top - room.top}px` });
      stage.append(tag);
      window.setTimeout(() => (tag.dataset.gone = ""), 1500);
      window.setTimeout(() => tag.remove(), 2000);
    }
    return now;
  };

  /** What came in is done with: it lifts off the week. */
  const leave = async (title: string) => {
    const found = itemIn(calendarRef.current, title);
    await found?.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(-10px) scale(0.96)" }], { duration: 320, easing: "ease-in", fill: "forwards" }).finished.catch(() => undefined);
  };

  useLoop(sceneRef, {
    open: async ({ wait, signal }) => {
      // The calendar opens itself on seven once its week has loaded; the school day is set after that.
      for (let tries = 0; !calendarRef.current?.querySelector(".spectra-calendar-block") && tries < 60 && !signal.aborted; tries += 1) await wait(80);
      toHour(8);
      const title = sceneRef.current?.querySelector(".sp-heading");
      const stage = stageRef.current;
      if (title && stage) {
        const box = title.getBoundingClientRect();
        travel("week-title", [box.left + box.width * 0.4, box.top + window.scrollY + box.height * 0.5], stage, {
          at: [0.5, 0.45],
          rx: 420,
          ry: 200,
          strength: 0.3,
          hues: [3.6, 5.2],
          flow: 0.5,
          ease: 500,
          ms: 1600,
        });
        window.setTimeout(() => dimAll("week-title", 1600), 2000);
      }
      await wait(300);
    },
    round: async (beat) => {
      const { wait, signal } = beat;
      await wait(200);

      // Mr Okafor sets the lab report in ManageBac; it comes in and lands on its day.
      const lab = classOf(LAB);
      await arrive(LAB, "left", `${CLASSES[lab].teacher} set this in ManageBac`, "school", beat);
      if (signal.aborted) return;
      await wait(150);

      // Spectra finds the time to write it, after school tomorrow.
      await arrive(BLOCK, "right", "Spectra found 50 minutes, after school", "spectra", beat);
      if (signal.aborted) return;
      await wait(250);

      // Mr Okafor moves the test a day, and it moves.
      const moved = await move(DAY, beat, `Moved to ${MOVED.startAt ? dayName(MOVED.startAt + DAY) : "the next day"}`);
      if (moved) flash({ el: moved, rx: 170, ry: 90, strength: 0.4, hues: [0.6, 1.6], hold: 500 });
      await wait(1500);

      // A new week: what came in is done with, and the test is back where it was.
      await Promise.all([leave(LAB.title), leave(BLOCK.title)]);
      world.unplace(LAB.id, BLOCK.id);
      await move(-DAY, beat);
      shifted.current = false;
      await wait(300);
    },
  });

  return (
    <section ref={sceneRef} className="sp-scene sp-week" aria-labelledby="sp-week-title">
      <style ref={comingRef} />
      <div className="sp-week-copy">
        <Written id="sp-week-title" className="sp-heading" text={"It finds the time\nfor you."} />
        <p className="sp-lede">
          New tasks land on your calendar the moment they&rsquo;re set in ManageBac. Spectra plans the hours to do them, around your
          lessons and everything else.
        </p>
      </div>

      <div ref={stageRef} className="sp-week-stage">
        <div ref={calendarRef} className="sp-week-calendar">
          <Window at="calendar" width={1320} height={700} label="Henry's calendar">
            <div className="sp-calendar">
              <CalendarApplication startAt={TODAY} still />
            </div>
          </Window>
        </div>
      </div>
    </section>
  );
}
