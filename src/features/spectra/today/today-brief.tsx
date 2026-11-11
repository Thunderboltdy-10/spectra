"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { WorkingMark } from "@/components/ui/skeleton";
import { workTypeMeta, type PresentedWorkType } from "../artifacts/presentation";
import { dueSentence, taskInstant } from "../components/task/task-time";
import type { BriefSuggestion, BriefTaskDraft } from "./daily-brief";
import { useShowcaseTime } from "../showcase/showcase-time";
import { dayPart } from "./day-sky";
import type { TodayAgenda } from "./today-model";
import { useBriefActions } from "./use-brief-actions";
import { spectraBus } from "../events";
import type { BriefState } from "./use-daily-brief";

/*
 * The morning brief on Home (HOME.md, "The morning brief"). It is waiting
 * when the student wakes: the sky over the time it is now, yesterday in a
 * few lines, then the day's few moves, each one press away. Nothing on it is
 * a card and there is no writing it again; tomorrow brings the next one, and
 * until it is ready the last one stays.
 */

const ACTION: Record<BriefSuggestion["kind"], { label: string; done: string }> = {
  make: { label: "Make it", done: "Started" },
  add: { label: "Add task", done: "Added" },
  open: { label: "Open", done: "Opened" },
  task: { label: "Open task", done: "Opened" },
  ask: { label: "Ask", done: "Asked" },
};

const presented = (key: string | undefined): key is PresentedWorkType => Boolean(key && key in workTypeMeta);

/** The type a suggestion is drawn in: the work it makes or opens, a task, or a thread. */
function typeOf(suggestion: BriefSuggestion): PresentedWorkType {
  if (suggestion.kind === "task" || suggestion.kind === "add") return "planner_task";
  if (suggestion.kind === "ask") return "thread_reference";
  return presented(suggestion.workType) ? suggestion.workType : "document";
}

export function TodayBrief({ brief, agenda }: { brief: BriefState; agenda: TodayAgenda | null }) {
  if (brief.status === "writing")
    return (
      <section aria-label="Your morning" className="morning" data-writing>
        <p className="morning-writing">
          <WorkingMark />
          Spectra is getting your morning ready.
        </p>
      </section>
    );
  if (brief.status === "quiet")
    return (
      <section aria-label="Your morning" className="morning" data-writing>
        <p className="morning-writing">
          Your brief is taking longer than usual.{" "}
          <button
            type="button"
            className="cursor-pointer underline underline-offset-2"
            onClick={() =>
              spectraBus.emit("island.compose", {
                fresh: true,
                text: "Help me plan ahead: look at what's coming up in my calendar and tasks, and suggest what to do this week.",
              })
            }
          >
            Plan the week with Spectra
          </button>
        </p>
      </section>
    );
  if (brief.status !== "ready") return null;
  return <ReadyBrief brief={brief} agenda={agenda} />;
}

function ReadyBrief({ brief, agenda }: { brief: Extract<BriefState, { status: "ready" }>; agenda: TodayAgenda | null }) {
  const act = useBriefActions(brief.day, agenda);
  // The part of the day is the sky's: the reader's clock, or the story's on a showcase.
  const story = useShowcaseTime();
  const hour = new Date(story ?? Date.now()).getHours();
  const [busy, setBusy] = useState<number | null>(null);
  // What is still to do comes first; what was done today sinks to the end, each keeping its place in the brief.
  const moves = brief.suggestions
    .map((suggestion, index) => ({ suggestion, index }))
    .sort((a, b) => Number(Boolean(a.suggestion.done)) - Number(Boolean(b.suggestion.done)));
  const press = (suggestion: BriefSuggestion, index: number) => {
    if (busy !== null) return;
    setBusy(index);
    void Promise.resolve(act(suggestion, index))
      .catch(() => undefined)
      .finally(() => setBusy(null));
  };

  return (
    <section aria-labelledby="morning-title" className="morning">
      <div className="morning-dawn">
        <h2 id="morning-title" className="morning-title">
          {brief.earlier ? "Yesterday's brief" : `Your ${dayPart(hour)}`}
        </h2>
        {brief.earlier ? <p className="morning-earlier">Today&apos;s is on its way.</p> : null}
      </div>
      <div className="morning-body">
        {brief.ahead || brief.recap ? (
          <BriefFold className="morning-story-fold">
          <div className="morning-story">
            {brief.ahead ? (
              <div>
                <h3 className="morning-label">Coming up</h3>
                <p className="morning-recap">{brief.ahead}</p>
              </div>
            ) : null}
            {brief.recap ? (
              <div>
                <h3 className="morning-label">{brief.earlier ? "The day before" : "Yesterday"}</h3>
                <p className={brief.ahead ? "morning-recap-small" : "morning-recap"}>{brief.recap}</p>
              </div>
            ) : null}
          </div>
          </BriefFold>
        ) : null}
        {brief.suggestions.length ? (
          <BriefFold className="morning-moves-fold">
            <h3 className="morning-label">{brief.earlier ? "From the last brief" : "For today"}</h3>
            <ul className="morning-moves">
              {moves.map(({ suggestion, index }) => (
                <Move key={index} suggestion={suggestion} busy={busy === index} onPress={() => press(suggestion, index)} />
              ))}
            </ul>
          </BriefFold>
        ) : null}
      </div>
    </section>
  );
}

/**
 * One side of the brief at its height. Whatever does not fit fades into the
 * page under it and is one scroll, or one press, away. The story and the moves
 * fold apart: each runs to its own length.
 */
function BriefFold({ className, children }: { className: string; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [atEnd, setAtEnd] = useState(false);

  const measure = () => {
    const box = scroller.current;
    const inner = body.current;
    if (!box || !inner) return;
    box.style.setProperty("--morning-open-height", `${inner.offsetHeight}px`);
    const limit = Number.parseFloat(getComputedStyle(box.parentElement!).getPropertyValue("--morning-limit-px")) || 0;
    const shortest = limit || box.clientHeight;
    setOverflows(inner.offsetHeight > shortest + 8);
    setAtEnd(box.scrollTop + box.clientHeight >= box.scrollHeight - 12);
  };

  useLayoutEffect(measure);
  useEffect(() => {
    if (!body.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(body.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={`morning-fold ${className}`} data-open={open || undefined} data-overflows={overflows || undefined} data-end={atEnd || undefined}>
      <div ref={scroller} className="morning-scroll spectra-thin-scrollbar" onScroll={measure} tabIndex={overflows && !open ? 0 : undefined}>
        <div ref={body}>
          {children}
        </div>
      </div>
      {overflows ? (
        <button
          type="button"
          className="morning-fold-toggle"
          aria-expanded={open}
          onClick={() => {
            if (open) scroller.current?.scrollTo({ top: 0 });
            setOpen((value) => !value);
          }}
        >
          {open ? "Show less" : "Show all"}
          <Icon name={open ? "chevronUp" : "chevronDown"} size={13} />
        </button>
      ) : null}
    </div>
  );
}

function Move({ suggestion, busy, onPress }: { suggestion: BriefSuggestion; busy: boolean; onPress: () => void }) {
  const meta = workTypeMeta[typeOf(suggestion)];
  const action = ACTION[suggestion.kind];
  const done = Boolean(suggestion.done);
  const style = { "--move-ink": meta.color, "--move-tint": meta.soft } as CSSProperties;
  return (
    <li className="morning-move" data-kind={suggestion.kind} data-done={done || undefined} style={style}>
      <span className="morning-move-tile" aria-hidden>
        <Icon name={done ? "check" : meta.glyph} size={15} />
      </span>
      <div className="min-w-0">
        <p className="morning-move-title">{suggestion.title}</p>
        {suggestion.why ? <p className="morning-move-why">{suggestion.why}</p> : null}
        {suggestion.kind === "add" && suggestion.task ? <TaskDraft task={suggestion.task} /> : null}
        {suggestion.kind === "make" ? <p className="morning-move-detail">{meta.label}</p> : null}
        {suggestion.steps?.length && !done ? (
          <details className="morning-move-how">
            <summary>How to do it</summary>
            <ol>
              {suggestion.steps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>
      <button
        type="button"
        className="morning-move-action"
        disabled={busy || (done && !suggestion.doneId)}
        onClick={onPress}
        aria-label={`${done ? (suggestion.doneId ? "Open" : action.done) : action.label}: ${suggestion.title}`}
      >
        {busy ? <WorkingMark /> : done ? (suggestion.doneId ? "Open" : action.done) : action.label}
      </button>
    </li>
  );
}

/** What the brief filled in for a task it proposes, so adding it is one press. */
function TaskDraft({ task }: { task: BriefTaskDraft }) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const due = task.dueDay ? dueSentence(taskInstant(task.dueDay, task.dueTime ?? null, timeZone), !task.dueTime, timeZone) : null;
  return (
    <div className="morning-move-draft">
      {due ? (
        <span>
          <Icon name="task" size={12} />
          {due}
        </span>
      ) : null}
      {task.estimateMinutes ? <span>{task.estimateMinutes} min</span> : null}
      {task.steps?.length ? (
        <span title={task.steps.join("\n")}>
          <Icon name="checklist" size={12} />
          {task.steps.length} {task.steps.length === 1 ? "step" : "steps"}
        </span>
      ) : null}
    </div>
  );
}
