"use client";

import { SelectField } from "@/components/ui/select";
import { uniqueToken } from "@/lib/unique-token";
import { reminderLabel, TaskReminders, type ReminderTiming } from "./task-reminders";

/*
 * What most tasks never need (EDITORS.md, "Planner task"): repeating, priority,
 * how long it takes, reminders. Folded under one line that says what is set,
 * so a plain task stays plain and a set one says so without opening.
 */

export type TaskReminder = { id: string; minutesBefore: number; enabled: boolean };
export type TaskRecurrence = { frequency: "none" | "daily" | "weekly" | "monthly" | "yearly"; interval: number; weekdays: number[]; exceptions: number[]; untilAt?: number };
export type TaskOptionsValue = {
  priority?: "low" | "medium" | "high";
  estimateMinutes?: number | null;
  reminders: TaskReminder[];
  recurrence?: TaskRecurrence;
};

const REPEATS = [
  { value: "none", label: "Does not repeat", frequency: "none", interval: 1 },
  { value: "daily", label: "Every day", frequency: "daily", interval: 1 },
  { value: "weekly", label: "Every week", frequency: "weekly", interval: 1 },
  { value: "fortnightly", label: "Every two weeks", frequency: "weekly", interval: 2 },
  { value: "monthly", label: "Every month", frequency: "monthly", interval: 1 },
  { value: "yearly", label: "Every year", frequency: "yearly", interval: 1 },
] as const;

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Normal" },
  { value: "high", label: "High" },
] as const;

function repeatOf(recurrence?: TaskRecurrence) {
  if (!recurrence || recurrence.frequency === "none") return REPEATS[0];
  return REPEATS.find((repeat) => repeat.frequency === recurrence.frequency && repeat.interval === recurrence.interval) ?? REPEATS[0];
}

function minutesLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} h` : `${Math.floor(hours)} h ${minutes % 60} min`;
}

/** "Every week, 1 reminder, high priority": what More options holds, closed. */
export function optionsSummary(value: TaskOptionsValue, timing: ReminderTiming) {
  const parts: string[] = [];
  const repeat = repeatOf(value.recurrence);
  if (repeat.value !== "none") parts.push(repeat.label);
  if (value.reminders.length) parts.push(value.reminders.length === 1 ? `reminder ${reminderLabel(value.reminders[0]!.minutesBefore, timing.allDay, timing.dueTime).toLowerCase()}` : `${value.reminders.length} reminders`);
  if (typeof value.estimateMinutes === "number") parts.push(`takes ${minutesLabel(value.estimateMinutes)}`);
  if (value.priority === "high" || value.priority === "low") parts.push(`${value.priority} priority`);
  const text = parts.join(", ");
  return text ? text[0]!.toUpperCase() + text.slice(1) : "";
}

export function TaskOptions({
  value,
  hasDue,
  dueWeekday,
  timing,
  canEdit,
  onChange,
}: {
  value: TaskOptionsValue;
  hasDue: boolean;
  timing: ReminderTiming;
  /** The due day's weekday (0 is Sunday), so a weekly task repeats on it. */
  dueWeekday: number | null;
  canEdit: boolean;
  onChange: (patch: Partial<TaskOptionsValue>) => void;
}) {
  const reminders = value.reminders;
  return (
    <div className="sheet-options">
      <label className="sheet-option">
        <span>Repeats</span>
        <SelectField
          ariaLabel="Repeats"
          size="sm"
          value={repeatOf(value.recurrence).value}
          disabled={!canEdit}
          onChange={(next) => {
            const repeat = REPEATS.find((candidate) => candidate.value === next) ?? REPEATS[0];
            onChange({
              recurrence: {
                exceptions: [],
                ...value.recurrence,
                frequency: repeat.frequency,
                interval: repeat.interval,
                weekdays: repeat.frequency === "weekly" && dueWeekday !== null ? [dueWeekday] : [],
              },
            });
          }}
          options={REPEATS.map(({ value: key, label }) => ({ value: key, label }))}
        />
      </label>
      <div className="sheet-option">
        <span>Reminders</span>
        <TaskReminders
          reminders={reminders}
          hasDue={hasDue}
          {...timing}
          canEdit={canEdit}
          create={(minutesBefore) => ({ id: `reminder-${uniqueToken().slice(0, 8)}`, minutesBefore, enabled: true })}
          onChange={(next) => onChange({ reminders: next })}
        />
      </div>
      <label className="sheet-option">
        <span>Takes about</span>
        <span className="sheet-option-minutes">
          <input
            type="number"
            min={5}
            step={5}
            className="sheet-input"
            value={typeof value.estimateMinutes === "number" ? value.estimateMinutes : ""}
            disabled={!canEdit}
            aria-label="Takes about, in minutes"
            onChange={(event) => onChange({ estimateMinutes: event.target.value ? Math.max(1, Math.round(Number(event.target.value))) : null })}
          />
          minutes
        </span>
      </label>
      <label className="sheet-option">
        <span>Priority</span>
        <SelectField
          ariaLabel="Priority"
          size="sm"
          value={value.priority ?? "medium"}
          disabled={!canEdit}
          onChange={(next) => onChange({ priority: next as TaskOptionsValue["priority"] })}
          options={PRIORITIES.map((option) => ({ ...option }))}
        />
      </label>
    </div>
  );
}
