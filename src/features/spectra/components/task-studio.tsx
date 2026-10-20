"use client";

import { downloadDocumentText } from "./artifact-studio-file-utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { CalendarCheck2, Lock } from "@/components/icons/glyph-icons";
import { currentTimeMs } from "@/lib/unique-token";
import { applySingleTask, normalizePlanContent, singleTaskView } from "../plan/model";
import { planToIcs } from "../plan/projections";
import type { WorkRegion } from "../anchors/locate";
import { regionElement, useOpenAnchor, type AnchorLanding } from "../anchors/use-open-anchor";
import { useStudioContract } from "./artifact-studio-shell";
import { SpectraStoredText } from "./spectra-rich-content";
import { ArtifactRichTextEditor } from "./artifact-studio";
import { SheetMore } from "./sheet/sheet-more";
import { TaskLinks } from "./task/task-links";
import { optionsSummary, TaskOptions, type TaskOptionsValue, type TaskRecurrence, type TaskReminder } from "./task/task-options";
import { TaskSteps, type TaskStep } from "./task/task-steps";
import { dateBlock, taskInputs, taskInstant, taskZone } from "./task/task-time";
import { TaskWhen } from "./task/task-when";
import { TaskElapsed } from "./task/task-elapsed";
import { useReminderTime } from "./task/task-reminders";

export { dueDistance, taskInputs, taskInstant } from "./task/task-time";

/*
 * A task (EDITORS.md, "Planner task"): one thing to do. What and when first,
 * with done beside them and how much of its time is gone; then what the
 * school asked, the student's notes, and a checklist when it needs one.
 * Repeating, reminders, priority, time and the work it is for wait folded at
 * the foot, with one line saying what is set. A new task is a title and one
 * press for its day.
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
  // What most tasks never need stays folded until asked for.
  const [moreOpen, setMoreOpen] = useState(false);
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
  const summary = optionsSummary(options, timing);

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
    downloadDocumentText(`${name || "task"}.ics`, "text/calendar", planToIcs(normalizePlanContent(task), title));
  };

  const block = due === null ? null : dateBlock(due, timeZone);
  const late = due !== null && !done && due < now;
  const weekday = due === null ? null : new Date(`${taskInputs(due, timeZone).date}T12:00:00Z`).getUTCDay();

  return (
    <div className="spectra-task-studio" data-mode={mode}>
      <div className="spectra-editor-body spectra-composer-clearance">
        <article className="editor-sheet task-sheet" data-done={done || undefined} data-late={late || undefined}>
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
              {fromSchool ? (
                <p className="task-kicker">
                  <Lock className="size-3" /> Set by your school
                </p>
              ) : null}
              <textarea
                data-anchor-region="task:taskTitle"
                className="task-title"
                rows={1}
                autoFocus={canEdit && !task.taskTitle}
                value={task.taskTitle ?? ""}
                disabled={!canEdit || locked.has("taskTitle")}
                placeholder="What do you need to do?"
                aria-label="Title"
                onChange={(event) => patch({ taskTitle: event.target.value.replace(/\n/g, " ").slice(0, 500) })}
              />
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
            </div>
            <button
              type="button"
              role="checkbox"
              aria-checked={done}
              aria-label={done ? "Mark as not done" : "Mark as done"}
              className="task-done"
              data-life-done=""
              disabled={!canEdit}
              onClick={() => patch({ status: done ? "todo" : "done" })}
            >
              <span className="task-done-mark">{done ? <Icon name="check" size={14} animate /> : null}</span>
              {done ? "Done" : "Mark done"}
            </button>
          </header>

          {fromSchool && task.description ? (
            <section className="sheet-section task-brief" aria-label="What the school asked" data-anchor-region="task:description">
              <header className="sheet-section-head">
                <h3>What the school asked</h3>
              </header>
              <SpectraStoredText value={task.description} className="task-brief-text" />
            </section>
          ) : null}

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

          <TaskSteps steps={steps} canEdit={canEdit} onChange={(next) => patch({ subtasks: next })} />

          {canEdit || summary ? (
            <SheetMore open={moreOpen} onOpenChange={setMoreOpen} summary={summary}>
              <TaskOptions value={options} hasDue={due !== null} dueWeekday={weekday} timing={timing} canEdit={canEdit} onChange={(next) => patch(next)} />
              <TaskLinks
                ids={Array.isArray(task.linkedArtifactIds) ? task.linkedArtifactIds : []}
                selfId={artifactId}
                canEdit={canEdit}
                onChange={(ids) => patch({ linkedArtifactIds: ids })}
              />
              <button type="button" className="sheet-chip task-export" onClick={exportIcs}>
                <CalendarCheck2 className="size-3.5" />
                Export to a calendar app
              </button>
            </SheetMore>
          ) : null}
        </article>
      </div>
    </div>
  );
}
