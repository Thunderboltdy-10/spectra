"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Icon } from "@/components/icons";
import { AppWindow } from "@/app/landing/kit/app-window";
import { Scaled } from "@/app/landing/spectra/window";
import { workTypeMeta, type PresentedWorkType } from "@/features/spectra/artifacts/presentation";
import { ShowcaseTime } from "@/features/spectra/showcase/showcase-time";
import { DaySky, dayPart } from "@/features/spectra/today/day-sky";

/*
 * A Home beside the form, drawn with Home's own styles and sky: whose it is
 * changes with the page. Signing in shows a student's morning, signing up a
 * teacher's afternoon, and an invitation the first day of someone who has
 * just joined, with their classes arriving. The moves are done one by one and
 * the clock runs, so the page is quietly alive; it is a picture, not the app,
 * and takes no input.
 */

export type AuthHomeKind = "student" | "teacher" | "joining";

type Move = { title: string; why: string; type: PresentedWorkType; action: string; done: string };
type Item = { title: string; meta: string; ink: string; time?: string };
type Story = { who: string; recapLabel?: string; threads: string[]; start: number; recap: string; moves: Move[]; week: Item[][] };

const MINUTE = 60_000;
const INK = { history: "#b4532a", biology: "#2f8a5b", spanish: "#7a4bc2", english: "#2d6cc0", maths: "#c2417a" };

const STORIES: Record<AuthHomeKind, Story> = {
  student: {
    who: "Henry",
    threads: ["Respiration quiz review", "Wels speech, value", "Spanish oral practice"],
    start: 7 * 60 + 20,
    recap: "You finished the yeast lab results and Spectra made you a quiz and cards for the Biology test.",
    moves: [
      { title: "Do the cell respiration quiz", why: "Your notes are thinnest on the electron transport chain.", type: "quiz", action: "Open", done: "Opened" },
      { title: "Read the two sources", why: "The first step of the History source analysis.", type: "planner_task", action: "Open task", done: "Opened" },
      { title: "Flashcards for the Spanish oral", why: "Vocabulary for el medio ambiente, from your notes.", type: "flashcard_deck", action: "Make it", done: "Started" },
    ],
    week: [
      [{ title: "Biology test", meta: "Biology HL", ink: INK.biology, time: "10:35" }],
      [{ title: "Source analysis", meta: "History HL", ink: INK.history }],
      [],
      [{ title: "Spanish oral", meta: "Spanish B", ink: INK.spanish }],
      [{ title: "Essay plan", meta: "English A", ink: INK.english }],
    ],
  },
  teacher: {
    who: "Ms Gonzalez",
    threads: ["IA criteria, source evaluation", "Tuesday lesson plan", "History HL feedback"],
    start: 14 * 60 + 40,
    recap: "Eighteen of twenty-two History IA drafts are in. Three students asked about evaluating the Wels speech.",
    moves: [
      { title: "Read the IA drafts", why: "Spectra marked the four that cite no sources yet.", type: "document", action: "Open", done: "Opened" },
      { title: "Release the source agent", why: "It knows your criteria and the class's two sources.", type: "planner_task", action: "Open task", done: "Opened" },
      { title: "Slides for Tuesday's lesson", why: "The Enabling Act, from your scheme of work.", type: "presentation", action: "Make it", done: "Started" },
    ],
    week: [
      [{ title: "History HL", meta: "Room 14", ink: INK.history, time: "15:10" }],
      [{ title: "IA drafts due", meta: "History HL", ink: INK.history }],
      [{ title: "History SL", meta: "Room 14", ink: INK.history }],
      [],
      [{ title: "Staff meeting", meta: "Library", ink: INK.english }],
    ],
  },
  joining: {
    who: "You",
    recapLabel: "Welcome",
    threads: [],
    start: 8 * 60 + 5,
    recap: "Your classes are coming in from your school, with their tasks and deadlines.",
    moves: [
      { title: "Meet your classes", why: "Each one has its own place for notes, files and tasks.", type: "planner_task", action: "Open", done: "Opened" },
      { title: "Put Bridge on your laptop", why: "The folders you choose stay in step with Spectra.", type: "document", action: "Open", done: "Opened" },
      { title: "Ask Spectra anything", why: "About a class, a task, or something you are stuck on.", type: "thread_reference", action: "Ask", done: "Asked" },
    ],
    week: [
      [{ title: "Biology HL", meta: "From ManageBac", ink: INK.biology, time: "09:00" }],
      [{ title: "Maths AA", meta: "From ManageBac", ink: INK.maths }],
      [{ title: "History HL", meta: "From ManageBac", ink: INK.history }],
      [{ title: "English A", meta: "From ManageBac", ink: INK.english }],
      [{ title: "Spanish B", meta: "From ManageBac", ink: INK.spanish }],
    ],
  },
};

/** Today at `minute`, by the reader's clock. */
const todayAt = (minute: number) => {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  return day.getTime() + minute * MINUTE;
};

export function AuthHome({ kind }: { kind: AuthHomeKind }) {
  const story = STORIES[kind];
  const [step, setStep] = useState(0);
  const [minute, setMinute] = useState(story.start);

  // One beat every few seconds: a move is done, or (joining) a class arrives;
  // the clock moves on a quarter of an hour. After the last, it starts again.
  useEffect(() => {
    const steps = kind === "joining" ? 8 : 3;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(steps);
      return;
    }
    const timer = window.setInterval(() => {
      setStep((current) => (current >= steps + 1 ? 0 : current + 1));
      setMinute((current) => current + 15);
    }, 2600);
    return () => window.clearInterval(timer);
  }, [kind]);
  useEffect(() => {
    if (step === 0) setMinute(story.start);
  }, [step, story.start]);

  const done = Math.max(0, Math.min(story.moves.length, kind === "joining" ? step - 5 : step));
  const arrived = kind === "joining" ? Math.min(5, step + 1) : 5;
  const hour = Math.floor(minute / 60);
  const greeting = `Good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}${kind === "joining" ? "" : `, ${story.who}`}.`;

  return (
    <div className="auth-home" inert aria-hidden>
      <ShowcaseTime.Provider value={todayAt(minute)}>
        <Scaled width={1160} height={720} className="auth-home-window">
          <AppWindow at="home" rail="full" who={story.who} threads={story.threads} label={`${story.who}'s Home`}>
          <div className="auth-home-page">
            <h2 className="page-greeting">{greeting}</h2>
            <section className="morning">
              <div className="morning-dawn">
                <DaySky />
                <p className="morning-title">Your {dayPart(hour)}</p>
              </div>
              <div className="morning-body">
                <div>
                  <p className="morning-label">{story.recapLabel ?? "Yesterday"}</p>
                  <p className="morning-recap">{story.recap}</p>
                </div>
                <div>
                  <p className="morning-label">For today</p>
                  <ul className="morning-moves">
                    {story.moves.map((move, index) => {
                      const meta = workTypeMeta[move.type];
                      const isDone = index < done;
                      return (
                        <li
                          key={move.title}
                          className="morning-move"
                          data-done={isDone || undefined}
                          style={{ "--move-ink": meta.color, "--move-tint": meta.soft } as CSSProperties}
                        >
                          <span className="morning-move-tile">
                            <Icon name={isDone ? "check" : meta.glyph} size={15} />
                          </span>
                          <div className="min-w-0">
                            <p className="morning-move-title">{move.title}</p>
                            <p className="morning-move-why">{move.why}</p>
                          </div>
                          <span className="morning-move-action">{isDone ? move.done : move.action}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </section>
            <section className="auth-home-week">
              <div className="today-section-head">
                <h3>This week</h3>
              </div>
              <ol className="today-week">
                {Array.from({ length: 7 }, (_, index) => story.week[index] ?? []).map((items, index) => {
                  const date = new Date(todayAt(0) + index * 24 * 60 * MINUTE);
                  const name = new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(date);
                  const shown = index < arrived ? items : [];
                  const waiting = kind === "joining" && index < 5 && !shown.length;
                  return (
                    <li key={index} className="today-day" data-today={index === 0 || undefined}>
                      <p className="today-day-head">
                        <span className="today-day-date">{date.getDate()}</span>
                        <span className="today-day-name">
                          {index === 0 ? "Today" : name}
                          {index === 0 ? <span className="block font-normal text-[var(--text-tertiary)]">{name}</span> : null}
                        </span>
                      </p>
                      {shown.length ? (
                        <ul className="today-day-items">
                          {shown.map((item) => (
                            <li key={item.title}>
                              <span className="today-day-item" style={{ "--class-ink": item.ink } as CSSProperties}>
                                <span className="today-day-item-title">{item.title}</span>
                                <span className="today-day-item-meta">
                                  <span className="truncate">{item.meta}</span>
                                  {index === 0 && item.time ? <span className="ml-auto shrink-0 tabular-nums">{item.time}</span> : null}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="today-day-free">{waiting ? "Arriving" : "Free"}</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
          </AppWindow>
        </Scaled>
      </ShowcaseTime.Provider>
    </div>
  );
}
