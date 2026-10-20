"use client";

/*
 * How much of the time a task had is gone: one thin rule from the day it was
 * made to the day it is due, filled as far as today, with when it was added
 * under it (the time left is said beside the due date, once). It shows only
 * once there is a due date to run towards.
 */

const DAY = 86_400_000;

function ago(from: number, now: number) {
  const days = Math.floor((now - from) / DAY);
  if (days <= 0) return "Added today";
  if (days === 1) return "Added yesterday";
  if (days < 14) return `Added ${days} days ago`;
  const weeks = Math.round(days / 7);
  return `Added ${weeks} weeks ago`;
}

export function TaskElapsed({ createdAt, due, done, now }: { createdAt: number | undefined; due: number | null; done: boolean; now: number }) {
  if (due === null || createdAt === undefined || done) return null;
  const span = Math.max(due - createdAt, 1);
  const used = Math.min(1, Math.max(0, (now - createdAt) / span));
  const late = now > due;
  return (
    <div className="task-elapsed" data-late={late || undefined} role="img" aria-label={`${Math.round(used * 100)}% of the time until it is due has passed`}>
      <span className="task-elapsed-rule">
        <span style={{ width: `${used * 100}%` }} />
      </span>
      <span className="task-elapsed-words">{ago(createdAt, now)}</span>
    </div>
  );
}
