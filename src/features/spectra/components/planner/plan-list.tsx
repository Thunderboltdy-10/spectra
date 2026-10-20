"use client";

import type { Ref } from "react";
import { Check, Plus } from "@/components/icons/glyph-icons";
import type { PlanContent, PlanStatus, PlanTask } from "../../plan/model";
import type { PlanListSection } from "../../plan/projections";
import { PlanAddLine } from "./plan-add-line";
import { dueLabel, isOverdue } from "./plan-format";
import { PlanTaskRow } from "./plan-task-row";

/*
 * The plan as a to-do page (EDITORS.md, "Plan"): dated today in the margin,
 * headed with what is left and the next thing due, then the tasks written on
 * ruled lines, section by section, each section ending in a line for the
 * next task. Selecting many tasks is its own mode, so the check at the head of
 * a line always means "done".
 */

const UNSECTIONED = "__unsectioned";

/** The next thing due, said as a sentence: "Essay draft is 2 days late", "Next, tomorrow: Essay draft". */
function nextDue(task: PlanTask, now: number) {
  const label = dueLabel(task, now);
  const name = task.title || "Untitled task";
  if (isOverdue(task, now)) return `${name} is ${label === "Today" ? "due today" : label.toLowerCase()}`;
  const soon = label === "Today" || label === "Tomorrow";
  return `Next, ${soon ? label.toLowerCase() : `on ${label}`}: ${name}`;
}

export function PlanList({
  plan,
  sections,
  visibleCount,
  now,
  timeZone,
  reminderTime,
  canEdit,
  openTaskId,
  selecting,
  selection,
  addRef,
  onSelecting,
  onSelection,
  onOpen,
  onStatus,
  onDue,
  onAdd,
  onAddSection,
  onRenameSection,
}: {
  plan: PlanContent;
  sections: readonly PlanListSection[];
  visibleCount: number;
  now: number;
  timeZone: string;
  reminderTime: string;
  canEdit: boolean;
  openTaskId?: string;
  selecting: boolean;
  selection: readonly string[];
  /** The line the workbar's Add task writes on. */
  addRef: Ref<HTMLInputElement>;
  onSelecting: (on: boolean) => void;
  onSelection: (ids: readonly string[]) => void;
  onOpen: (taskId: string) => void;
  onStatus: (taskId: string, status: PlanStatus) => void;
  onDue: (taskId: string, date: string) => void;
  onAdd: (title: string, sectionId?: string, dueAt?: number) => void;
  onAddSection: () => void;
  onRenameSection: (sectionId: string, title: string) => void;
}) {
  const total = plan.tasks.length;
  const done = plan.tasks.filter((task) => task.status === "done").length;
  const left = total - done;
  const next = plan.tasks
    .filter((task) => task.status !== "done" && task.dueAt !== undefined)
    .sort((a, b) => a.dueAt! - b.dueAt!)[0];
  const shownIds = sections.flatMap((section) => section.rows.map((row) => row.task.id));
  const allSelected = shownIds.length > 0 && shownIds.every((id) => selection.includes(id));
  const today = new Date(now);
  const lastSection = sections.at(-1)?.id;
  const sectioned = sections.length > 1 || (sections[0] && sections[0].id !== UNSECTIONED);

  return (
    <article className="editor-sheet plan-sheet" aria-label="Tasks">
      <header className="plan-sheet-head">
        <span className="sheet-stamp" aria-hidden title="Today">
          <span className="sheet-stamp-label">{today.toLocaleDateString(undefined, { month: "short" })}</span>
          <span className="sheet-stamp-number">{today.getDate()}</span>
        </span>
        <div className="plan-sheet-head-main">
          <h2 className="plan-sheet-title">{!total ? "Start with one thing" : left ? `${left} left to do` : "All done"}</h2>
          {total ? (
            <p className="plan-sheet-sub">
              <span className="task-progress" aria-label={`${done} of ${total} tasks done`}>
                <span className="task-progress-rule" style={{ ["--done" as string]: `${(done / total) * 100}%` }} />
                {done} of {total} done
              </span>
              {next ? <span className="plan-sheet-next" data-overdue={isOverdue(next, now) || undefined}>{nextDue(next, now)}</span> : null}
            </p>
          ) : (
            <p className="plan-sheet-sub">Write the first task. Sections, dates and steps come when you need them.</p>
          )}
        </div>
        {canEdit && total ? (
          <div className="sheet-tools">
            {selecting ? (
              <button type="button" className="sheet-quiet" aria-pressed={allSelected} onClick={() => onSelection(allSelected ? [] : shownIds)}>
                {allSelected ? "Clear selection" : "Select all shown"}
              </button>
            ) : null}
            <button
              type="button"
              className="sheet-quiet"
              aria-pressed={selecting}
              onClick={() => {
                onSelecting(!selecting);
                if (selecting) onSelection([]);
              }}
            >
              {selecting ? "Done selecting" : "Select"}
            </button>
            <button type="button" className="sheet-quiet" onClick={onAddSection}>
              <Plus className="size-3.5" /> Section
            </button>
          </div>
        ) : null}
      </header>

      {total && !visibleCount ? <p className="sheet-hint plan-sheet-none">No task matches these filters. Widen them to see the rest of the plan.</p> : null}

      {sections.map((section) => (
        <section key={section.id} className="plan-section" aria-label={section.id === UNSECTIONED ? "Tasks" : section.title}>
          {sectioned ? (
            <header className="plan-section-head">
              {section.id === UNSECTIONED || !canEdit ? (
                <h3>{section.id === UNSECTIONED ? "No section" : section.title}</h3>
              ) : (
                <input
                  className="plan-section-name"
                  value={section.title}
                  aria-label="Section name"
                  onChange={(event) => onRenameSection(section.id, event.target.value.slice(0, 120))}
                />
              )}
              <span className="plan-section-count">{section.rows.length}</span>
            </header>
          ) : null}
          <ul className="plan-rows">
            {section.rows.map((row) => (
              <PlanTaskRow
                key={row.task.id}
                row={row}
                now={now}
                canEdit={canEdit}
                open={openTaskId === row.task.id}
                selecting={selecting && canEdit}
                selected={selection.includes(row.task.id)}
                onToggleSelect={() =>
                  onSelection(selection.includes(row.task.id) ? selection.filter((id) => id !== row.task.id) : [...selection, row.task.id])
                }
                onOpen={() => onOpen(row.task.id)}
                onStatus={(status) => onStatus(row.task.id, status)}
                onDue={(date) => onDue(row.task.id, date)}
              />
            ))}
          </ul>
          {canEdit && sectioned ? (
            <PlanAddLine
              label={`Add a task to ${section.id === UNSECTIONED ? "no section" : section.title}`}
              inputRef={section.id === lastSection ? addRef : undefined}
              now={now}
              timeZone={timeZone}
              reminderTime={reminderTime}
              onAdd={(title, dueAt) => onAdd(title, section.id === UNSECTIONED ? undefined : section.id, dueAt)}
            />
          ) : null}
        </section>
      ))}

      {canEdit && !sectioned ? (
        <PlanAddLine
          label={total ? "Add a task" : "First task"}
          placeholder={total ? "Add a task" : "First task"}
          inputRef={addRef}
          now={now}
          timeZone={timeZone}
          reminderTime={reminderTime}
          onAdd={(title, dueAt) => onAdd(title, undefined, dueAt)}
        />
      ) : null}
      {selecting && selection.length ? (
        <p className="sheet-hint">
          <Check className="size-3" /> {selection.length} selected
        </p>
      ) : null}
    </article>
  );
}
