"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Written } from "../../kit/written";
import { dayAt } from "../../world/story";
import { PEOPLE, useHands, sleep } from "../hands";
import { dimAll, shine, travel } from "../light/light";
import { useLoop, type Beat } from "../loop";
import { Scaled } from "../window";

/*
 * Henry's classes as books on a shelf, one open in front of him: the class on
 * its cover (teacher, when it meets, how much is in it, when ManageBac last
 * synced), and on the page what is due, what he made for it and what the
 * teacher shared. To change class he presses another spine: it lifts as the
 * hand reaches it, and the open book closes and opens again as that class. A
 * visitor can press any spine themselves.
 */

type Key = "history" | "biology" | "english" | "maths" | "spanish";
type Row = { title: string; meta: string };
type Work = Row & { kind: string; icon: IconName; tint: string };
type Book = {
  name: string;
  spine: string;
  level?: string;
  teacher: string;
  meets: string;
  counts: string;
  synced: string;
  ink: string;
  cover: string;
  coverInk: string;
  hue: number;
  height: number;
  due: Row[];
  work: Work[];
  shared: Row;
};

const day = (offset: number) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(dayAt(offset, 9));

const KIND = {
  document: { kind: "Document", icon: "document", tint: "#4f9fe6" },
  slides: { kind: "Slides", icon: "slides", tint: "#ffab4a" },
  sheet: { kind: "Sheet", icon: "sheet", tint: "#48c997" },
  quiz: { kind: "Quiz", icon: "quiz", tint: "#ff647f" },
  cards: { kind: "Flashcards", icon: "flashcards", tint: "#9176e8" },
} satisfies Record<string, { kind: string; icon: IconName; tint: string }>;

const BOOKS: Record<Key, Book> = {
  history: {
    name: "History HL",
    spine: "History",
    level: "HL",
    teacher: "Ms Gonzalez",
    meets: "Tuesdays and Thursdays, room 14",
    counts: "14 works, 3 tasks to do",
    synced: "Synced from ManageBac 4 min ago",
    ink: "#4f9fe6",
    cover: "#dbe9f8",
    coverInk: "#2c4a66",
    hue: 4.1,
    height: 372,
    due: [
      { title: "Source analysis: the Enabling Act", meta: day(2) },
      { title: "IA first draft", meta: day(16) },
    ],
    work: [
      { title: "History IA draft", meta: "Edited today", ...KIND.document },
      { title: "Weimar to the Third Reich", meta: "6 days ago", ...KIND.slides },
    ],
    shared: { title: "Enabling Act source pack.pdf", meta: "Added today" },
  },
  biology: {
    name: "Biology SL",
    spine: "Biology",
    level: "SL",
    teacher: "Mr Okafor",
    meets: "Mondays and Thursdays, lab 3",
    counts: "11 works, 2 tasks to do",
    synced: "Synced from ManageBac 4 min ago",
    ink: "#ff647f",
    cover: "#ffdfe4",
    coverInk: "#7a2a3b",
    hue: 0.1,
    height: 392,
    due: [
      { title: "Unit test: cell respiration", meta: day(4) },
      { title: "Lab report: yeast respiration", meta: day(6) },
    ],
    work: [
      { title: "Cell respiration notes", meta: "Edited yesterday", ...KIND.document },
      { title: "Respiration cards", meta: "24 cards", ...KIND.cards },
    ],
    shared: { title: "Yeast lab method.pdf", meta: "Added Monday" },
  },
  english: {
    name: "English A",
    spine: "English A",
    level: "HL",
    teacher: "Ms Lindqvist",
    meets: "Wednesdays and Fridays, room 9",
    counts: "9 works, 1 task to do",
    synced: "Synced from ManageBac 4 min ago",
    ink: "#e6bf2e",
    cover: "#fbf0bf",
    coverInk: "#6b5410",
    hue: 2,
    height: 350,
    due: [{ title: "Paper 2 practice essay", meta: day(6) }],
    work: [
      { title: "Essay plan: The Great Gatsby", meta: "3 days ago", ...KIND.document },
      { title: "Quotations to learn", meta: "18 cards", ...KIND.cards },
    ],
    shared: { title: "Paper 2 mark scheme.pdf", meta: "Added last week" },
  },
  maths: {
    name: "Maths AA SL",
    spine: "Maths AA",
    level: "SL",
    teacher: "Mr Haddad",
    meets: "Every day but Wednesday, room 6",
    counts: "12 works, 2 tasks to do",
    synced: "Synced from ManageBac 4 min ago",
    ink: "#48c997",
    cover: "#d3f0e2",
    coverInk: "#1f5a43",
    hue: 3,
    height: 398,
    due: [
      { title: "Problem set 4: sequences and series", meta: day(4) },
      { title: "Exploration topic", meta: day(13) },
    ],
    work: [
      { title: "Sequences: worked examples", meta: "2 days ago", ...KIND.document },
      { title: "Series check", meta: "8 questions", ...KIND.quiz },
    ],
    shared: { title: "Formula booklet.pdf", meta: "Added in September" },
  },
  spanish: {
    name: "Spanish B",
    spine: "Spanish B",
    level: "SL",
    teacher: "Sra. Ruiz",
    meets: "Tuesdays and Fridays, room 2",
    counts: "8 works, 1 task to do",
    synced: "Synced from ManageBac 4 min ago",
    ink: "#9176e8",
    cover: "#e6defb",
    coverInk: "#40307a",
    hue: 5,
    height: 362,
    due: [{ title: "Individual oral: el medio ambiente", meta: day(8) }],
    work: [
      { title: "El medio ambiente: vocabulario", meta: "4 days ago", ...KIND.cards },
      { title: "Oral practice answers", meta: "Edited today", ...KIND.document },
    ],
    shared: { title: "Oral prompts, images.pdf", meta: "Added Tuesday" },
  },
};

const KEYS = Object.keys(BOOKS) as Key[];
const inks = (book: Book) => ({ "--ink": book.ink, "--cover": book.cover, "--cover-ink": book.coverInk }) as CSSProperties;

/** The width and height the stage is drawn at; it is scaled to the page. */
const STAGE = { width: 1240, height: 480 };
const FOLD = 520;

export function Classes() {
  const sceneRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const { layer, hand } = useHands();
  const [open, setOpen] = useState<Key>("history");
  /** Open, or closed (the leaf folded over) while it changes class. */
  const [phase, setPhase] = useState<"open" | "closed">("open");
  const [lift, setLift] = useState<Key | null>(null);
  const busy = useRef(false);
  const chosenAt = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;

  const book = BOOKS[open];

  // The open book lies in its class's light.
  useEffect(() => {
    const target = bookRef.current;
    if (!target) return;
    // After the book has opened, so the light never shows through the turning page.
    const timer = window.setTimeout(
      () => shine("classes-book", { el: target, at: [0.5, 0.62], rx: 520, ry: 230, strength: 0.26, hues: [book.hue - 0.5, book.hue + 0.5], flow: 0.5, ease: 1400 }),
      FOLD,
    );
    return () => window.clearTimeout(timer);
  }, [book.hue]);
  useEffect(() => () => dimAll("classes"), []);

  /** Opens `next`: the open book closes, and opens again as the new class. */
  const take = useCallback(async (next: Key) => {
    if (busy.current || next === openRef.current) return;
    busy.current = true;
    setLift(null);
    dimAll("classes-book", 400);
    setPhase("closed");
    await sleep(FOLD);
    setOpen(next);
    // One frame closed with the new class inside, then it opens.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    setPhase("open");
    await sleep(FOLD);
    busy.current = false;
  }, []);

  useLoop(sceneRef, {
    open: async ({ wait }) => {
      const title = sceneRef.current?.querySelector(".sp-heading");
      const stage = stageRef.current;
      if (title && stage) {
        const box = title.getBoundingClientRect();
        travel("classes-title", [box.left + box.width * 0.2, box.top + window.scrollY + box.height * 0.5], stage, {
          at: [0.62, 0.55],
          rx: 360,
          ry: 180,
          strength: 0.32,
          hues: [3.6, 4.6],
          flow: 0.4,
          ease: 500,
          ms: 1700,
        });
        window.setTimeout(() => dimAll("classes-title", 1500), 2000);
      }
      await wait(700);
    },
    round: async ({ wait, signal }: Beat) => {
      for (let step = 1; step <= KEYS.length && !signal.aborted; step += 1) {
        // Long enough to see each class, then on to the next.
        await wait(1500);
        // A visitor reading a book they chose is left to it for a while.
        while (performance.now() - chosenAt.current < 9000 && !signal.aborted) await wait(500);
        if (signal.aborted) return;
        const next = KEYS[(KEYS.indexOf(openRef.current) + 1) % KEYS.length]!;
        const spine = stageRef.current?.querySelector<HTMLElement>(`[data-spine="${next}"]`);
        if (!spine) return;
        const henry = hand(PEOPLE.henry, signal);
        await henry.show(spine, [0.5, 0.78]);
        setLift(next);
        await henry.move(spine, { ms: 260, aim: [0.5, 0.42] });
        await wait(120);
        await henry.press();
        void take(next);
        await wait(120);
        await henry.hide();
        henry.remove();
        while (busy.current && !signal.aborted) await wait(120);
      }
    },
  });

  return (
    <section ref={sceneRef} className="sp-scene sp-classes" aria-labelledby="sp-classes-title">
      <div className="sp-scene-copy">
        <Written id="sp-classes-title" className="sp-heading" text={"Every class,\nalready set up."} />
        <p className="sp-lede">
          Connect ManageBac once. Classes, tasks, your work and what teachers share arrive by themselves, and stay up to date.
        </p>
      </div>

      <div className="sp-cl-room">
        <Scaled width={STAGE.width} height={STAGE.height} least={0.8}>
          <div ref={stageRef} className="sp-cl-stage" style={{ width: "100%", height: "100%" }}>
            <div className="sp-cl-shelf" role="tablist" aria-label="Henry's classes">
              {KEYS.map((key) => {
                const entry = BOOKS[key];
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={open === key}
                    aria-label={entry.name}
                    className="sp-cl-spine"
                    data-spine={key}
                    data-lift={lift === key || undefined}
                    style={{ ...inks(entry), height: entry.height }}
                    onClick={() => {
                      chosenAt.current = performance.now();
                      void take(key);
                    }}
                  >
                    <i className="sp-cl-band" aria-hidden />
                    <span className="sp-cl-spine-name">
                      {entry.spine}
                      {entry.level ? <span className="sp-cl-spine-level"> {entry.level}</span> : null}
                    </span>
                  </button>
                );
              })}
              <span className="sp-cl-board" aria-hidden />
            </div>

            <div ref={bookRef} className="sp-cl-book" data-phase={phase} style={inks(book)} role="tabpanel" aria-label={book.name}>
              <div className="sp-cl-cover">
                <div>
                  <i className="sp-cl-band" aria-hidden />
                  <h3 className="sp-cl-name">{book.name}</h3>
                  <p className="sp-cl-meets">
                    {book.teacher}
                    <br />
                    {book.meets}
                  </p>
                </div>
                <div className="sp-cl-facts">
                  <span>{book.counts}</span>
                  <span className="sp-cl-synced">
                    <i aria-hidden />
                    {book.synced}
                  </span>
                </div>
              </div>
              <div className="sp-cl-leaf">
                <div className="sp-cl-page">
                  <section>
                    <h4>Due</h4>
                    {book.due.map((row) => (
                      <p key={row.title} className="sp-cl-row">
                        <b>{row.title}</b>
                        <span>{row.meta}</span>
                      </p>
                    ))}
                  </section>
                  <section>
                    <h4>Your work</h4>
                    {book.work.map((row) => (
                      <p key={row.title} className="sp-cl-row sp-cl-work" style={{ "--tint": row.tint } as CSSProperties}>
                        <span className="sp-cl-kind">
                          <Icon name={row.icon} size={13} />
                        </span>
                        <b>{row.title}</b>
                        <span>{row.meta}</span>
                      </p>
                    ))}
                  </section>
                  <section>
                    <h4>From {book.teacher}</h4>
                    <p className="sp-cl-row">
                      <b>{book.shared.title}</b>
                      <span>{book.shared.meta}</span>
                    </p>
                  </section>
                </div>
                <div className="sp-cl-back" aria-hidden>
                  <i className="sp-cl-band" />
                  <b>{book.name}</b>
                </div>
              </div>
            </div>
          </div>
        </Scaled>
        {layer}
      </div>
    </section>
  );
}
