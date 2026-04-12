"use client";

import { useMemo, useState } from "react";
import { CalendarCheck, CheckCircle2, ChevronLeft, Circle, Clock, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { HubSurface } from "@/components/workspace/hub-surface";

export type PlannerTask = {
  id: string;
  title: string;
  workspaceName: string;
  dueDate?: string;
  priority: "low" | "medium" | "high";
  status: "pending" | "in_progress" | "completed";
};

type PlannerEdgeProps = {
  tasks: PlannerTask[];
  onTaskClick: (taskId: string) => void;
  onToggleTask: (taskId: string) => void;
  className?: string;
};

const PRIORITY_DOT: Record<PlannerTask["priority"], string> = {
  low: "bg-[var(--text-tertiary)]",
  medium: "bg-[var(--warning)]",
  high: "bg-[var(--danger)]",
};

function groupTasks(tasks: PlannerTask[]) {
  const now = new Date();
  const today = now.toDateString();
  const tomorrow = new Date(now.getTime() + 86_400_000).toDateString();
  const weekEnd = now.getTime() + 7 * 86_400_000;

  const groups = [
    { label: "Today", items: [] as PlannerTask[] },
    { label: "Tomorrow", items: [] as PlannerTask[] },
    { label: "This Week", items: [] as PlannerTask[] },
    { label: "Later", items: [] as PlannerTask[] },
  ];

  for (const task of tasks) {
    if (!task.dueDate) {
      groups[3].items.push(task);
      continue;
    }
    const due = new Date(task.dueDate);
    if (due.toDateString() === today) groups[0].items.push(task);
    else if (due.toDateString() === tomorrow) groups[1].items.push(task);
    else if (due.getTime() <= weekEnd) groups[2].items.push(task);
    else groups[3].items.push(task);
  }

  return groups.filter((group) => group.items.length > 0);
}

export function PlannerEdge({ tasks, onTaskClick, onToggleTask, className }: PlannerEdgeProps) {
  const [locked, setLocked] = useState(false);
  const groups = useMemo(() => groupTasks(tasks), [tasks]);
  const pendingCount = tasks.filter((task) => task.status !== "completed").length;
  const inProgressCount = tasks.filter((task) => task.status === "in_progress").length;

  const collapsed = (
    <button
      type="button"
      className={cn(
        "flex flex-col items-center gap-2.5 rounded-r-[20px] border border-l-0 border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/95 py-5 pl-1.5 pr-2.5 backdrop-blur-xl shadow-[0_10px_24px_-16px_rgba(8,22,40,0.14)]",
        className,
      )}
    >
      <CalendarCheck className="h-4.5 w-4.5 text-[var(--text-secondary)]" />
      <span className="text-[10px] font-semibold text-[var(--text-secondary)]" style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}>Planner</span>
      {pendingCount > 0 ? (
        <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--accent-coral)] px-1 text-[9px] font-bold text-white">
          {pendingCount}
        </span>
      ) : null}
      <ChevronLeft className="h-3 w-3 text-[var(--text-tertiary)]" />
    </button>
  );

  return (
    <HubSurface
      id="planner-edge"
      edge="left"
      collapsed={collapsed}
      locked={locked}
      onToggleLock={() => setLocked((value) => !value)}
      className="!top-5 !-translate-y-0"
      expandedClassName="left-0 top-0"
    >
      <div className="flex h-[min(72vh,720px)] w-[300px] flex-col">
        <div className="flex items-center justify-between px-4 pb-3 pt-5">
          <div className="flex items-center gap-2">
            <CalendarCheck className="h-4 w-4 text-[var(--accent-cyan)]" />
            <span className="text-[13px] font-semibold text-[var(--text-primary)]">Planner</span>
          </div>
          <button type="button" className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {(inProgressCount > 0 || pendingCount > 0) && (
          <div className="mx-4 mb-3 flex items-center gap-3 text-[10px]">
            {inProgressCount > 0 && (
              <span className="flex items-center gap-1 text-[var(--accent-cyan)]">
                <Clock className="h-2.5 w-2.5" />
                {inProgressCount} in progress
              </span>
            )}
            <span className="text-[var(--text-tertiary)]">{pendingCount} pending</span>
          </div>
        )}

        <div className="border-t border-[var(--border-default)]/25 px-4 py-3">
          <div className="rounded-2xl border border-[var(--border-default)]/30 bg-[var(--bg-secondary)]/40 px-3.5 py-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Timetable & reminders</div>
            <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">This layer will hold reminders, timetable context, and planner navigation while staying part of the left-edge hub ecology.</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {groups.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-center">
              <CheckCircle2 className="mb-2 h-6 w-6 text-[var(--success)] opacity-30" />
              <span className="text-[11px] text-[var(--text-tertiary)]">All caught up!</span>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="mb-4">
                <div className="mb-2 px-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">{group.label}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((task) => (
                    <div key={task.id} className="group/task flex cursor-pointer items-start gap-2 rounded-xl px-2.5 py-2 transition-colors duration-150 hover:bg-[var(--bg-hover)]" onClick={() => onTaskClick(task.id)}>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleTask(task.id);
                        }}
                        className="mt-0.5 shrink-0"
                      >
                        {task.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" /> : <Circle className="h-3.5 w-3.5 text-[var(--text-tertiary)] transition-colors group-hover/task:text-[var(--accent-cyan)]" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className={cn("truncate text-[12px] font-medium leading-tight", task.status === "completed" ? "text-[var(--text-tertiary)] line-through" : "text-[var(--text-primary)]")}>{task.title}</div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className="text-[10px] text-[var(--text-tertiary)]">{task.workspaceName}</span>
                          <span className={cn("h-[4px] w-[4px] shrink-0 rounded-full", PRIORITY_DOT[task.priority])} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </HubSurface>
  );
}
