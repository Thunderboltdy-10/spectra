"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import {
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock,
  List,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HubSurface } from "@/components/workspace/hub-surface";

export type PlannerTask = {
  id: string;
  plannerItemId?: string;
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
  onTaskEdit?: (task: PlannerTask) => void;
  forceExpanded?: boolean;
  className?: string;
};

const PRIORITY_DOT: Record<PlannerTask["priority"], string> = {
  low: "bg-[var(--text-tertiary)]",
  medium: "bg-[var(--warning)]",
  high: "bg-[var(--danger)]",
};

const PRIORITY_LABELS: Record<PlannerTask["priority"], string> = {
  low: "Low",
  medium: "Med",
  high: "High",
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

function formatDueDate(dueDate?: string): string {
  if (!dueDate) return "";
  const due = new Date(dueDate);
  const now = new Date();
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays <= 7) return `${diffDays}d`;
  return due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* --- Inline Task Editor --- */

function InlineTaskInput({ onAdd }: { onAdd: (title: string) => void }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue("");
    inputRef.current?.focus();
  }, [value, onAdd]);

  return (
    <div className="flex items-center gap-2 mx-4 mb-3 rounded-xl border border-[var(--border-default)]/25 bg-[var(--bg-secondary)]/30 px-3 py-2">
      <Plus className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]/40" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); handleSubmit(); }
        }}
        placeholder="Add a task\u2026"
        className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]/40"
      />
    </div>
  );
}

/* --- Editable Task Row --- */

function TaskRow({
  task,
  onToggle,
  onClick,
  onEdit,
}: {
  task: PlannerTask;
  onToggle: () => void;
  onClick: () => void;
  onEdit?: (task: PlannerTask) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(task.title);
  const editRef = useRef<HTMLInputElement>(null);
  const isCompleted = task.status === "completed";
  const isInProgress = task.status === "in_progress";

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editing]);

  const commitEdit = useCallback(() => {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== task.title) {
      onEdit?.({ ...task, title: trimmed });
    }
  }, [editValue, onEdit, task]);

  return (
    <div
      className={cn(
        "group/task flex items-start gap-2 rounded-xl px-2.5 py-2 transition-all duration-200",
        !isCompleted && "cursor-pointer hover:bg-[var(--bg-hover)]",
        isInProgress && "bg-[color-mix(in_oklab,var(--accent-cyan)_3%,transparent)]",
        isCompleted && "opacity-50",
      )}
      onClick={() => !editing && onClick()}
    >
      {/* Toggle done */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="mt-0.5 shrink-0 transition-transform duration-150 hover:scale-110"
      >
        {isCompleted ? (
          <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
        ) : isInProgress ? (
          <Clock className="h-4 w-4 text-[var(--accent-cyan)]" />
        ) : (
          <Circle className="h-4 w-4 text-[var(--text-tertiary)]/40 transition-colors group-hover/task:text-[var(--accent-cyan)]/60" />
        )}
      </button>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={editRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") { setEditValue(task.title); setEditing(false); }
            }}
            className="w-full bg-transparent text-[12px] font-medium text-[var(--text-primary)] outline-none border-b border-[var(--accent-cyan)]/30"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className={cn(
              "text-[12px] font-medium leading-tight",
              isCompleted ? "text-[var(--text-tertiary)] line-through" : "text-[var(--text-primary)]",
            )}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (!isCompleted) setEditing(true);
            }}
          >
            {task.title}
          </div>
        )}

        <div className="mt-1 flex items-center gap-2">
          <span className="text-[10px] text-[var(--text-tertiary)]/60">{task.workspaceName}</span>
          <span className={cn("h-[4px] w-[4px] shrink-0 rounded-full", PRIORITY_DOT[task.priority])} />
          <span className="text-[9px] font-medium text-[var(--text-tertiary)]/40">{PRIORITY_LABELS[task.priority]}</span>
          {task.dueDate && (
            <span className="text-[9px] font-medium text-[var(--text-secondary)]/70">
              {formatDueDate(task.dueDate)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* --- Calendar View --- */

function CalendarView({ tasks, onTaskClick }: { tasks: PlannerTask[]; onTaskClick: (taskId: string) => void }) {
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  const tasksByDay = useMemo(() => {
    const map: Record<number, PlannerTask[]> = {};
    for (const task of tasks) {
      if (!task.dueDate) continue;
      const d = new Date(task.dueDate);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        if (!map[day]) map[day] = [];
        map[day].push(task);
      }
    }
    return map;
  }, [tasks, year, month]);

  const selectedTasks = selectedDay ? tasksByDay[selectedDay] ?? [] : [];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <button type="button" onClick={() => setViewDate(new Date(year, month - 1, 1))} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-[14px] px-1">{"\u2039"}</button>
        <span className="text-[12px] font-semibold text-[var(--text-primary)]">
          {viewDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <button type="button" onClick={() => setViewDate(new Date(year, month + 1, 1))} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-[14px] px-1">{"\u203A"}</button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="text-[9px] font-semibold text-[var(--text-tertiary)]/50 py-1">{d}</div>
        ))}
        {Array.from({ length: firstDay }).map((_, i) => <div key={`e-${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const hasTasks = !!tasksByDay[day];
          const isToday = isCurrentMonth && today.getDate() === day;
          const isSelected = selectedDay === day;
          return (
            <button
              key={day}
              type="button"
              onClick={() => setSelectedDay(isSelected ? null : day)}
              className={cn(
                "relative flex flex-col items-center justify-center h-[30px] rounded-lg text-[11px] font-medium transition-colors",
                isSelected ? "bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
                isToday && !isSelected && "ring-1 ring-[var(--accent-cyan)]/30",
              )}
            >
              {day}
              {hasTasks && <div className="absolute bottom-0.5 h-[3px] w-[3px] rounded-full bg-[var(--accent-coral)]" />}
            </button>
          );
        })}
      </div>

      {selectedDay !== null && (
        <div className="mt-1 border-t border-[var(--border-default)]/15 pt-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]/60 px-1">
            {viewDate.toLocaleDateString(undefined, { month: "short" })} {selectedDay}
          </span>
          {selectedTasks.length === 0 ? (
            <p className="text-[11px] text-[var(--text-tertiary)] mt-1 px-1">No tasks</p>
          ) : (
            <div className="flex flex-col gap-0.5 mt-1">
              {selectedTasks.map((t) => (
                <button key={t.id} type="button" onClick={() => onTaskClick(t.id)} className="text-left text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg px-2 py-1 truncate">
                  {t.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* --- Main Planner Edge --- */

const PLANNER_LOCAL_KEY = "spectra:planner-tasks";

function loadLocalTasks(): PlannerTask[] {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(PLANNER_LOCAL_KEY) : null;
    return raw ? JSON.parse(raw) as PlannerTask[] : [];
  } catch { return []; }
}

function saveLocalTasks(tasks: PlannerTask[]) {
  try { window.localStorage.setItem(PLANNER_LOCAL_KEY, JSON.stringify(tasks)); } catch {}
}

export function PlannerEdge({ tasks, onTaskClick, onToggleTask, onTaskEdit, forceExpanded, className }: PlannerEdgeProps) {
  const [locked, setLocked] = useState(false);
  const [activeTab, setActiveTab] = useState<"list" | "calendar">("list");
  const [localTasks, setLocalTasks] = useState<PlannerTask[]>([]);
  useEffect(() => { setLocalTasks(loadLocalTasks()); }, []);
  useEffect(() => { if (localTasks.length > 0) saveLocalTasks(localTasks); }, [localTasks]);

  const allTasks = useMemo(() => [...tasks, ...localTasks], [tasks, localTasks]);
  const groups = useMemo(() => groupTasks(allTasks), [allTasks]);
  const pendingCount = allTasks.filter((task) => task.status !== "completed").length;
  const inProgressCount = allTasks.filter((task) => task.status === "in_progress").length;
  const completedToday = allTasks.filter((task) => task.status === "completed").length;

  const handleAddTask = useCallback((title: string) => {
    const newTask: PlannerTask = {
      id: `local-${Date.now()}`,
      title,
      workspaceName: "Local",
      dueDate: new Date().toISOString(),
      priority: "medium",
      status: "pending",
    };
    setLocalTasks((prev) => [newTask, ...prev]);
  }, []);

  const collapsed = (
    <button
      type="button"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-r-[14px] border border-l-0 border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/95 backdrop-blur-xl shadow-[0_10px_24px_-16px_rgba(8,22,40,0.14)] w-[36px] h-[100px] py-3",
        className,
      )}
    >
      <CalendarCheck className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
      <span className="text-[10px] font-semibold text-[var(--text-secondary)]" style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}>
        Planner
      </span>
      {pendingCount > 0 && (
        <span className="flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[var(--accent-coral)] px-1 text-[8px] font-bold text-white">
          {pendingCount}
        </span>
      )}
    </button>
  );

  return (
    <HubSurface
      id="planner-edge"
      edge="left"
      collapsed={collapsed}
      locked={locked}
      forceExpanded={forceExpanded}
      onToggleLock={() => setLocked((value) => !value)}
      className="!top-[140px] !-translate-y-0"
      expandedClassName="left-4 top-[120px]"
    >
      <div className="flex h-[min(72vh,720px)] w-[340px] flex-col overflow-hidden rounded-[28px]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-1 pt-4">
          <div className="flex items-center gap-2">
            <CalendarCheck className="h-4 w-4 text-[var(--accent-cyan)]" />
            <span className="text-[13px] font-semibold text-[var(--text-primary)]">Planner</span>
          </div>
        </div>

        {/* Stats bar */}
        <div className="mx-4 mb-2 flex items-center gap-3 text-[10px]">
          {inProgressCount > 0 && (
            <span className="flex items-center gap-1 text-[var(--accent-cyan)]">
              <Clock className="h-2.5 w-2.5" />
              {inProgressCount} active
            </span>
          )}
          <span className="text-[var(--text-tertiary)]">{pendingCount} pending</span>
          {completedToday > 0 && (
            <span className="text-[var(--success)]/70">{completedToday} done</span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mx-4 mb-2">
          <button
            type="button"
            onClick={() => setActiveTab("list")}
            className={cn(
              "flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11px] font-semibold transition-colors",
              activeTab === "list" ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
            )}
          >
            <List className="h-3 w-3" />
            List
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("calendar")}
            className={cn(
              "flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11px] font-semibold transition-colors",
              activeTab === "calendar" ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
            )}
          >
            <CalendarDays className="h-3 w-3" />
            Calendar
          </button>
        </div>

        {/* Quick add */}
        <InlineTaskInput onAdd={handleAddTask} />

        <div className="h-px bg-[var(--border-default)]/15 mx-4" />

        {/* Content based on tab */}
        <div className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
          {activeTab === "calendar" ? (
            <CalendarView tasks={allTasks} onTaskClick={onTaskClick} />
          ) : groups.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-center">
              <CheckCircle2 className="mb-2 h-6 w-6 text-[var(--success)] opacity-30" />
              <span className="text-[11px] text-[var(--text-tertiary)]">All caught up!</span>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="mb-3">
                <div className="mb-1.5 px-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]/60">
                    {group.label}
                    <span className="ml-1.5 text-[var(--text-tertiary)]/30">{group.items.length}</span>
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onToggle={() => onToggleTask(task.plannerItemId ?? task.id)}
                      onClick={() => onTaskClick(task.id)}
                      onEdit={onTaskEdit}
                    />
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
