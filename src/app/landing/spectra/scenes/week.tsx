"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, type CSSProperties } from "react";
import { ArtifactEmbed } from "@/features/spectra/components/artifact-embed";
import type { SpectraArtifactEmbed } from "@/features/spectra/data/api";
import { useWorld } from "../../kit/world-context";
import { Written } from "../../kit/written";
import { DEADLINES, REVISION_BLOCKS, type WireItem } from "../../world/school";
import { TODAY, dayAt, dayName } from "../../world/story";
import { CLASSES, type ClassKey } from "../../world/works";
import { morph } from "../../kit/filing";
import { PEOPLE, likeness, sleep, useHands } from "../hands";
import { dimAll, flash, shine, travel } from "../light/light";
import { useLoop, type Beat } from "../loop";
import { Window } from "../window";

/*
 * Henry's week in Spectra's own calendar, kept light: an afternoon lesson a
 * day and what is due. Spectra turns his respiration slides into revision for
 * Wednesday's test, writing the pieces on the deck's last slide, then finds
 * the time for each and carries it there by hand, one free slot after another.
 * Then Mr Okafor sets a lab report in ManageBac and it comes in from beyond
 * the page and lands on its day, and he moves the test a day and it moves.
 * Then a new week, and the same again.
 */

const CalendarApplication = dynamic(() => import("@/features/spectra/calendar/ui/calendar-application").then((module) => module.CalendarApplication), {
  ssr: false,
  loading: () => <div className="sp-calendar-ghost" />,
});

const DAY = 86_400_000;
const LAB: WireItem = { ...DEADLINES.labReport, id: "week-lab" };
const MOVED = DEADLINES.biologyTest;
const TASKS = REVISION_BLOCKS;
const length = (item: WireItem) => Math.round(((item.endAt ?? 0) - (item.startAt ?? 0)) / 60_000);
/** The calendar's height for an hour, and the room left above the first one shown for its label. */
const HOUR = 60;
const LEAD = 14;

/** The film's two: revision for the test, on two different days, each made as a task. */
const timed = (item: WireItem, id: string, day: number, hour: number, minutes: number, minute = 0): WireItem => {
  const startAt = dayAt(day, hour, minute);
  return { ...item, id, startAt, endAt: startAt + minutes * 60_000 };
};
const DROPPED = [
  { item: timed(REVISION_BLOCKS[0]!, "film-rev-1", 0, 16, 60), x: 250, turn: -4, hue: 4.2 },
  { item: timed(REVISION_BLOCKS[1]!, "film-rev-2", 1, 15, 45, 30), x: 690, turn: 3.5, hue: 5.2 },
];
const taskEmbed = (item: WireItem): SpectraArtifactEmbed => ({
  embedId: `landing-${item.id}`,
  containerType: "thread",
  containerId: "landing-week",
  containerRegionId: "reply:landing-week",
  sourceArtifactId: `task-${item.id}`,
  mode: "expanded",
  interaction: "interact",
  versionPolicy: "live",
  contextPolicy: "none",
  state: "ready",
  source: {
    artifactId: `task-${item.id}`,
    title: item.title,
    blueprintKey: "planner_task",
    updatedAt: TODAY,
    snapshot: {
      title: item.title,
      content: { taskTitle: item.title, dueAt: item.startAt, status: "todo", priority: "high", estimateMinutes: length(item) },
    },
  },
});
const DROPPED_EMBEDS = DROPPED.map(({ item }) => taskEmbed(item));

const classOf = (item: WireItem) => (Object.keys(CLASSES) as ClassKey[]).find((key) => CLASSES[key].providerClassId === item.classId) ?? "biology";

/** The calendar's button for an item, found by the title it carries. */
const itemIn = (root: HTMLElement | null, title: string) =>
  [...(root?.querySelectorAll<HTMLElement>("button[title]") ?? [])].find((button) => button.title.includes(title)) ?? null;

export function Week({ film = false }: { film?: boolean }) {
  const world = useWorld();
  const sceneRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const droppedRef = useRef<(HTMLDivElement | null)[]>([]);
  const { layer, hand } = useHands();
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
      world.unplace(LAB.id, ...TASKS.map((task) => task.id), ...DROPPED.map((each) => each.item.id));
      if (shifted.current) world.shift(MOVED.id, -DAY);
    };
  }, [world]);

  /** The week shows the school day from nine, and the evening after it; the hours run under the dates, an hour to sixty pixels. */
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

  /**
   * The film's week: two tasks fall in from above the page, and two of Spectra's
   * hands catch them at once and carry each to its own day.
   */
  const dropTasks = async ({ wait, signal }: Beat) => {
    const stage = stageRef.current;
    const cards = droppedRef.current;
    if (!stage || cards.some((card) => !card)) return;
    await wait(250);
    for (const card of cards) card!.dataset.fallen = "";
    await wait(820);
    if (signal.aborted) return;
    for (const { item } of DROPPED) hold(item.title, true);
    for (const { item } of DROPPED) world.place(item);
    const hands = DROPPED.map(() => hand(PEOPLE.spectra, signal));
    await Promise.all(
      hands.map(async (each, index) => {
        const card = cards[index]!;
        const box = card.getBoundingClientRect();
        await wait(index * 110);
        await each.show(card, [30 / box.width, 22 / box.height]);
        await each.press({ light: false });
      }),
    );
    const copies = hands.map((each, index) => each.grab(cards[index]!));
    for (const card of cards) card!.dataset.taken = "";
    const targets = await Promise.all(DROPPED.map(({ item }) => appear(item.title, { wait, signal } as Beat)));
    const room = stage.getBoundingClientRect();
    await Promise.all(
      hands.map(async (each, index) => {
        const target = targets[index];
        if (!target) return;
        const box = target.getBoundingClientRect();
        await each.move([box.left - room.left + 24, box.top - room.top + 18], { ms: 520, overshoot: false });
        hold(DROPPED[index]!.item.title, false);
        target.dataset.brought = "here";
        flash({ el: target, rx: 150, ry: 80, strength: 0.5, hues: [DROPPED[index]!.hue - 0.6, DROPPED[index]!.hue + 0.6], hold: 400 });
        await morph(copies[index]!, target, stage.querySelector(".sp-hands") as HTMLElement, 340);
        await each.drop();
        window.setTimeout(() => delete target.dataset.brought, 700);
      }),
    );
    await Promise.all(hands.map((each) => each.hide().then(() => each.remove())));
    await wait(60_000);
  };

  useLoop(sceneRef, {
    open: async ({ wait, signal }) => {
      // The calendar opens itself on seven once its week has loaded; the school day is set after that.
      for (let tries = 0; !calendarRef.current?.querySelector(".spectra-calendar-block") && tries < 60 && !signal.aborted; tries += 1) await wait(80);
      toHour(9);
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
      if (film) return dropTasks(beat);
      const { wait, signal } = beat;
      const slide = slideRef.current;
      const stage = stageRef.current;
      if (!slide || !stage) return;
      const rows = TASKS.map((task) => slide.querySelector<HTMLElement>(`[data-task="${task.id}"]`)!);
      await wait(200);

      // The deck's last slide, where Spectra writes the revision it makes of the slides before it.
      slide.dataset.shown = "";
      await wait(420);
      const spectra = hand(PEOPLE.spectra, signal);
      for (const [index, task] of TASKS.entries()) {
        const row = rows[index]!;
        const words = row.querySelector<HTMLElement>(".sp-week-task-title")!;
        await spectra.move(row, { aim: [0.08, 0.5], ms: 340 });
        row.dataset.state = "typing";
        for (let typed = 1; typed <= task.title.length && !signal.aborted; typed += 1) {
          words.textContent = task.title.slice(0, typed);
          await wait(task.title[typed - 1] === " " ? 34 : 15);
        }
        if (signal.aborted) return;
        row.dataset.state = "written";
      }
      await wait(260);

      // It finds the time for each, one free slot after another, and carries each there.
      for (const [index, task] of TASKS.entries()) {
        const row = rows[index]!;
        hold(task.title, true);
        world.place(task);
        const target = await appear(task.title, beat);
        if (!target || signal.aborted) {
          hold(task.title, false);
          return;
        }
        await spectra.move(row, { aim: [0.06, 0.4], ms: 320 });
        await spectra.press({ light: false });
        const from = row.getBoundingClientRect();
        const scale = from.width / (row.offsetWidth || from.width) || 1;
        const copy = spectra.grab(row);
        copy.querySelector<HTMLElement>(".sp-week-task-time")?.style.setProperty("display", "none");
        row.dataset.state = "lifted";
        // On its way it takes the shape of the slot it is going to.
        const box = target.getBoundingClientRect();
        copy.style.setProperty("transition", "width 0.5s cubic-bezier(0.3, 0.6, 0.25, 1), height 0.5s cubic-bezier(0.3, 0.6, 0.25, 1)");
        copy.style.width = `${box.width / scale}px`;
        copy.style.height = `${box.height / scale}px`;
        const room = stage.getBoundingClientRect();
        await spectra.move([box.left - room.left + 24, box.top - room.top + 18], { ms: 560, overshoot: false });
        hold(task.title, false);
        target.dataset.brought = "here";
        flash({ el: target, rx: 150, ry: 70, strength: 0.4, hues: [3.8, 5.4], hold: 400 });
        await spectra.drop({ settle: true });
        row.dataset.state = "placed";
        window.setTimeout(() => delete target.dataset.brought, 700);
        await wait(80);
      }
      void spectra.hide().then(() => spectra.remove());
      await wait(300);

      // Mr Okafor sets the lab report in ManageBac; it comes in and lands on its day.
      const lab = classOf(LAB);
      await arrive(LAB, "left", `${CLASSES[lab].teacher} set this in ManageBac`, "school", beat);
      if (signal.aborted) return;
      await wait(250);

      // Mr Okafor moves the test a day, and it moves.
      const moved = await move(DAY, beat, `Moved to ${MOVED.startAt ? dayName(MOVED.startAt + DAY) : "the next day"}`);
      if (moved) flash({ el: moved, rx: 170, ry: 90, strength: 0.4, hues: [0.6, 1.6], hold: 500 });
      await wait(1500);

      // A new week: what came in is done with, and the test is back where it was.
      await Promise.all([leave(LAB.title), ...TASKS.map((task) => leave(task.title))]);
      world.unplace(LAB.id, ...TASKS.map((task) => task.id));
      delete slide.dataset.shown;
      await move(-DAY, beat);
      shifted.current = false;
      await wait(300);
      for (const row of rows) {
        delete row.dataset.state;
        row.querySelector(".sp-week-task-title")!.textContent = "";
      }
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
        {film
          ? DROPPED.map((each, index) => (
              <div
                key={each.item.id}
                ref={(node) => {
                  droppedRef.current[index] = node;
                }}
                className="sp-week-dropped spectra-artifact-studio"
                style={{ "--x": `${each.x}px`, "--turn": `${each.turn}deg`, "--i": index } as CSSProperties}
                aria-hidden
              >
                <ArtifactEmbed embed={DROPPED_EMBEDS[index]!} />
              </div>
            ))
          : null}
        <div ref={slideRef} className="sp-week-slide" hidden={film} aria-hidden>
          <span className="sp-week-slide-deck">Cell respiration</span>
          <p className="sp-week-slide-title">Before {MOVED.startAt ? dayName(MOVED.startAt) : "the"}&rsquo;s test</p>
          <ol className="sp-week-slide-tasks">
            {TASKS.map((task) => (
              <li key={task.id} data-task={task.id}>
                <span className="sp-week-task-title" />
                <span className="sp-week-task-time">{length(task)} min</span>
              </li>
            ))}
          </ol>
        </div>
        {layer}
      </div>
    </section>
  );
}
