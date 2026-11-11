"use client";

import { useId, useState, type ReactNode } from "react";
import { CalendarCheck2 } from "@/components/icons/glyph-icons";
import { NumberField } from "@/components/ui/number-field";
import { SelectField } from "@/components/ui/select";
import { uniqueToken } from "@/lib/unique-token";
import { TaskLinks } from "./task-links";
import { REPEATS, repeatOf, type TaskOptionsValue } from "./task-options";
import { TaskReminders, type ReminderTiming } from "./task-reminders";

/*
 * A task's details (EDITORS.md, "Planner task"). What nearly every task
 * wants sits on one line under the title: when it is due, and when to be
 * reminded. Everything else (how much it matters, repeating, how long it
 * takes, the work it is for, a day of one's own for a school task, the
 * calendar file) is folded under "More options", which says in a few words
 * what is set inside so nothing set is hidden.
 */

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Normal" },
  { value: "high", label: "High" },
] as const;

function Row({
  label,
  children,
  region,
}: {
  label: string;
  children: ReactNode;
  region?: string;
}) {
  return (
    <div className="task-prop" data-anchor-region={region}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The line under the title: the due day, then its reminders. */
export function TaskEssentials({
  when,
  options,
  hasDue,
  timing,
  canEdit,
  onChange,
}: {
  /** The due sentence and its picker. */
  when: ReactNode;
  options: TaskOptionsValue;
  hasDue: boolean;
  timing: ReminderTiming;
  canEdit: boolean;
  onChange: (patch: Partial<TaskOptionsValue>) => void;
}) {
  return (
    <div className="task-line">
      {when}
      {hasDue && (canEdit || options.reminders.length) ? (
        <TaskReminders
          reminders={options.reminders}
          hasDue={hasDue}
          {...timing}
          canEdit={canEdit}
          create={(minutesBefore) => ({
            id: `reminder-${uniqueToken().slice(0, 8)}`,
            minutesBefore,
            enabled: true,
          })}
          onChange={(next) => onChange({ reminders: next })}
        />
      ) : null}
    </div>
  );
}

/** What is set inside the fold, in a few words: "High priority, every week, 45 minutes". */
export function moreSummary(
  options: TaskOptionsValue,
  links: number,
  ownDate: string | null,
) {
  const repeat = repeatOf(options.recurrence);
  return [
    options.priority === "high"
      ? "High priority"
      : options.priority === "low"
        ? "Low priority"
        : null,
    repeat.value !== "none" ? repeat.label : null,
    typeof options.estimateMinutes === "number"
      ? `${options.estimateMinutes} minutes`
      : null,
    links ? `${links} linked` : null,
    ownDate ? `Your date ${ownDate}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .map((part, index) =>
      index ? part.charAt(0).toLowerCase() + part.slice(1) : part,
    )
    .join(", ");
}

export function TaskMore({
  options,
  links,
  selfId,
  dueWeekday,
  canEdit,
  ownDate,
  ownDateLabel,
  onExport,
  onChange,
  onLinks,
}: {
  options: TaskOptionsValue;
  links: string[];
  selfId?: string;
  /** The due day's weekday (0 is Sunday), so a weekly task repeats on it. */
  dueWeekday: number | null;
  canEdit: boolean;
  /** A school task's own-date picker, when the task has one. */
  ownDate?: ReactNode;
  /** That date in words, for the summary. */
  ownDateLabel?: string | null;
  /** Saves the task as a calendar file, when it has a day. */
  onExport?: () => void;
  onChange: (patch: Partial<TaskOptionsValue>) => void;
  onLinks: (ids: string[]) => void;
}) {
  const priority = options.priority ?? "medium";
  const summary = moreSummary(options, links.length, ownDateLabel ?? null);
  // Closed, nothing inside is mounted: the work picker reads the library only once it is wanted.
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <div className="task-more" data-open={open || undefined}>
      <button
        type="button"
        className="task-more-toggle"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="task-more-label">More options</span>
        {summary && !open ? (
          <span className="task-more-set">{summary}</span>
        ) : null}
      </button>
      {open ? (
        <dl className="task-props" id={panel}>
          {ownDate ? <Row label="Your own date">{ownDate}</Row> : null}

          <Row label="Priority">
            <span
              className="task-priority"
              role="radiogroup"
              aria-label="Priority"
            >
              {PRIORITIES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={priority === option.value}
                  data-level={option.value}
                  disabled={!canEdit}
                  onClick={() => onChange({ priority: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </span>
          </Row>

          <Row label="Repeat">
            <SelectField
              ariaLabel="Repeat"
              size="sm"
              value={repeatOf(options.recurrence).value}
              disabled={!canEdit}
              onChange={(next) => {
                const repeat =
                  REPEATS.find((candidate) => candidate.value === next) ??
                  REPEATS[0];
                onChange({
                  recurrence: {
                    exceptions: [],
                    ...options.recurrence,
                    frequency: repeat.frequency,
                    interval: repeat.interval,
                    weekdays:
                      repeat.frequency === "weekly" && dueWeekday !== null
                        ? [dueWeekday]
                        : [],
                  },
                });
              }}
              options={REPEATS.map(({ value, label }) => ({ value, label }))}
            />
          </Row>

          <Row label="Time needed">
            <span className="task-prop-minutes">
              <NumberField
                min={5}
                step={5}
                className="sheet-input"
                value={
                  typeof options.estimateMinutes === "number"
                    ? options.estimateMinutes
                    : ""
                }
                disabled={!canEdit}
                aria-label="Time needed, in minutes"
                onChange={(event) =>
                  onChange({
                    estimateMinutes: event.target.value
                      ? Math.max(1, Math.round(Number(event.target.value)))
                      : null,
                  })
                }
              />
              minutes
            </span>
          </Row>

          <Row label="Artifact it’s for">
            <TaskLinks
              bare
              ids={links}
              selfId={selfId}
              canEdit={canEdit}
              onChange={onLinks}
            />
          </Row>

          {onExport ? (
            <Row label="Calendar app">
              <button type="button" className="task-export" onClick={onExport}>
                <CalendarCheck2 className="size-3.5" />
                Add to my calendar app
              </button>
            </Row>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}
