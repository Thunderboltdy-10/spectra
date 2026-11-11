"use client";

import { downloadDocumentText } from "./artifact-studio-file-utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Lock } from "@/components/icons/glyph-icons";
import { currentTimeMs } from "@/lib/unique-token";
import { applySingleTask, singleTaskView } from "../plan/model";
import { taskToIcs } from "../plan/projections";
import type { WorkRegion } from "../anchors/locate";
import { regionElement, useOpenAnchor, type AnchorLanding } from "../anchors/use-open-anchor";
import { useStudioContract } from "./artifact-studio-shell";
import { SpectraStoredText } from "./spectra-rich-content";
import { ArtifactRichTextEditor } from "./artifact-studio";
import type { TaskOptionsValue, TaskRecurrence, TaskReminder } from "./task/task-options";
import { TaskEssentials, TaskMore } from "./task/task-properties";
import { TaskSteps, type TaskStep } from "./task/task-steps";
import { dueSentence, taskInputs, taskInstant, taskZone } from "./task/task-time";
import { TaskTarget, TaskWhen } from "./task/task-when";
import { useReminderTime } from "./task/task-reminders";
import { SchoolTaskNotice } from "../school/school-task-details";

export { dueDistance, taskInputs, taskInstant } from "./task/task-time";

/*
 * A task (EDITORS.md, "Planner task"): one thing to do, and nothing in the
 * way of reading it. A round check beside the title marks it done. Under the
 * title, one line: when it is due and when to be reminded. Then the
 * description, written straight on the sheet with the rich field, where a
 * task is broken into parts with a list if the student wants parts. What a
 * few tasks need (priority, repeating, time needed, linked work, a day of
 * one's own, the calendar file) is folded under "More options". A task set
 * in ManageBac is the same task, with what the school asked above the
 * student's own notes and what the school holds for it (grade, hand-in).
 */

type TaskContent = Record<string, unknown> & {
  taskTitle?: string;
  description?: string;
  dueAt?: number | null;
  /** A start before dueAt: the task fills those hours on the calendar. */
  startAt?: number;
  allDay?: boolean;
  status?: "todo" | "doing" | "done";
  priority?: "low" | "medium" | "high";
  estimateMinutes?: number | null;
  subtasks?: TaskStep[];
  reminders?: TaskReminder[];
  recurrence?: TaskRecurrence;
  linkedArtifactIds?: string[];
  timezone?: string;
  source?: { provider?: string; lockedFields?: string[] };
  personalOverlay?: { targetDueAt?: number; note?: string };
};

/** The semantic layer names a task's parts (shared/semantic-chunks.ts); each is marked where it is shown. */
function landOnTaskPart(region: WorkRegion): AnchorLanding {
  return { find: (root) => regionElement(root, region.id) };
}

export function TaskStudio({
  artifactId,
  createdAt,
  mode,
  title,
  content,
  onChange,
  onTitle,
  readOnly,
}: {
  /** The work, so opening it at a step or its notes lands there. */
  artifactId?: string;
  /** When the task was made, so it can say how much of its time is gone. */
  createdAt?: number;
  mode: "split" | "tab";
  title: string;
  content: unknown;
  onChange: (content: unknown) => void;
  /** The task's title is the work's name too, so tabs and the Library say it. */
  onTitle?: (title: string) => void;
  readOnly: boolean;
}) {
  const task = useMemo(() => singleTaskView(content) as TaskContent, [content]);
  const latest = useRef({ raw: content, task });
  useEffect(() => {
    latest.current = { raw: content, task };
  }, [content, task]);
  const studio = useStudioContract();
  const canEdit = studio.can("edit") && !readOnly;
  const timeZone = taskZone(task.timezone, task.allDay !== false);
  const [now, setNow] = useState(() => currentTimeMs());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(currentTimeMs()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Opened at a part of the task (a search hit, a citation): land on it.
  useOpenAnchor(artifactId, landOnTaskPart);

  const locked = new Set(task.source?.provider === "managebac" ? (task.source.lockedFields ?? []) : []);
  const fromSchool = locked.size > 0;
  const done = task.status === "done";
  const steps = Array.isArray(task.subtasks) ? task.subtasks : [];
  const due = typeof task.dueAt === "number" ? task.dueAt : null;
  const start = due !== null && typeof task.startAt === "number" && task.startAt < due ? task.startAt : null;
  const target = typeof task.personalOverlay?.targetDueAt === "number" ? task.personalOverlay.targetDueAt : null;
  const options: TaskOptionsValue = {
    priority: task.priority,
    estimateMinutes: task.estimateMinutes,
    reminders: Array.isArray(task.reminders) ? task.reminders : [],
    recurrence: task.recurrence,
  };
  const reminderTime = useReminderTime();
  const timing = {
    allDay: task.allDay !== false,
    dueTime: due === null ? "23:59" : taskInputs(due, timeZone).time,
    reminderTime,
  };

  const patch = (next: Partial<TaskContent>) => {
    if (!canEdit) return;
    onChange(applySingleTask(latest.current.raw, { ...latest.current.task, ...next }));
  };

  // One task, three shapes: a day (top of the day), a due time, or a start and an end.
  const setDue = (date: string, time: string | null, from?: string | null) => {
    if (!date) patch({ dueAt: null, startAt: undefined, allDay: undefined, reminders: [] });
    else
      patch({
        dueAt: taskInstant(date, time, timeZone),
        startAt: from && time ? taskInstant(date, from, timeZone) : undefined,
        allDay: !time,
      });
  };

  const exportIcs = () => {
    const name = (task.taskTitle || title || "task").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
    downloadDocumentText(
      `${name || "task"}.ics`,
      "text/calendar",
      taskToIcs({ ...task, timezone: timeZone }, { uid: artifactId ?? `task-${createdAt ?? currentTimeMs()}`, name: title }),
    );
  };

  const late = due !== null && !done && due < now;
  const weekday = due === null ? null : new Date(`${taskInputs(due, timeZone).date}T12:00:00Z`).getUTCDay();

  return (
    <div className="spectra-task-studio" data-mode={mode}>
      <div className="spectra-editor-body spectra-composer-clearance">
        <article className="editor-sheet task-sheet" data-done={done || undefined} data-late={late || undefined}>
          <header className="task-top">
            {fromSchool ? (
              <p className="task-kicker">
                <Lock className="size-3" /> Set by your school
              </p>
            ) : null}
            <div className="task-top-line">
              <button
                type="button"
                role="checkbox"
                aria-checked={done}
                aria-label={done ? "Mark as not done" : "Mark as done"}
                title={done ? "Mark as not done" : "Mark as done"}
                className="task-check"
                data-life-done=""
                disabled={!canEdit}
                onClick={() => patch({ status: done ? "todo" : "done" })}
              >
                {done ? <Icon name="check" size={16} animate /> : null}
              </button>
              <textarea
                data-anchor-region="task:taskTitle"
                className="task-title"
                rows={1}
                autoFocus={canEdit && !task.taskTitle}
                value={task.taskTitle ?? ""}
                disabled={!canEdit || locked.has("taskTitle")}
                placeholder="What do you need to do?"
                aria-label="Title"
                onChange={(event) => {
                  const next = event.target.value.replace(/\n/g, " ").slice(0, 500);
                  patch({ taskTitle: next });
                  if (canEdit && next.trim()) onTitle?.(next.trim().slice(0, 200));
                }}
              />
            </div>
          </header>

          <TaskEssentials
            when={
              <TaskWhen
                due={due}
                start={start}
                allDay={task.allDay !== false}
                done={done}
                now={now}
                timeZone={timeZone}
                reminderTime={reminderTime}
                editable={canEdit && !locked.has("dueAt")}
                onDue={setDue}
              />
            }
            options={options}
            hasDue={due !== null}
            timing={timing}
            canEdit={canEdit}
            onChange={(next) => patch(next)}
          />

          {fromSchool && task.description ? (
            <section className="task-brief" aria-label="What the school asked" data-anchor-region="task:description">
              <h3 className="task-brief-head">From your school</h3>
              <SpectraStoredText value={task.description} className="task-brief-text" />
            </section>
          ) : null}

          <section className="task-notes" aria-label={fromSchool ? "Your notes" : "Description"} data-anchor-region={fromSchool ? undefined : "task:description"}>
            <ArtifactRichTextEditor
              key={fromSchool ? "note" : "description"}
              value={fromSchool ? (task.personalOverlay?.note ?? "") : (task.description ?? "")}
              format="markdown"
              variant="bare"
              disabled={!canEdit}
              placeholder={fromSchool ? "Your notes: what you plan to do, what to remember" : "Add a description. A list breaks it into parts."}
              label={fromSchool ? "Your notes" : "Description"}
              onChange={(value) =>
                fromSchool
                  ? patch({ personalOverlay: { ...task.personalOverlay, note: value.slice(0, 20_000) } })
                  : patch({ description: value })
              }
            />
          </section>

          {/* A checklist made before the description took lists, or by Spectra: still here to tick off. */}
          {steps.length ? <TaskSteps steps={steps} canEdit={canEdit} onChange={(next) => patch({ subtasks: next })} /> : null}

          {fromSchool && artifactId ? <SchoolTaskNotice artifactId={artifactId} /> : null}

          <TaskMore
            options={options}
            links={Array.isArray(task.linkedArtifactIds) ? task.linkedArtifactIds : []}
            selfId={artifactId}
            dueWeekday={weekday}
            canEdit={canEdit}
            ownDate={
              fromSchool && due !== null ? (
                <TaskTarget
                  target={target}
                  now={now}
                  timeZone={timeZone}
                  canEdit={canEdit}
                  onTarget={(date) =>
                    patch({ personalOverlay: { ...task.personalOverlay, targetDueAt: date ? taskInstant(date, null, timeZone) : undefined } })
                  }
                />
              ) : undefined
            }
            ownDateLabel={fromSchool && target !== null ? dueSentence(target, true, timeZone) : null}
            onExport={due !== null ? exportIcs : undefined}
            onChange={(next) => patch(next)}
            onLinks={(ids) => patch({ linkedArtifactIds: ids })}
          />
        </article>
      </div>
    </div>
  );
}
