"use client";

import { CalendarDays, Check } from "@/components/icons/glyph-icons";
import type { PlanStatus } from "../../plan/model";
import { PLAN_STATUS_LABELS, PLAN_STATUS_ORDER, type PlanListRow } from "../../plan/projections";
import { dateInput, dueLabel, isOverdue, STATUS_INK } from "./plan-format";

/*
 * One line on the to-do page (EDITORS.md, "Plan"). The round check at its
 * head finishes the task, and shows how far along it is: dotted when it is
 * someday, half filled while it is being done, amber when it is stuck. The
 * title opens the task's own page. A status other than the usual says so in
 * a small tag; the due date sits at the right edge as the reader scans for it.
 */

export function PlanTaskRow({
  row,
  now,
  canEdit,
  open,
  selecting,
  selected,
  onToggleSelect,
  onOpen,
  onStatus,
  onDue,
}: {
  row: PlanListRow;
  now: number;
  canEdit: boolean;
  /** This task's page is open beside the list. */
  open: boolean;
  selecting: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onStatus: (status: PlanStatus) => void;
  onDue: (date: string) => void;
}) {
  const { task } = row;
  const done = task.status === "done";
  const steps = task.checklist.length;
  const stepsDone = task.checklist.filter((item) => item.done).length;
  const label = dueLabel(task, now);
  const official = Boolean(task.officialDeadlineRef);

  return (
    <li
      className="plan-row"
      data-status={task.status}
      data-open={open || undefined}
      data-selected={selected || undefined}
      data-life-object=""
      style={{ ["--depth" as string]: row.depth, ["--status-ink" as string]: STATUS_INK[task.status] }}
    >
      {selecting ? (
        <button type="button" className="plan-row-select" aria-label={`Select ${task.title}`} aria-pressed={selected} onClick={onToggleSelect}>
          {selected ? <Check className="size-3" /> : null}
        </button>
      ) : null}
      <button
        type="button"
        className="plan-check"
        data-life-done=""
        disabled={!canEdit}
        aria-pressed={done}
        aria-label={done ? `Mark ${task.title} as not done` : `Mark ${task.title} done`}
        title={done ? "Not done" : PLAN_STATUS_LABELS[task.status]}
        onClick={() => onStatus(done ? "todo" : "done")}
      >
        {done ? <Check className="size-3" /> : null}
      </button>
      <button type="button" className="plan-row-title" aria-expanded={open} onClick={onOpen}>
        <span className="plan-row-text">{task.title || "Untitled task"}</span>
        {steps || row.blockedBy.length || row.milestoneTitle ? (
          <span className="plan-row-meta">
            {steps ? (
              <span>
                {stepsDone}/{steps} steps
              </span>
            ) : null}
            {row.blockedBy.length ? <span data-tone="blocked">waiting on {row.blockedBy.length}</span> : null}
            {row.milestoneTitle ? <span>{row.milestoneTitle}</span> : null}
          </span>
        ) : null}
      </button>
      {/* A native control, deliberately: a plan can hold hundreds of rows, and
          a portaled popover per row costs far more than it returns. */}
      <select
        className="plan-row-status"
        data-quiet={task.status === "todo" || done || undefined}
        aria-label={`Status of ${task.title}`}
        disabled={!canEdit}
        value={task.status}
        onChange={(event) => onStatus(event.target.value as PlanStatus)}
      >
        {PLAN_STATUS_ORDER.map((status) => (
          <option key={status} value={status}>
            {PLAN_STATUS_LABELS[status]}
          </option>
        ))}
      </select>
      {official ? (
        <span className="plan-row-school" title="This deadline comes from your school and is not moved here.">
          School
        </span>
      ) : null}
      {task.calendarBlockIds.length ? (
        <span className="plan-row-blocks" title="Work blocks in Calendar">
          <CalendarDays className="size-3" />
          {task.calendarBlockIds.length}
        </span>
      ) : null}
      {/* One date, one slot: the relative reading holds it, and the picker
          lies over it to meet the pointer. */}
      <span className="plan-row-date" data-overdue={isOverdue(task, now) || undefined} data-empty={label ? undefined : ""}>
        <input
          type="date"
          aria-label={`Due date of ${task.title}`}
          disabled={!canEdit || official}
          value={dateInput(task.dueAt)}
          onChange={(event) => onDue(event.target.value)}
        />
        <span aria-hidden>{label || (canEdit && !official ? "Add date" : "")}</span>
      </span>
    </li>
  );
}
