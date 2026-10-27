"use client";

import { downloadDocumentText } from "./artifact-studio-file-utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { CalendarCheck2, Lock } from "@/components/icons/glyph-icons";
import { currentTimeMs } from "@/lib/unique-token";
import { applySingleTask, singleTaskView } from "../plan/model";
import { taskToIcs } from "../plan/projections";
import type { WorkRegion } from "../anchors/locate";
import { regionElement, useOpenAnchor, type AnchorLanding } from "../anchors/use-open-anchor";
import { useStudioContract } from "./artifact-studio-shell";
import { SpectraStoredText } from "./spectra-rich-content";
import { ArtifactRichTextEditor } from "./artifact-studio";
import type { TaskOptionsValue, TaskRecurrence, TaskReminder } from "./task/task-options";
import { TaskProperties } from "./task/task-properties";
import { TaskSteps, type TaskStep } from "./task/task-steps";
import { taskInputs, taskInstant, taskZone } from "./task/task-time";
import { TaskWhen } from "./task/task-when";
import { TaskElapsed } from "./task/task-elapsed";
import { useReminderTime } from "./task/task-reminders";
import { SchoolTaskNotice } from "../school/school-task-details";

export { dueDistance, taskInputs, taskInstant } from "./task/task-time";

/*
 * A task (EDITORS.md, "Planner task"): one thing to do, laid out the way to-do
 * apps do it. A round check beside the title marks it done; under them, its
 * details one per line (due, priority, reminders, and repeating, time and the
 * work it is for once wanted); then what the school asked, the checklist and
 * the notes. A new task is a title and one press for its day. A task set in
 * ManageBac is the same task, with a notice of where it came from and what
 * the school holds for it (grade, hand-in).
 */

type TaskContent = Record<string, unknown> & {
  taskTitle?: string;
  description?: string;
  dueAt?: number | null;
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

  const setDue = (date: string, time: string | null) => {
    if (!date) patch({ dueAt: null, allDay: undefined, reminders: [] });
    else patch({ dueAt: taskInstant(date, time, timeZone), allDay: !time });
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

          <TaskProperties
            when={
              <>
                <TaskWhen
                  due={due}
                  allDay={task.allDay !== false}
                  done={done}
                  now={now}
                  timeZone={timeZone}
                  reminderTime={reminderTime}
                  editable={canEdit && !locked.has("dueAt")}
                  canEdit={canEdit}
                  fromSchool={fromSchool}
                  target={target}
                  onDue={setDue}
                  onTarget={(date) =>
                    patch({ personalOverlay: { ...task.personalOverlay, targetDueAt: date ? taskInstant(date, null, timeZone) : undefined } })
                  }
                />
                <TaskElapsed createdAt={createdAt} due={due} done={done} now={now} />
              </>
            }
            options={options}
            links={Array.isArray(task.linkedArtifactIds) ? task.linkedArtifactIds : []}
            selfId={artifactId}
            hasDue={due !== null}
            dueWeekday={weekday}
            timing={timing}
            canEdit={canEdit}
            onChange={(next) => patch(next)}
            onLinks={(ids) => patch({ linkedArtifactIds: ids })}
          />

          {fromSchool && task.description ? (
            <section className="sheet-section task-brief" aria-label="What the school asked" data-anchor-region="task:description">
              <header className="sheet-section-head">
                <h3>What the school asked</h3>
              </header>
              <SpectraStoredText value={task.description} className="task-brief-text" />
            </section>
          ) : null}

          {fromSchool && artifactId ? <SchoolTaskNotice artifactId={artifactId} /> : null}

          <TaskSteps steps={steps} canEdit={canEdit} onChange={(next) => patch({ subtasks: next })} />

          <section className="sheet-section" aria-label={fromSchool ? "Your notes" : "Notes"} data-anchor-region={fromSchool ? undefined : "task:description"}>
            <header className="sheet-section-head">
              <h3>{fromSchool ? "Your notes" : "Notes"}</h3>
            </header>
            <div className="task-notes">
              <ArtifactRichTextEditor
                key={fromSchool ? "note" : "description"}
                value={fromSchool ? (task.personalOverlay?.note ?? "") : (task.description ?? "")}
                format="markdown"
                variant="bare"
                disabled={!canEdit}
                placeholder={fromSchool ? "What you plan to do, what to remember" : "Anything to remember"}
                label={fromSchool ? "Your notes" : "Notes"}
                onChange={(value) =>
                  fromSchool
                    ? patch({ personalOverlay: { ...task.personalOverlay, note: value.slice(0, 20_000) } })
                    : patch({ description: value })
                }
              />
            </div>
          </section>

          {due !== null ? (
            <footer className="task-foot">
              <button type="button" className="task-export" onClick={exportIcs}>
                <CalendarCheck2 className="size-3.5" />
                Add to my calendar app
              </button>
            </footer>
          ) : null}
        </article>
      </div>
    </div>
  );
}
