"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { CalendarCheck2, Clock3, Lock, Plus, X } from "@/components/icons/glyph-icons";
import { SelectField } from "@/components/ui/select";
import { currentTimeMs, uniqueToken } from "@/lib/unique-token";
import { cn } from "@/lib/utils";
import { projectBindingsFromIr } from "../capabilities";
import { normalizePlanContent } from "../plan/model";
import { planToIcs } from "../plan/projections";
import { formatMinutesBefore, REMINDER_MINUTE_OPTIONS } from "../reminders/minutes-before";
import type { WorkRegion } from "../anchors/locate";
import { regionElement, useOpenAnchor, type AnchorLanding } from "../anchors/use-open-anchor";
import { useStudioContract } from "./artifact-studio-shell";
import { ArtifactWorkbar, contentHistoryBindings } from "./artifact-workbar";
import { SpectraStoredText } from "./spectra-rich-content";
import { ArtifactRichTextEditor } from "./artifact-studio";

/*
 * A planner task (EDITORS.md, "Planner task"): one thing by default. A title,
 * an optional due time, notes, and done. Steps are there only once someone
 * adds them; priority, estimate and reminders wait behind "More". It edits the
 * same fields Spectra writes, so the task is one model for both.
 */

type Step = { id: string; title: string; done: boolean };
type Reminder = { id: string; minutesBefore: number; enabled: boolean };

type TaskContent = Record<string, unknown> & {
  taskTitle?: string;
  description?: string;
  dueAt?: number | null;
  allDay?: boolean;
  status?: "todo" | "doing" | "done";
  priority?: "low" | "medium" | "high";
  estimateMinutes?: number | null;
  subtasks?: Step[];
  reminders?: Reminder[];
  timezone?: string;
  source?: { provider?: string; lockedFields?: string[] };
  personalOverlay?: { targetDueAt?: number; note?: string };
};

const DAY_MS = 24 * 60 * 60 * 1000;

function validZone(zone: unknown) {
  if (typeof zone !== "string" || !zone) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format();
    return zone;
  } catch {
    return undefined;
  }
}

function zoneOffset(instant: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - instant;
}

/** A day, and a time on it or the end of the day, in the task's zone. */
export function taskInstant(date: string, time: string | null, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time ? time.split(":").map(Number) : [23, 59];
  const guess = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  return guess - zoneOffset(guess - zoneOffset(guess, timeZone), timeZone);
}

/** The day and time of an instant in the task's zone, as the inputs read them. */
export function taskInputs(instant: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** "Today", "Tomorrow", "In 3 days", "2 days late": how near the due day is. */
export function dueDistance(dueAt: number, now: number, timeZone: string) {
  const day = (instant: number) => {
    const { date } = taskInputs(instant, timeZone);
    return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS;
  };
  const days = day(dueAt) - day(now);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `In ${days} days` : `${-days} days late`;
}

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Normal" },
  { value: "high", label: "High" },
] as const;

function StepRow({
  step,
  readOnly,
  autoFocus,
  onChange,
  onRemove,
}: {
  step: Step;
  readOnly: boolean;
  autoFocus: boolean;
  onChange: (patch: Partial<Step>) => void;
  onRemove: () => void;
}) {
  // A field object: a step forms from where it was made (your press, or the prism when Spectra adds it) and parts when removed.
  return (
    <li className="spectra-task-step" data-anchor-region={`task:subtask:${step.id}:title`} data-life-object="" data-life-done="" data-done={step.done || undefined}>
      <input
        type="checkbox"
        checked={step.done}
        disabled={readOnly}
        aria-label={`${step.title || "Step"} done`}
        onChange={() => onChange({ done: !step.done })}
      />
      <input
        type="text"
        value={step.title}
        disabled={readOnly}
        autoFocus={autoFocus}
        placeholder="A step"
        aria-label="Step"
        onChange={(event) => onChange({ title: event.target.value.slice(0, 500) })}
        onBlur={() => {
          if (!step.title.trim()) onRemove();
        }}
        onKeyDown={(event) => {
          if (event.key === "Backspace" && !step.title) {
            event.preventDefault();
            onRemove();
          }
        }}
      />
      {readOnly ? null : (
        <button type="button" className="spectra-task-icon-button" aria-label="Remove step" title="Remove step" onClick={onRemove}>
          <X className="size-3.5" />
        </button>
      )}
    </li>
  );
}

/** The semantic layer names a task's parts (shared/semantic-chunks.ts); each is marked where it is shown. */
function landOnTaskPart(region: WorkRegion): AnchorLanding {
  return { find: (root) => regionElement(root, region.id) };
}

export function TaskStudio({
  artifactId,
  mode,
  title,
  content,
  onChange,
  readOnly,
}: {
  /** The work, so opening it at a step or its notes lands there. */
  artifactId?: string;
  mode: "split" | "tab";
  title: string;
  content: unknown;
  onChange: (content: unknown) => void;
  readOnly: boolean;
}) {
  const task = useMemo(() => (content && typeof content === "object" ? content : {}) as TaskContent, [content]);
  const latest = useRef(task);
  useEffect(() => {
    latest.current = task;
  }, [task]);
  const studio = useStudioContract();
  const canEdit = studio.can("edit") && !readOnly;
  const timeZone = validZone(task.timezone) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [now, setNow] = useState(() => currentTimeMs());
  const [focusStep, setFocusStep] = useState<string>();
  // More opens by itself when something in it is set, until the user closes it.
  const [moreOpen, setMoreOpen] = useState<boolean>();
  useEffect(() => {
    const timer = window.setInterval(() => setNow(currentTimeMs()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Opened at a part of the task (a search hit, a citation): land on it.
  useOpenAnchor(artifactId, landOnTaskPart);

  const locked = new Set(task.source?.provider === "managebac" ? (task.source.lockedFields ?? []) : []);
  const fromSchool = locked.size > 0;
  const done = task.status === "done";
  const steps = useMemo(() => (Array.isArray(task.subtasks) ? task.subtasks : []), [task]);
  const reminders = Array.isArray(task.reminders) ? task.reminders : [];
  const due = typeof task.dueAt === "number" ? task.dueAt : null;
  const dueInputs = due === null ? null : taskInputs(due, timeZone);
  const target = typeof task.personalOverlay?.targetDueAt === "number" ? task.personalOverlay.targetDueAt : null;

  const patch = (next: Partial<TaskContent>) => {
    if (!canEdit) return;
    onChange({ ...latest.current, ...next });
  };
  const patchSteps = (next: Step[]) => patch({ subtasks: next });

  const setDue = (date: string, time: string | null) => {
    if (!date) {
      patch({ dueAt: null, allDay: undefined, reminders: [] });
      return;
    }
    patch({ dueAt: taskInstant(date, time, timeZone), allDay: !time });
  };

  const addStep = () => {
    const id = `subtask-${uniqueToken().slice(0, 8)}`;
    setFocusStep(id);
    patchSteps([...steps, { id, title: "", done: false }]);
  };

  const exportIcs = () => {
    const name = (task.taskTitle || title || "task").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
    const url = URL.createObjectURL(new Blob([planToIcs(normalizePlanContent(task), title)], { type: "text/calendar" }));
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${name || "task"}.ics`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const stepsDone = useMemo(() => steps.filter((step) => step.done).length, [steps]);
  const hasMore = task.priority === "high" || task.priority === "low" || typeof task.estimateMinutes === "number" || reminders.length > 0;
  const showMore = moreOpen ?? hasMore;

  return (
    <div className="spectra-task-studio" data-mode={mode}>
      <ArtifactWorkbar
        label="Task"
        modes={[]}
        context={steps.length ? `${stepsDone} of ${steps.length} steps` : undefined}
        actions={projectBindingsFromIr("planner_task", [
          ...contentHistoryBindings(studio.history),
          {
            id: "export-ics",
            label: "Export as a calendar to-do",
            icon: CalendarCheck2,
            onSelect: exportIcs,
            priority: "advanced",
          },
        ])}
      />
      <div className="spectra-editor-body spectra-composer-clearance">
        <article className="spectra-task-card" data-done={done || undefined}>
          <div className="spectra-task-head">
            <button
              type="button"
              role="checkbox"
              aria-checked={done}
              aria-label={done ? "Mark as not done" : "Mark as done"}
              title={done ? "Mark as not done" : "Mark as done"}
              className="spectra-task-done"
              data-life-done=""
              disabled={!canEdit}
              onClick={() => patch({ status: done ? "todo" : "done" })}
            >
              {done ? <Icon name="check" size={16} animate /> : null}
            </button>
            <textarea
              data-anchor-region="task:taskTitle"
              className="spectra-task-title"
              rows={1}
              value={task.taskTitle ?? ""}
              disabled={!canEdit || locked.has("taskTitle")}
              placeholder="What do you need to do?"
              aria-label="Title"
              onChange={(event) => patch({ taskTitle: event.target.value.replace(/\n/g, " ").slice(0, 500) })}
            />
          </div>

          <div className="spectra-task-when">
            <label className="spectra-task-field">
              <span>Due</span>
              <input
                type="date"
                value={dueInputs?.date ?? ""}
                disabled={!canEdit || locked.has("dueAt")}
                onChange={(event) => setDue(event.target.value, task.allDay === false ? (dueInputs?.time ?? null) : null)}
              />
            </label>
            {due !== null ? (
              <label className="spectra-task-field">
                <span>Time</span>
                <input
                  type="time"
                  value={task.allDay === false ? (dueInputs?.time ?? "") : ""}
                  disabled={!canEdit || locked.has("dueAt")}
                  onChange={(event) => setDue(dueInputs!.date, event.target.value || null)}
                />
              </label>
            ) : null}
            {due !== null ? (
              <span className={cn("spectra-task-distance", !done && due < now && "is-late")}>{dueDistance(due, now, timeZone)}</span>
            ) : null}
            {due !== null && canEdit && !locked.has("dueAt") ? (
              <button type="button" className="spectra-task-icon-button" aria-label="Remove the due date" title="Remove the due date" onClick={() => setDue("", null)}>
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>

          {fromSchool ? (
            <div className="spectra-task-school">
              <Lock className="size-3.5" />
              <p>Your school set this task. Its title, notes and due date stay as the school wrote them.</p>
              <label className="spectra-task-field">
                <span>Your target</span>
                <input
                  type="date"
                  value={target === null ? "" : taskInputs(target, timeZone).date}
                  disabled={!canEdit}
                  onChange={(event) =>
                    patch({
                      personalOverlay: {
                        ...task.personalOverlay,
                        targetDueAt: event.target.value ? taskInstant(event.target.value, null, timeZone) : undefined,
                      },
                    })
                  }
                />
              </label>
            </div>
          ) : null}

          <div className="spectra-task-notes" data-anchor-region={fromSchool ? undefined : "task:description"}>
            <ArtifactRichTextEditor
              key={fromSchool ? "note" : "description"}
              value={fromSchool ? (task.personalOverlay?.note ?? "") : (task.description ?? "")}
              format="markdown"
              disabled={!canEdit}
              placeholder={fromSchool ? "Your notes" : "Notes"}
              label={fromSchool ? "Your notes" : "Notes"}
              onChange={(value) =>
                fromSchool
                  ? patch({ personalOverlay: { ...task.personalOverlay, note: value.slice(0, 20_000) } })
                  : patch({ description: value })
              }
            />
          </div>
          {fromSchool && task.description ? (
            <div data-anchor-region="task:description">
              <SpectraStoredText value={task.description} className="spectra-task-school-notes" />
            </div>
          ) : null}

          {steps.length ? (
            <section className="spectra-task-steps" aria-label="Steps">
              <ul>
                {steps.map((step) => (
                  <StepRow
                    key={step.id}
                    step={step}
                    readOnly={!canEdit}
                    autoFocus={step.id === focusStep}
                    onChange={(next) => patchSteps(steps.map((candidate) => (candidate.id === step.id ? { ...candidate, ...next } : candidate)))}
                    onRemove={() => patchSteps(latest.current.subtasks?.filter((candidate) => candidate.id !== step.id) ?? [])}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {canEdit || hasMore ? (
            <div className="spectra-task-extras">
              {canEdit ? (
                <button type="button" className="spectra-task-quiet" onClick={addStep}>
                  <Plus className="size-3.5" /> {steps.length ? "Add a step" : "Add steps"}
                </button>
              ) : null}
              <button
                type="button"
                className="spectra-task-quiet"
                aria-expanded={showMore}
                onClick={() => setMoreOpen(!showMore)}
              >
                More
              </button>
            </div>
          ) : null}

          {showMore ? (
            <section className="spectra-task-more" aria-label="More">
              <label className="spectra-task-field">
                <span>Priority</span>
                <SelectField
                  ariaLabel="Priority"
                  size="sm"
                  value={task.priority ?? "medium"}
                  disabled={!canEdit}
                  onChange={(value) => patch({ priority: value as TaskContent["priority"] })}
                  options={PRIORITIES.map((option) => ({ ...option }))}
                />
              </label>
              <label className="spectra-task-field">
                <span>Takes about</span>
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={typeof task.estimateMinutes === "number" ? task.estimateMinutes : ""}
                  disabled={!canEdit}
                  placeholder="minutes"
                  onChange={(event) =>
                    patch({ estimateMinutes: event.target.value ? Math.max(1, Math.round(Number(event.target.value))) : null })
                  }
                />
              </label>
              <div className="spectra-task-field">
                <span>Reminders</span>
                {due === null ? (
                  <p className="spectra-task-hint">Give the task a due date to be reminded before it.</p>
                ) : (
                  <div className="spectra-task-reminders">
                    {reminders.map((reminder) => (
                      <button
                        key={reminder.id}
                        type="button"
                        className="spectra-task-chip"
                        disabled={!canEdit}
                        title="Remove reminder"
                        onClick={() => patch({ reminders: reminders.filter((item) => item.id !== reminder.id) })}
                      >
                        <Clock3 className="size-3" />
                        {formatMinutesBefore(reminder.minutesBefore)}
                        {canEdit ? <X className="size-3" /> : null}
                      </button>
                    ))}
                    {canEdit ? (
                      <SelectField
                        ariaLabel="Add a reminder"
                        size="sm"
                        value=""
                        placeholder="Add a reminder"
                        onChange={(value) => {
                          const minutes = Number(value);
                          if (!Number.isFinite(minutes) || reminders.some((item) => item.minutesBefore === minutes)) return;
                          patch({ reminders: [...reminders, { id: `reminder-${uniqueToken().slice(0, 8)}`, minutesBefore: minutes, enabled: true }] });
                        }}
                        options={REMINDER_MINUTE_OPTIONS.map((option) => ({
                          value: String(option.minutesBefore),
                          label: option.label,
                          disabled: reminders.some((item) => item.minutesBefore === option.minutesBefore),
                        }))}
                      />
                    ) : null}
                  </div>
                )}
              </div>
            </section>
          ) : null}
        </article>
      </div>
    </div>
  );
}
