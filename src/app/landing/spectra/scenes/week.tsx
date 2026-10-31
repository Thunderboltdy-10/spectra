"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, type CSSProperties } from "react";
import { ArtifactEmbed } from "@/features/spectra/components/artifact-embed";
import type { SpectraArtifactEmbed } from "@/features/spectra/data/api";
import { useWorld } from "../../kit/world-context";
import { Written } from "../../kit/written";
import { REVISION_BLOCKS, type WireItem } from "../../world/school";
import { TODAY, dayAt } from "../../world/story";
import { morph } from "../../kit/filing";
import { PEOPLE, useHands } from "../hands";
import { dimAll, flash, shine, travel } from "../light/light";
import { useLoop, type Beat } from "../loop";
import { Window } from "../window";

/*
 * The launch film's calendar sequence, shared with the landing: two task
 * cards fall in from above, and Spectra carries each to its free slot.
 * The landing clears the placed tasks and repeats while the scene is visible.
 */

const CalendarApplication = dynamic(() => import("@/features/spectra/calendar/ui/calendar-application").then((module) => module.CalendarApplication), {
  ssr: false,
  loading: () => <div className="sp-calendar-ghost" />,
});

const length = (item: WireItem) => Math.round(((item.endAt ?? 0) - (item.startAt ?? 0)) / 60_000);
/** The calendar's height for an hour, and the room left above the first one shown for its label. */
const HOUR = 60;
const LEAD = 14;

/** The launch film's two tasks, reused on the landing unchanged. */
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

/** The calendar's button for an item, found by the title it carries. */
const itemIn = (root: HTMLElement | null, title: string) =>
  [...(root?.querySelectorAll<HTMLElement>("button[title]") ?? [])].find((button) => button.title.includes(title)) ?? null;

export function Week({ film = false }: { film?: boolean }) {
  const world = useWorld();
  const sceneRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const droppedRef = useRef<(HTMLDivElement | null)[]>([]);
  const { layer, hand } = useHands();
  /** Hides what is on its way in, from the moment the calendar first draws it until it lands. */
  const comingRef = useRef<HTMLStyleElement>(null);
  const coming = useRef(new Set<string>());

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
      world.unplace(...DROPPED.map((each) => each.item.id));
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

  /** What came in is done with: it lifts off the week. */
  const leave = async (title: string) => {
    const found = itemIn(calendarRef.current, title);
    await found?.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(-10px) scale(0.96)" }], { duration: 320, easing: "ease-in" }).finished.catch(() => undefined);
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
    await wait(film ? 60_000 : 2600);
    if (film || signal.aborted) return;

    // Keep the film's drop intact; reset its cards and calendar slots for the next round.
    await Promise.all(DROPPED.map(({ item }) => leave(item.title)));
    for (const { item } of DROPPED) hold(item.title, true);
    world.unplace(...DROPPED.map(({ item }) => item.id));
    for (const card of cards) delete card!.dataset.fallen;
    // Rewind the cards while they are still hidden by data-taken.
    await wait(1000);
    for (const card of cards) delete card!.dataset.taken;
  };

  useLoop(sceneRef, {
    open: async ({ wait, signal, still }) => {
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
      if (still) for (const { item } of DROPPED) world.place(item);
    },
    round: dropTasks,
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
        {DROPPED.map((each, index) => (
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
        ))}
        {layer}
      </div>
    </section>
  );
}
