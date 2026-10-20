"use client";

import { useState, type Ref } from "react";
import type { PlanStatus } from "../../plan/model";
import type { PlanBoardColumn } from "../../plan/projections";
import { PlanAddLine } from "./plan-add-line";
import { dueLabel, isOverdue, STATUS_INK } from "./plan-format";

/*
 * The plan by status (EDITORS.md, "Plan"): a column per status, each task a
 * slip that can be dragged to another column, and each column ending in a line
 * that writes a task with that column's status.
 */

export function PlanBoard({
  columns,
  now,
  timeZone,
  reminderTime,
  canEdit,
  openTaskId,
  addRef,
  onOpen,
  onStatus,
  onAdd,
}: {
  columns: readonly PlanBoardColumn[];
  now: number;
  timeZone: string;
  reminderTime: string;
  canEdit: boolean;
  openTaskId?: string;
  /** The To do column's line, for the workbar's Add task. */
  addRef: Ref<HTMLInputElement>;
  onOpen: (taskId: string) => void;
  onStatus: (taskId: string, status: PlanStatus) => void;
  onAdd: (title: string, status: PlanStatus, dueAt?: number) => void;
}) {
  const [dropStatus, setDropStatus] = useState<PlanStatus>();
  return (
    <div className="plan-board">
      {columns.map((column) => (
        <section
          key={column.status}
          className="plan-column"
          aria-label={column.title}
          style={{ ["--status-ink" as string]: STATUS_INK[column.status] }}
          data-dropping={dropStatus === column.status || undefined}
          onDragOver={(event) => {
            if (!canEdit) return;
            event.preventDefault();
            setDropStatus(column.status);
          }}
          onDragLeave={() => setDropStatus((current) => (current === column.status ? undefined : current))}
          onDrop={(event) => {
            setDropStatus(undefined);
            const taskId = event.dataTransfer.getData("text/plain");
            if (taskId && canEdit) onStatus(taskId, column.status);
          }}
        >
          <header className="plan-column-head">
            <h3>{column.title}</h3>
            <span className="plan-section-count">{column.tasks.length}</span>
          </header>
          {column.tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className="plan-slip"
              data-open={openTaskId === task.id || undefined}
              draggable={canEdit}
              onDragStart={(event) => event.dataTransfer.setData("text/plain", task.id)}
              onClick={() => onOpen(task.id)}
            >
              <strong>{task.title || "Untitled task"}</strong>
              {task.dueAt !== undefined || task.officialDeadlineRef || task.estimateMinutes ? (
                <span className="plan-slip-meta">
                  {task.dueAt !== undefined ? <span data-overdue={isOverdue(task, now) || undefined}>{dueLabel(task, now)}</span> : null}
                  {task.officialDeadlineRef ? <span className="plan-row-school">School</span> : null}
                  {task.estimateMinutes ? <span>{task.estimateMinutes} min</span> : null}
                </span>
              ) : null}
            </button>
          ))}
          {!column.tasks.length && !canEdit ? <p className="sheet-hint">Nothing here yet.</p> : null}
          {canEdit ? (
            <PlanAddLine
              label={`Add a task to ${column.title}`}
              inputRef={column.status === "todo" ? addRef : undefined}
              now={now}
              timeZone={timeZone}
              reminderTime={reminderTime}
              onAdd={(title, dueAt) => onAdd(title, column.status, dueAt)}
            />
          ) : null}
        </section>
      ))}
    </div>
  );
}
