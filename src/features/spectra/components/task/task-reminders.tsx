"use client";

import { Clock3, X } from "@/components/icons/glyph-icons";
import { SelectField } from "@/components/ui/select";
import {
  ALL_DAY_REMINDER_DAYS,
  allDayMinutesBefore,
  formatAllDayReminder,
  formatMinutesBefore,
  REMINDER_MINUTE_OPTIONS,
} from "../../reminders/minutes-before";
import { useSpectraPreferences } from "../../settings/preference-store";

/*
 * A task's reminders, shared by a lone task and a task in a plan. A timed
 * task is reminded minutes or hours before; a task with only a day is
 * reminded on whole days at the learner's reminder time (Settings, Your day).
 * Each reminder is a line that can be taken away; one select adds the next.
 */

type Reminder = { id: string; minutesBefore: number };

/** How a task's reminders are read: by days at the reminder time when it has only a day. */
export type ReminderTiming = { allDay: boolean; dueTime: string; reminderTime: string };

/** The learner's reminder time from Settings, "HH:MM". */
export function useReminderTime() {
  return useSpectraPreferences().preferences.notifications.reminderTime;
}

export function reminderLabel(minutesBefore: number, allDay: boolean, dueTime: string) {
  return allDay ? formatAllDayReminder(minutesBefore, dueTime) : formatMinutesBefore(minutesBefore);
}

export function TaskReminders<R extends Reminder>({
  reminders,
  hasDue,
  allDay,
  dueTime,
  reminderTime,
  canEdit,
  create,
  onChange,
}: {
  reminders: ReadonlyArray<R>;
  hasDue: boolean;
  /** The task has a day but no time of its own. */
  allDay: boolean;
  /** The due time in the task's zone, "HH:MM". */
  dueTime: string;
  /** The learner's reminder time, "HH:MM". */
  reminderTime: string;
  canEdit: boolean;
  create: (minutesBefore: number) => R;
  onChange: (reminders: R[]) => void;
}) {
  if (!hasDue) return <p className="sheet-hint">Give the task a due date to be reminded before it.</p>;

  const taken = new Set(reminders.map((reminder) => reminder.minutesBefore));
  const options = allDay
    ? ALL_DAY_REMINDER_DAYS.flatMap(({ days, label }) => {
        const minutesBefore = allDayMinutesBefore(days, reminderTime, dueTime);
        return minutesBefore === null ? [] : [{ minutesBefore, label: `${label} at ${reminderTime}` }];
      })
    : REMINDER_MINUTE_OPTIONS;

  return (
    <div className="task-reminders">
      {reminders.length ? (
        <ul className="task-reminder-list">
          {reminders.map((reminder) => (
            <li key={reminder.id} className="task-reminder">
              <Clock3 className="size-3.5" aria-hidden />
              <span>{reminderLabel(reminder.minutesBefore, allDay, dueTime)}</span>
              {canEdit ? (
                <button
                  type="button"
                  className="sheet-icon-button"
                  aria-label={`Remove the reminder ${reminderLabel(reminder.minutesBefore, allDay, dueTime).toLowerCase()}`}
                  title="Remove reminder"
                  onClick={() => onChange(reminders.filter((item) => item.id !== reminder.id))}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit ? (
        <SelectField
          ariaLabel="Add a reminder"
          size="sm"
          value=""
          placeholder="Add a reminder"
          onChange={(value) => {
            const minutesBefore = Number(value);
            if (!Number.isFinite(minutesBefore) || taken.has(minutesBefore)) return;
            onChange([...reminders, create(minutesBefore)]);
          }}
          options={options.map((option) => ({
            value: String(option.minutesBefore),
            label: option.label,
            disabled: taken.has(option.minutesBefore),
          }))}
        />
      ) : null}
    </div>
  );
}
