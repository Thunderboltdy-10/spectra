"use client";

import { X } from "@/components/icons/glyph-icons";
import { SelectField } from "@/components/ui/select";
import { uniqueToken } from "@/lib/unique-token";
import type { PlanContent, PlanTask } from "../../plan/model";
import { reminderLabel, TaskReminders, type ReminderTiming } from "../task/task-reminders";
import { plural } from "./plan-format";

/*
 * What a task in a plan rarely needs, folded under its page's More options
 * (EDITORS.md, "Plan"): where it is filed, the milestone it counts toward,
 * what it waits on, how long it takes, and its reminders. The fold's line
 * names whatever is set.
 */

const NONE = "__none";

export function planTaskOptionsSummary(task: PlanTask, plan: PlanContent, timing: ReminderTiming) {
  const parts: string[] = [];
  const section = plan.sections.find((candidate) => candidate.id === task.sectionId);
  if (section) parts.push(`in ${section.title}`);
  const milestone = plan.milestones.find((candidate) => candidate.id === task.milestoneId);
  if (milestone) parts.push(`toward ${milestone.title}`);
  if (task.dependencyIds.length) parts.push(`waiting on ${plural(task.dependencyIds.length, "task")}`);
  if (task.estimateMinutes) parts.push(`takes ${task.estimateMinutes} min`);
  if (task.reminders.length)
    parts.push(task.reminders.length === 1 ? `reminder ${reminderLabel(task.reminders[0]!.minutesBefore, timing.allDay, timing.dueTime).toLowerCase()}` : plural(task.reminders.length, "reminder"));
  if (!parts.length) return "Section, waiting on, time, reminders";
  const line = parts.join(", ");
  return line[0]!.toUpperCase() + line.slice(1);
}

export function PlanTaskOptions({
  task,
  plan,
  timing,
  canEdit,
  onChange,
}: {
  task: PlanTask;
  plan: PlanContent;
  timing: ReminderTiming;
  canEdit: boolean;
  onChange: (patch: Partial<PlanTask>) => void;
}) {
  const waitingOn = task.dependencyIds.map((id) => ({ id, title: plan.tasks.find((candidate) => candidate.id === id)?.title ?? "Removed task" }));
  const candidates = plan.tasks.filter((candidate) => candidate.id !== task.id && !task.dependencyIds.includes(candidate.id));

  return (
    <div className="sheet-options">
      {plan.sections.length ? (
        <label className="sheet-option">
          <span>Section</span>
          <SelectField
            ariaLabel="Section"
            size="sm"
            value={task.sectionId ?? NONE}
            disabled={!canEdit}
            onChange={(value) => onChange({ sectionId: value === NONE ? undefined : value })}
            options={[{ value: NONE, label: "No section" }, ...plan.sections.map((section) => ({ value: section.id, label: section.title }))]}
          />
        </label>
      ) : null}
      {plan.milestones.length ? (
        <label className="sheet-option">
          <span>Milestone</span>
          <SelectField
            ariaLabel="Milestone"
            size="sm"
            value={task.milestoneId ?? NONE}
            disabled={!canEdit}
            onChange={(value) => onChange({ milestoneId: value === NONE ? undefined : value })}
            options={[{ value: NONE, label: "None" }, ...plan.milestones.map((milestone) => ({ value: milestone.id, label: milestone.title }))]}
          />
        </label>
      ) : null}
      <div className="sheet-option sheet-option--wide">
        <span>Waiting on</span>
        <div className="sheet-chips">
          {waitingOn.map((dependency) => (
            <button
              key={dependency.id}
              type="button"
              className="sheet-chip"
              disabled={!canEdit}
              aria-label={`Stop waiting on ${dependency.title}`}
              title="Stop waiting on this"
              onClick={() => onChange({ dependencyIds: task.dependencyIds.filter((id) => id !== dependency.id) })}
            >
              {dependency.title}
              {canEdit ? <X className="size-3" /> : null}
            </button>
          ))}
          {canEdit && candidates.length ? (
            <SelectField
              ariaLabel="Waiting on"
              size="sm"
              value=""
              placeholder={waitingOn.length ? "And another task" : "Another task in this plan"}
              onChange={(value) => value && onChange({ dependencyIds: [...task.dependencyIds, value] })}
              options={candidates.map((candidate) => ({ value: candidate.id, label: candidate.title || "Untitled task" }))}
            />
          ) : null}
          {!canEdit && !waitingOn.length ? <span className="sheet-hint">Nothing</span> : null}
        </div>
      </div>
      <label className="sheet-option">
        <span>Takes about</span>
        <span className="sheet-option-minutes">
          <input
            type="number"
            min={5}
            step={5}
            className="sheet-input"
            value={task.estimateMinutes ?? ""}
            disabled={!canEdit}
            aria-label="Takes about, in minutes"
            onChange={(event) => onChange({ estimateMinutes: event.target.value ? Math.max(1, Math.round(Number(event.target.value))) : undefined })}
          />
          minutes
        </span>
      </label>
      <div className="sheet-option sheet-option--wide">
        <span>Reminders</span>
        <TaskReminders
          reminders={task.reminders}
          hasDue={task.dueAt !== undefined}
          {...timing}
          canEdit={canEdit}
          create={(minutesBefore) => ({ id: `reminder-${uniqueToken().slice(0, 8)}`, minutesBefore })}
          onChange={(reminders) => onChange({ reminders })}
        />
      </div>
      {task.sourceRefs.length ? (
        <div className="sheet-option sheet-option--wide">
          <span>Sources</span>
          <p className="sheet-hint">{task.sourceRefs.join(", ")}</p>
        </div>
      ) : null}
    </div>
  );
}
