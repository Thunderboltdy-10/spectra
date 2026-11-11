"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { ArrowLeft, Lock, Trash2, X } from "@/components/icons/glyph-icons";
import { SelectField } from "@/components/ui/select";
import type { PlanContent, PlanStatus, PlanTask } from "../../plan/model";
import { PLAN_STATUS_LABELS, PLAN_STATUS_ORDER } from "../../plan/projections";
import { ArtifactRichTextEditor } from "../artifact-rich-text-editor";
import { SheetMore } from "../sheet/sheet-more";
import { TaskLinks } from "../task/task-links";
import { TaskSteps } from "../task/task-steps";
import { dateBlock, taskInputs } from "../task/task-time";
import { TaskWhen } from "../task/task-when";
import { planTaskOptionsSummary, PlanTaskOptions } from "./plan-task-options";

/*
 * One task of a plan, on its own page (EDITORS.md, "Plan"). It is the same
 * sheet a lone task opens on: the due day stamped in the margin, the title in
 * the display serif, when it is due as a sentence, done at the right. Then
 * its notes, its steps and the work it is for; the rest folds into More
 * options. On a wide desk it lies open beside the list like the facing page
 * of a notebook; in a narrow one it takes the list's place, with a way back.
 */

/** A date with no time is kept at the end of its day; older plans kept noon. */
const ALL_DAY_TIMES = new Set(["23:59", "12:00"]);

export function PlanTaskSheet({
  task,
  plan,
  now,
  timeZone,
  reminderTime,
  canEdit,
  onChange,
  onDue,
  onClose,
  onDelete,
}: {
  task: PlanTask;
  plan: PlanContent;
  now: number;
  timeZone: string;
  /** The learner's reminder time, "HH:MM". */
  reminderTime: string;
  canEdit: boolean;
  onChange: (patch: Partial<PlanTask>) => void;
  onDue: (date: string, time: string | null) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(canEdit);
  const due = task.dueAt ?? null;
  const done = task.status === "done";
  const official = Boolean(task.officialDeadlineRef);
  const block = due === null ? null : dateBlock(due, timeZone);
  const late = due !== null && !done && due < now;
  const dueTime = due === null ? "23:59" : taskInputs(due, timeZone).time;
  const allDay = due === null || ALL_DAY_TIMES.has(dueTime);
  const timing = { allDay, dueTime, reminderTime };

  return (
    <article className="editor-sheet task-sheet plan-task-sheet" aria-label={`Task: ${task.title || "Untitled"}`} data-done={done || undefined} data-late={late || undefined}>
      <button type="button" className="sheet-quiet plan-task-back" onClick={onClose}>
        <ArrowLeft className="size-3.5" /> All tasks
      </button>
      <header className="task-head">
        <span className="task-stamp" aria-hidden data-empty={block ? undefined : ""}>
          {block ? (
            <>
              <span className="task-stamp-month">{block.month}</span>
              <span className="task-stamp-day">{block.day}</span>
            </>
          ) : (
            <Icon name="task" size={22} />
          )}
        </span>
        <div className="task-head-main">
          <div className="plan-task-kicker">
            <div className="sheet-type-chip">
              <SelectField
                ariaLabel="Status"
                size="sm"
                value={task.status}
                disabled={!canEdit}
                onChange={(value) => onChange({ status: value as PlanStatus })}
                options={PLAN_STATUS_ORDER.map((status) => ({ value: status, label: PLAN_STATUS_LABELS[status] }))}
              />
            </div>
            {official ? (
              <span className="task-kicker">
                <Lock className="size-3" /> Deadline set by your school
              </span>
            ) : null}
          </div>
          <textarea
            className="task-title"
            rows={1}
            autoFocus={canEdit && !task.title}
            value={task.title}
            disabled={!canEdit}
            placeholder="What needs doing?"
            aria-label="Task title"
            onChange={(event) => onChange({ title: event.target.value.replace(/\n/g, " ").slice(0, 500) })}
          />
          <TaskWhen
            due={due}
            allDay={allDay}
            done={done}
            now={now}
            timeZone={timeZone}
            reminderTime={reminderTime}
            editable={canEdit && !official}
            onDue={onDue}
          />
        </div>
        <div className="plan-task-side">
          <div className="sheet-tools">
            {canEdit ? (
              <button type="button" className="sheet-icon-button" onClick={onDelete} aria-label="Delete task" title="Delete task">
                <Trash2 className="size-4" />
              </button>
            ) : null}
            <button type="button" className="sheet-icon-button plan-task-close" onClick={onClose} aria-label="Close task" title="Close">
              <X className="size-4" />
            </button>
          </div>
          <button
            type="button"
            role="checkbox"
            aria-checked={done}
            aria-label={done ? "Mark as not done" : "Mark as done"}
            className="task-done"
            data-life-done=""
            disabled={!canEdit}
            onClick={() => onChange({ status: done ? "todo" : "done" })}
          >
            <span className="task-done-mark">{done ? <Icon name="check" size={14} animate /> : null}</span>
            {done ? "Done" : "Mark done"}
          </button>
        </div>
      </header>

      <section className="sheet-section" aria-label="Notes">
        <header className="sheet-section-head">
          <h3>Notes</h3>
        </header>
        <div className="task-notes">
          <ArtifactRichTextEditor
            key={task.id}
            value={task.description}
            format="markdown"
            variant="bare"
            disabled={!canEdit}
            placeholder="What does done look like?"
            label="Task description"
            onChange={(description) => onChange({ description })}
          />
        </div>
      </section>

      <TaskSteps steps={task.checklist} canEdit={canEdit} onChange={(checklist) => onChange({ checklist })} />

      <TaskLinks ids={task.referenceIds} canEdit={canEdit} onChange={(referenceIds) => onChange({ referenceIds })} />

      <SheetMore open={moreOpen} onOpenChange={setMoreOpen} summary={planTaskOptionsSummary(task, plan, timing)}>
        <PlanTaskOptions task={task} plan={plan} timing={timing} canEdit={canEdit} onChange={onChange} />
      </SheetMore>
    </article>
  );
}
