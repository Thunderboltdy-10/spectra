"use client";

import { useState, type ReactNode } from "react";
import { NumberField } from "@/components/ui/number-field";
import { SelectField } from "@/components/ui/select";
import { uniqueToken } from "@/lib/unique-token";
import { TaskLinks } from "./task-links";
import { REPEATS, repeatOf, type TaskOptionsValue } from "./task-options";
import { TaskReminders, type ReminderTiming } from "./task-reminders";

/*
 * A task's details as every to-do app lays them out (EDITORS.md, "Planner
 * task"): a label on the left, its value on the right, one line each. When it
 * is due, how much it matters and when to be reminded are always there,
 * because nearly every task wants them. Repeating, how long it takes and the
 * work it is for appear once set, or once asked for from the last line, so a
 * plain task stays three lines long.
 */

type Extra = "repeat" | "estimate" | "links";

const EXTRAS: Array<{ id: Extra; label: string }> = [
  { id: "repeat", label: "Repeat" },
  { id: "estimate", label: "Time needed" },
  { id: "links", label: "Work it’s for" },
];

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Normal" },
  { value: "high", label: "High" },
] as const;

function Row({ label, children, region }: { label: string; children: ReactNode; region?: string }) {
  return (
    <div className="task-prop" data-anchor-region={region}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function TaskProperties({
  when,
  options,
  links,
  selfId,
  hasDue,
  dueWeekday,
  timing,
  canEdit,
  onChange,
  onLinks,
}: {
  /** The due sentence and its picker. */
  when: ReactNode;
  options: TaskOptionsValue;
  links: string[];
  selfId?: string;
  hasDue: boolean;
  /** The due day's weekday (0 is Sunday), so a weekly task repeats on it. */
  dueWeekday: number | null;
  timing: ReminderTiming;
  canEdit: boolean;
  onChange: (patch: Partial<TaskOptionsValue>) => void;
  onLinks: (ids: string[]) => void;
}) {
  const [asked, setAsked] = useState<Set<Extra>>(() => new Set());
  const set: Record<Extra, boolean> = {
    repeat: repeatOf(options.recurrence).value !== "none",
    estimate: typeof options.estimateMinutes === "number",
    links: links.length > 0,
  };
  const shown = (extra: Extra) => set[extra] || asked.has(extra);
  const more = canEdit ? EXTRAS.filter((extra) => !shown(extra.id)) : [];
  const priority = options.priority ?? "medium";

  return (
    <dl className="task-props">
      <Row label="Due">{when}</Row>

      <Row label="Priority">
        <span className="task-priority" role="radiogroup" aria-label="Priority">
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

      <Row label="Remind me">
        <TaskReminders
          reminders={options.reminders}
          hasDue={hasDue}
          {...timing}
          canEdit={canEdit}
          create={(minutesBefore) => ({ id: `reminder-${uniqueToken().slice(0, 8)}`, minutesBefore, enabled: true })}
          onChange={(next) => onChange({ reminders: next })}
        />
      </Row>

      {shown("repeat") ? (
        <Row label="Repeat">
          <SelectField
            ariaLabel="Repeat"
            size="sm"
            value={repeatOf(options.recurrence).value}
            disabled={!canEdit}
            onChange={(next) => {
              const repeat = REPEATS.find((candidate) => candidate.value === next) ?? REPEATS[0];
              onChange({
                recurrence: {
                  exceptions: [],
                  ...options.recurrence,
                  frequency: repeat.frequency,
                  interval: repeat.interval,
                  weekdays: repeat.frequency === "weekly" && dueWeekday !== null ? [dueWeekday] : [],
                },
              });
            }}
            options={REPEATS.map(({ value, label }) => ({ value, label }))}
          />
        </Row>
      ) : null}

      {shown("estimate") ? (
        <Row label="Time needed">
          <span className="task-prop-minutes">
            <NumberField
              min={5}
              step={5}
              className="sheet-input"
              value={typeof options.estimateMinutes === "number" ? options.estimateMinutes : ""}
              disabled={!canEdit}
              autoFocus={!set.estimate}
              aria-label="Time needed, in minutes"
              onChange={(event) => onChange({ estimateMinutes: event.target.value ? Math.max(1, Math.round(Number(event.target.value))) : null })}
            />
            minutes
          </span>
        </Row>
      ) : null}

      {shown("links") ? (
        <Row label="Work it’s for">
          <TaskLinks bare ids={links} selfId={selfId} canEdit={canEdit} onChange={onLinks} />
        </Row>
      ) : null}

      {more.length ? (
        <div className="task-prop task-prop-more">
          <dt>Add</dt>
          <dd>
            {more.map((extra) => (
              <button key={extra.id} type="button" onClick={() => setAsked((current) => new Set(current).add(extra.id))}>
                {extra.label}
              </button>
            ))}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
