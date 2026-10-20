"use client";

import { useState, type CSSProperties } from "react";
import { Icon } from "@/components/icons";
import { WorkingMark } from "@/components/ui/skeleton";
import { workTypeMeta, type PresentedWorkType } from "../artifacts/presentation";
import { dueSentence, taskInstant } from "../components/task/task-time";
import type { BriefSuggestion, BriefTaskDraft } from "./daily-brief";
import type { TodayAgenda } from "./today-model";
import { useBriefActions } from "./use-brief-actions";
import type { BriefState } from "./use-daily-brief";

/*
 * The morning brief on Home (HOME.md, "The morning brief"). It is waiting
 * when the student wakes: the sun over the time they wake, yesterday in a
 * few lines, then the day's few moves, each one press away. Nothing on it is
 * a card and there is no writing it again; tomorrow brings the next one.
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

/** "7:00" or "07:00", as the reader's clock writes it. */
function clockTime(wakeTime: string) {
  const [hour = 0, minute = 0] = wakeTime.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hour, minute));
}

function SunMark({ rising }: { rising?: boolean }) {
  return (
    <svg className="morning-sun" data-rising={rising || undefined} viewBox="0 0 64 40" aria-hidden>
      <g className="morning-sun-rays">
        <path d="M32 4v5M14.5 11.5l3.4 3.4M49.5 11.5l-3.4 3.4M6 27h5M53 27h5" />
      </g>
      <clipPath id="morning-horizon">
        <rect x="0" y="0" width="64" height="31" />
      </clipPath>
      <circle className="morning-sun-disc" cx="32" cy="31" r="13" clipPath="url(#morning-horizon)" />
      <path className="morning-sun-horizon" d="M2 31h60" />
    </svg>
  );
}

export function TodayBrief({ brief, agenda }: { brief: BriefState; agenda: TodayAgenda | null }) {
  if (brief.status === "writing")
    return (
      <section aria-label="Your morning" className="morning" data-writing>
        <div className="morning-dawn">
          <SunMark />
          <span className="morning-time">{clockTime(brief.wakeTime)}</span>
        </div>
        <p className="morning-writing">
          <WorkingMark />
          Spectra is getting your morning ready.
        </p>
      </section>
    );
  if (brief.status !== "ready") return null;
  return <ReadyBrief brief={brief} agenda={agenda} />;
}

function ReadyBrief({ brief, agenda }: { brief: Extract<BriefState, { status: "ready" }>; agenda: TodayAgenda | null }) {
  const act = useBriefActions(brief.day, agenda);
  const [busy, setBusy] = useState<number | null>(null);
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
        <SunMark rising />
        <span className="morning-time">{clockTime(brief.wakeTime)}</span>
        <h2 id="morning-title" className="morning-title">
          Your morning
        </h2>
      </div>
      <div className="morning-body">
        {brief.recap ? (
          <div>
            <h3 className="morning-label">Yesterday</h3>
            <p className="morning-recap">{brief.recap}</p>
          </div>
        ) : null}
        {brief.suggestions.length ? (
          <div>
            <h3 className="morning-label">For today</h3>
            <ul className="morning-moves">
              {brief.suggestions.map((suggestion, index) => (
                <Move key={index} suggestion={suggestion} busy={busy === index} onPress={() => press(suggestion, index)} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
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
