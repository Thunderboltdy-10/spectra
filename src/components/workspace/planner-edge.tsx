"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import {
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  List,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HubSurface } from "@/components/workspace/hub-surface";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { notifyWorkspaceContentMutated } from "@/lib/workspace/events";

/* ─── Types ───────────────────────────────────────────── */

export type PlannerTask = {
  id: string;
  plannerItemId?: string;
  title: string;
  description?: string;
  workspaceName: string;
  workspaceId?: string;
  dueDate?: string;
  dueAt?: number;
  type: "deadline" | "milestone" | "goal" | "reminder";
  priority: "low" | "medium" | "high";
  status: "pending" | "in_progress" | "completed" | "cancelled";
};

type PlannerEdgeProps = {
  tasks?: PlannerTask[];
  onTaskClick?: (taskId: string) => void;
  onToggleTask?: (taskId: string) => void;
  onTaskEdit?: (task: PlannerTask) => void;
  forceExpanded?: boolean;
  className?: string;
};

/* ─── Constants ───────────────────────────────────────── */

const PRIORITY_DOT: Record<PlannerTask["priority"], string> = {
  low: "bg-[var(--text-tertiary)]/50",
  medium: "bg-amber-400",
  high: "bg-rose-400",
};

const TYPE_LABELS: Record<PlannerTask["type"], string> = {
  deadline: "Deadline",
  milestone: "Milestone",
  goal: "Goal",
  reminder: "Reminder",
};

const DURATION_OPTIONS = [
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "1.5h", minutes: 90 },
  { label: "2h", minutes: 120 },
  { label: "3h", minutes: 180 },
];

/* ─── Helpers ─────────────────────────────────────────── */

function groupTasks(tasks: PlannerTask[]) {
  const now = new Date();
  const today = now.toDateString();
  const tomorrow = new Date(now.getTime() + 86_400_000).toDateString();
  const weekEnd = now.getTime() + 7 * 86_400_000;

  const groups = [
    { label: "Overdue", items: [] as PlannerTask[], color: "text-rose-400" },
    { label: "Today", items: [] as PlannerTask[], color: "text-[var(--accent-cyan)]" },
    { label: "Tomorrow", items: [] as PlannerTask[], color: "text-[var(--text-secondary)]" },
    { label: "This Week", items: [] as PlannerTask[], color: "text-[var(--text-secondary)]" },
    { label: "Later", items: [] as PlannerTask[], color: "text-[var(--text-tertiary)]" },
    { label: "No date", items: [] as PlannerTask[], color: "text-[var(--text-tertiary)]" },
  ];

  for (const task of tasks) {
    if (task.status === "completed" || task.status === "cancelled") continue;
    const dueMs = task.dueAt ?? (task.dueDate ? new Date(task.dueDate).getTime() : undefined);
    if (!dueMs) {
      groups[5].items.push(task);
      continue;
    }
    const due = new Date(dueMs);
    if (dueMs < now.getTime() && due.toDateString() !== today) {
      groups[0].items.push(task);
    } else if (due.toDateString() === today) {
      groups[1].items.push(task);
    } else if (due.toDateString() === tomorrow) {
      groups[2].items.push(task);
    } else if (dueMs <= weekEnd) {
      groups[3].items.push(task);
    } else {
      groups[4].items.push(task);
    }
  }

  return groups.filter((group) => group.items.length > 0);
}

function formatDueDate(dueAt?: number): string {
  if (!dueAt) return "";
  const due = new Date(dueAt);
  const now = new Date();
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) {
    const hours = due.getHours();
    const minutes = due.getMinutes();
    if (hours === 0 && minutes === 0) return "Today";
    return due.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: true });
  }
  if (diffDays === 1) return "Tomorrow";
  if (diffDays <= 7) return `${diffDays}d`;
  return due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTimeShort(dueAt?: number): string {
  if (!dueAt) return "";
  const d = new Date(dueAt);
  if (d.getHours() === 0 && d.getMinutes() === 0) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: true });
}

/** Parse duration from description field (format: "duration:60m" embedded in description) */
function parseDuration(description?: string): number | null {
  if (!description) return null;
  const match = description.match(/\bduration:(\d+)m\b/);
  return match ? parseInt(match[1], 10) : null;
}

function encodeDuration(description: string | undefined, minutes: number | null): string {
  const base = (description ?? "").replace(/\s*\bduration:\d+m\b\s*/g, "").trim();
  if (!minutes) return base;
  return base ? `${base} duration:${minutes}m` : `duration:${minutes}m`;
}

/* ─── Backend API helpers ─────────────────────────────── */

async function apiCreateTask(payload: {
  title: string;
  description?: string;
  workstreamId?: string;
  type?: string;
  priority?: string;
  dueAt?: number;
}): Promise<{ plannerItemId?: string } | null> {
  try {
    const res = await fetch("/api/planner-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function apiUpdateTask(plannerItemId: string, updates: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch("/api/planner-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plannerItemId, ...updates }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function apiDeleteTask(plannerItemId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/planner-items?plannerItemId=${encodeURIComponent(plannerItemId)}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function apiFetchAllTasks(): Promise<PlannerTask[]> {
  try {
    const res = await fetch("/api/planner-items?limit=200");
    if (!res.ok) return [];
    const data = await res.json();
    const items = data.items ?? [];
    return items.map((item: Record<string, unknown>) => ({
      id: item._id as string,
      plannerItemId: item._id as string,
      title: (item.title as string) ?? "Untitled",
      description: item.description as string | undefined,
      workspaceName: "",
      workspaceId: item.workstreamId as string | undefined,
      dueAt: item.dueAt as number | undefined,
      dueDate: item.dueAt ? new Date(item.dueAt as number).toISOString() : undefined,
      type: (item.type as PlannerTask["type"]) ?? "deadline",
      priority: (item.priority as PlannerTask["priority"]) ?? "medium",
      status: (item.status as PlannerTask["status"]) ?? "pending",
    }));
  } catch {
    return [];
  }
}

/* ─── Task Creation Form ──────────────────────────────── */

function TaskCreationForm({
  workspaceId,
  workspaces,
  onCreated,
  onCancel,
}: {
  workspaceId?: string | null;
  workspaces: { id: string; name: string; emoji: string }[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [priority, setPriority] = useState<PlannerTask["priority"]>("medium");
  const [taskType, setTaskType] = useState<PlannerTask["type"]>("deadline");
  const [duration, setDuration] = useState<number | null>(null);
  const [targetWsId, setTargetWsId] = useState(workspaceId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);

    let dueAt: number | undefined;
    if (dueDate) {
      const dateStr = dueTime ? `${dueDate}T${dueTime}` : `${dueDate}T00:00`;
      dueAt = new Date(dateStr).getTime();
      if (isNaN(dueAt)) dueAt = undefined;
    }

    const description = duration ? `duration:${duration}m` : undefined;

    const result = await apiCreateTask({
      title: trimmed,
      description,
      workstreamId: targetWsId || undefined,
      type: taskType,
      priority,
      dueAt,
    });

    setSubmitting(false);
    if (result) {
      notifyWorkspaceContentMutated({
        workstreamId: targetWsId || undefined,
        refreshHub: true,
        refreshWorkstreams: true,
      });
      onCreated();
    }
  }, [title, dueDate, dueTime, priority, taskType, duration, targetWsId, submitting, onCreated]);

  return (
    <div className="flex flex-col gap-3 px-4 pb-3">
      {/* Title */}
      <input
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleSubmit(); } if (e.key === "Escape") onCancel(); }}
        placeholder="Task title…"
        className="w-full rounded-xl border border-[var(--border-default)]/30 bg-[var(--bg-secondary)]/20 px-3 py-2.5 text-[13px] font-medium text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]/40 focus:border-[var(--accent-cyan)]/40 transition-colors"
      />

      {/* Date + Time row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]/60">Date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded-lg border border-[var(--border-default)]/25 bg-[var(--bg-secondary)]/15 px-2.5 py-2 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-cyan)]/40"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]/60">Time</label>
          <input
            type="time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
            className="rounded-lg border border-[var(--border-default)]/25 bg-[var(--bg-secondary)]/15 px-2.5 py-2 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-cyan)]/40"
          />
        </div>
      </div>

      {/* Duration chips */}
      <div className="flex flex-col gap-1">
        <label className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]/60">Duration</label>
        <div className="flex flex-wrap gap-1.5">
          {DURATION_OPTIONS.map((opt) => (
            <button
              key={opt.minutes}
              type="button"
              onClick={() => setDuration(duration === opt.minutes ? null : opt.minutes)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-[10px] font-semibold transition-all",
                duration === opt.minutes
                  ? "bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)] ring-1 ring-[var(--accent-cyan)]/25"
                  : "bg-[var(--bg-secondary)]/20 text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]/40 hover:text-[var(--text-secondary)]",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Priority + Type row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]/60">Priority</label>
          <div className="flex gap-1">
            {(["low", "medium", "high"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={cn(
                  "flex-1 rounded-lg py-1.5 text-[10px] font-semibold transition-all",
                  priority === p
                    ? cn("ring-1", p === "high" ? "bg-rose-400/10 text-rose-400 ring-rose-400/25" : p === "medium" ? "bg-amber-400/10 text-amber-400 ring-amber-400/25" : "bg-[var(--bg-secondary)]/30 text-[var(--text-secondary)] ring-[var(--border-default)]/30")
                    : "bg-[var(--bg-secondary)]/10 text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]/30",
                )}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]/60">Type</label>
          <select
            value={taskType}
            onChange={(e) => setTaskType(e.target.value as PlannerTask["type"])}
            className="rounded-lg border border-[var(--border-default)]/25 bg-[var(--bg-secondary)]/15 px-2.5 py-1.5 text-[10px] font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--accent-cyan)]/40"
          >
            <option value="deadline">Deadline</option>
            <option value="milestone">Milestone</option>
            <option value="goal">Goal</option>
            <option value="reminder">Reminder</option>
          </select>
        </div>
      </div>

      {/* Workspace selector */}
      {workspaces.length > 1 && (
        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]/60">Workspace</label>
          <select
            value={targetWsId}
            onChange={(e) => setTargetWsId(e.target.value)}
            className="rounded-lg border border-[var(--border-default)]/25 bg-[var(--bg-secondary)]/15 px-2.5 py-1.5 text-[10px] font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--accent-cyan)]/40"
          >
            <option value="">No workspace</option>
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>{ws.emoji} {ws.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-[10px] font-semibold text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] transition-colors">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!title.trim() || submitting}
          className={cn(
            "rounded-lg px-4 py-1.5 text-[10px] font-bold transition-all",
            title.trim() && !submitting
              ? "bg-[var(--accent-cyan)] text-white hover:bg-[var(--accent-cyan)]/90"
              : "bg-[var(--bg-secondary)]/30 text-[var(--text-tertiary)] cursor-not-allowed",
          )}
        >
          {submitting ? "Creating…" : "Create Task"}
        </button>
      </div>
    </div>
  );
}

/* ─── Quick Add Bar (collapsed creation) ──────────────── */

function QuickAddBar({ onExpand }: { onExpand: () => void }) {
  return (
    <div
      className="flex items-center gap-2 mx-4 mb-2 rounded-xl border border-[var(--border-default)]/20 bg-[var(--bg-secondary)]/15 px-3 py-2 cursor-text transition-colors hover:border-[var(--accent-cyan)]/25"
      onClick={() => { onExpand(); }}
    >
      <Plus className="h-3.5 w-3.5 shrink-0 text-[var(--accent-cyan)]/50" />
      <span className="text-[11px] text-[var(--text-tertiary)]/50 select-none">Add a task…</span>
    </div>
  );
}

/* ─── Inline Task Editor ──────────────────────────────── */

function TaskEditForm({
  task,
  workspaces: _workspaces,
  onSaved,
  onCancel,
  onDelete,
}: {
  task: PlannerTask;
  workspaces: { id: string; name: string; emoji: string }[];
  onSaved: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  void _workspaces;
  const [dueDate, setDueDate] = useState(() => {
    const ms = task.dueAt ?? (task.dueDate ? new Date(task.dueDate).getTime() : undefined);
    if (!ms) return "";
    const d = new Date(ms);
    return d.toISOString().slice(0, 10);
  });
  const [dueTime, setDueTime] = useState(() => {
    const ms = task.dueAt ?? (task.dueDate ? new Date(task.dueDate).getTime() : undefined);
    if (!ms) return "";
    const d = new Date(ms);
    if (d.getHours() === 0 && d.getMinutes() === 0) return "";
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  const [priority, setPriority] = useState(task.priority);
  const [taskType, setTaskType] = useState(task.type);
  const [duration, setDuration] = useState<number | null>(parseDuration(task.description));
  const [status, setStatus] = useState(task.status);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const handleSave = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);

    let dueAt: number | null = null;
    if (dueDate) {
      const dateStr = dueTime ? `${dueDate}T${dueTime}` : `${dueDate}T00:00`;
      const parsed = new Date(dateStr).getTime();
      if (!isNaN(parsed)) dueAt = parsed;
    }

    const description = encodeDuration(task.description, duration);
    const plannerItemId = task.plannerItemId ?? task.id;

    await apiUpdateTask(plannerItemId, {
      title: trimmed,
      description: description || null,
      priority,
      type: taskType,
      status,
      dueAt: dueAt ?? null,
    });

    setSaving(false);
    notifyWorkspaceContentMutated({
      workstreamId: task.workspaceId ?? undefined,
      refreshHub: true,
      refreshWorkstreams: true,
    });
    onSaved();
  }, [title, dueDate, dueTime, priority, taskType, duration, status, saving, task, onSaved]);

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-[var(--accent-cyan)]/20 bg-[var(--bg-secondary)]/10 p-3 mx-1">
      <input
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); if (e.key === "Escape") onCancel(); }}
        className="w-full bg-transparent text-[12px] font-semibold text-[var(--text-primary)] outline-none border-b border-[var(--accent-cyan)]/20 pb-1.5"
      />

      {/* Date + Time */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5">
          <label className="text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]/50">Date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
            className="rounded-lg border border-[var(--border-default)]/20 bg-[var(--bg-elevated)]/50 px-2 py-1.5 text-[10px] text-[var(--text-primary)] outline-none" />
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]/50">Time</label>
          <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)}
            className="rounded-lg border border-[var(--border-default)]/20 bg-[var(--bg-elevated)]/50 px-2 py-1.5 text-[10px] text-[var(--text-primary)] outline-none" />
        </div>
      </div>

      {/* Duration */}
      <div className="flex flex-col gap-0.5">
        <label className="text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]/50">Duration</label>
        <div className="flex flex-wrap gap-1">
          {DURATION_OPTIONS.map((opt) => (
            <button key={opt.minutes} type="button"
              onClick={() => setDuration(duration === opt.minutes ? null : opt.minutes)}
              className={cn(
                "rounded-md px-2 py-0.5 text-[9px] font-semibold transition-all",
                duration === opt.minutes
                  ? "bg-[var(--accent-cyan)]/12 text-[var(--accent-cyan)] ring-1 ring-[var(--accent-cyan)]/20"
                  : "bg-[var(--bg-secondary)]/15 text-[var(--text-tertiary)]/60 hover:text-[var(--text-secondary)]",
              )}
            >{opt.label}</button>
          ))}
        </div>
      </div>

      {/* Priority + Type + Status */}
      <div className="grid grid-cols-3 gap-1.5">
        <div className="flex flex-col gap-0.5">
          <label className="text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]/50">Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value as PlannerTask["priority"])}
            className="rounded-lg border border-[var(--border-default)]/20 bg-[var(--bg-elevated)]/50 px-1.5 py-1 text-[9px] font-semibold text-[var(--text-primary)] outline-none">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]/50">Type</label>
          <select value={taskType} onChange={(e) => setTaskType(e.target.value as PlannerTask["type"])}
            className="rounded-lg border border-[var(--border-default)]/20 bg-[var(--bg-elevated)]/50 px-1.5 py-1 text-[9px] font-semibold text-[var(--text-primary)] outline-none">
            <option value="deadline">Deadline</option>
            <option value="milestone">Milestone</option>
            <option value="goal">Goal</option>
            <option value="reminder">Reminder</option>
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]/50">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as PlannerTask["status"])}
            className="rounded-lg border border-[var(--border-default)]/20 bg-[var(--bg-elevated)]/50 px-1.5 py-1 text-[9px] font-semibold text-[var(--text-primary)] outline-none">
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-0.5">
        <button type="button" onClick={onDelete}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-semibold text-rose-400/70 hover:bg-rose-400/8 hover:text-rose-400 transition-colors">
          <Trash2 className="h-2.5 w-2.5" /> Delete
        </button>
        <div className="flex gap-1.5">
          <button type="button" onClick={onCancel}
            className="rounded-lg px-2.5 py-1 text-[9px] font-semibold text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]">
            Cancel
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={!title.trim() || saving}
            className={cn("rounded-lg px-3 py-1 text-[9px] font-bold transition-all",
              title.trim() && !saving ? "bg-[var(--accent-cyan)] text-white" : "bg-[var(--bg-secondary)]/30 text-[var(--text-tertiary)] cursor-not-allowed")}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Task Row ────────────────────────────────────────── */

function TaskRow({
  task,
  workspaces,
  onToggle,
  onClick,
  onRefresh,
  now,
}: {
  task: PlannerTask;
  workspaces: { id: string; name: string; emoji: string }[];
  onToggle: () => void;
  onClick: () => void;
  onRefresh: () => void;
  now: number;
}) {
  const [editing, setEditing] = useState(false);
  const isCompleted = task.status === "completed";
  const isInProgress = task.status === "in_progress";
  const dueMs = task.dueAt ?? (task.dueDate ? new Date(task.dueDate).getTime() : undefined);
  const isOverdue = dueMs ? dueMs < now && !isCompleted : false;
  const dur = parseDuration(task.description);
  const timeStr = formatTimeShort(dueMs);

  const handleDelete = useCallback(async () => {
    const plannerItemId = task.plannerItemId ?? task.id;
    await apiDeleteTask(plannerItemId);
    notifyWorkspaceContentMutated({
      workstreamId: task.workspaceId ?? undefined,
      refreshHub: true,
      refreshWorkstreams: true,
    });
    onRefresh();
  }, [task, onRefresh]);

  if (editing) {
    return (
      <TaskEditForm
        task={task}
        workspaces={workspaces}
        onSaved={() => { setEditing(false); onRefresh(); }}
        onCancel={() => setEditing(false)}
        onDelete={() => { void handleDelete(); setEditing(false); }}
      />
    );
  }

  return (
    <div
      className={cn(
        "group/task flex items-start gap-2 rounded-xl px-2.5 py-2 transition-all duration-150",
        !isCompleted && "cursor-pointer hover:bg-[var(--bg-hover)]/60",
        isInProgress && "bg-[color-mix(in_oklab,var(--accent-cyan)_3%,transparent)]",
        isOverdue && !isCompleted && "bg-[color-mix(in_oklab,var(--danger)_3%,transparent)]",
        isCompleted && "opacity-40",
      )}
    >
      {/* Toggle */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className="mt-[3px] shrink-0 transition-transform duration-100 hover:scale-110 active:scale-95"
      >
        {isCompleted ? (
          <CheckCircle2 className="h-[15px] w-[15px] text-[var(--success)]" />
        ) : isInProgress ? (
          <Clock className="h-[15px] w-[15px] text-[var(--accent-cyan)]" />
        ) : (
          <Circle className={cn("h-[15px] w-[15px] transition-colors",
            isOverdue ? "text-rose-400/50" : "text-[var(--text-tertiary)]/30 group-hover/task:text-[var(--accent-cyan)]/60")} />
        )}
      </button>

      {/* Content */}
      <div className="min-w-0 flex-1" onClick={() => { if (!isCompleted) onClick(); }}>
        <div className="flex items-start justify-between">
          <span className={cn(
            "text-[12px] font-medium leading-tight",
            isCompleted ? "text-[var(--text-tertiary)] line-through" : "text-[var(--text-primary)]",
          )}>
            {task.title}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); setEditing(true); }}
            className="opacity-0 group-hover/task:opacity-100 shrink-0 ml-1 text-[9px] font-medium text-[var(--text-tertiary)] hover:text-[var(--accent-cyan)] transition-all"
          >
            Edit
          </button>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {task.workspaceName && (
            <span className="text-[9px] text-[var(--text-tertiary)]/50">{task.workspaceName}</span>
          )}
          <span className={cn("h-[4px] w-[4px] shrink-0 rounded-full", PRIORITY_DOT[task.priority])} />
          {timeStr && (
            <span className={cn("text-[9px] font-medium", isOverdue ? "text-rose-400" : "text-[var(--text-secondary)]/60")}>
              {timeStr}
            </span>
          )}
          {dueMs && (
            <span className={cn("text-[9px] font-medium", isOverdue ? "text-rose-400" : "text-[var(--text-secondary)]/60")}>
              {formatDueDate(dueMs)}
            </span>
          )}
          {dur && (
            <span className="text-[9px] font-medium text-[var(--accent-cyan)]/50">{dur}m</span>
          )}
          <span className="text-[8px] text-[var(--text-tertiary)]/30">{TYPE_LABELS[task.type]}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Calendar Day View ───────────────────────────────── */

function DayDetailView({
  date,
  tasks,
  workspaces,
  onToggle,
  onClick,
  onRefresh,
  onBack,
  now,
}: {
  date: Date;
  tasks: PlannerTask[];
  workspaces: { id: string; name: string; emoji: string }[];
  onToggle: (taskId: string) => void;
  onClick: (taskId: string) => void;
  onRefresh: () => void;
  onBack: () => void;
  now: number;
}) {
  const dayStr = date.toDateString();
  const dayTasks = tasks.filter((t) => {
    const ms = t.dueAt ?? (t.dueDate ? new Date(t.dueDate).getTime() : undefined);
    return ms && new Date(ms).toDateString() === dayStr;
  }).sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));

  // Build hour blocks for the day
  const hourBlocks = useMemo(() => {
    const blocks: { hour: number; tasks: PlannerTask[] }[] = [];
    for (let h = 0; h < 24; h++) {
      const hourTasks = dayTasks.filter((t) => {
        const ms = t.dueAt ?? (t.dueDate ? new Date(t.dueDate).getTime() : undefined);
        if (!ms) return false;
        const d = new Date(ms);
        if (d.getHours() === 0 && d.getMinutes() === 0) return false; // treated as all-day
        return d.getHours() === h;
      });
      if (hourTasks.length > 0) {
        blocks.push({ hour: h, tasks: hourTasks });
      }
    }
    // Tasks without specific time
    const noTimeTasks = dayTasks.filter((t) => {
      const ms = t.dueAt ?? (t.dueDate ? new Date(t.dueDate).getTime() : undefined);
      if (!ms) return true;
      const d = new Date(ms);
      return d.getHours() === 0 && d.getMinutes() === 0;
    });
    return { blocks, noTimeTasks };
  }, [dayTasks]);

  const isToday = date.toDateString() === new Date().toDateString();

  return (
    <div className="flex flex-col">
      <button type="button" onClick={onBack}
        className="flex items-center gap-1 px-1 py-1 text-[10px] font-semibold text-[var(--text-tertiary)] hover:text-[var(--accent-cyan)] transition-colors mb-1">
        <ChevronLeft className="h-3 w-3" />
        Back to calendar
      </button>

      <div className="flex items-center gap-2 px-1 mb-3">
        <span className={cn(
          "text-[22px] font-bold leading-none",
          isToday ? "text-[var(--accent-cyan)]" : "text-[var(--text-primary)]",
        )}>
          {date.getDate()}
        </span>
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold text-[var(--text-primary)]">
            {date.toLocaleDateString(undefined, { weekday: "long" })}
          </span>
          <span className="text-[9px] text-[var(--text-tertiary)]">
            {date.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </span>
        </div>
        {isToday && (
          <span className="ml-auto rounded-full bg-[var(--accent-cyan)]/10 px-2 py-0.5 text-[8px] font-bold text-[var(--accent-cyan)] uppercase tracking-wider">Today</span>
        )}
      </div>

      {dayTasks.length === 0 ? (
        <div className="flex h-24 flex-col items-center justify-center text-center">
          <CalendarDays className="mb-1.5 h-5 w-5 text-[var(--text-tertiary)] opacity-20" />
          <span className="text-[11px] text-[var(--text-tertiary)]/60">No tasks scheduled</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {/* All-day / no-time tasks */}
          {hourBlocks.noTimeTasks.length > 0 && (
            <div className="mb-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]/40 px-1">All Day</span>
              <div className="flex flex-col gap-0.5 mt-1">
                {hourBlocks.noTimeTasks.map((t) => (
                  <TaskRow key={t.id} task={t} workspaces={workspaces} now={now}
                    onToggle={() => onToggle(t.plannerItemId ?? t.id)}
                    onClick={() => onClick(t.id)} onRefresh={onRefresh} />
                ))}
              </div>
            </div>
          )}

          {/* Timed tasks */}
          {hourBlocks.blocks.map(({ hour, tasks: hTasks }) => (
            <div key={hour} className="mb-1.5">
              <span className="text-[9px] font-bold text-[var(--text-tertiary)]/40 px-1">
                {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
              </span>
              <div className="flex flex-col gap-0.5 mt-0.5 border-l-2 border-[var(--accent-cyan)]/10 ml-2 pl-2">
                {hTasks.map((t) => (
                  <TaskRow key={t.id} task={t} workspaces={workspaces} now={now}
                    onToggle={() => onToggle(t.plannerItemId ?? t.id)}
                    onClick={() => onClick(t.id)} onRefresh={onRefresh} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Calendar View ───────────────────────────────────── */

function CalendarView({
  tasks,
  workspaces,
  onTaskClick,
  onToggle,
  onRefresh,
  now,
}: {
  tasks: PlannerTask[];
  workspaces: { id: string; name: string; emoji: string }[];
  onTaskClick: (taskId: string) => void;
  onToggle: (taskId: string) => void;
  onRefresh: () => void;
  now: number;
}) {
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  const tasksByDay = (() => {
    const map: Record<number, PlannerTask[]> = {};
    for (const task of tasks) {
      if (task.status === "completed" || task.status === "cancelled") continue;
      const ms = task.dueAt ?? (task.dueDate ? new Date(task.dueDate).getTime() : undefined);
      if (!ms) continue;
      const d = new Date(ms);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        if (!map[day]) map[day] = [];
        map[day].push(task);
      }
    }
    return map;
  })();

  if (selectedDay) {
    return (
      <DayDetailView
        date={selectedDay}
        tasks={tasks}
        workspaces={workspaces}
        onToggle={onToggle}
        onClick={onTaskClick}
        onRefresh={onRefresh}
        onBack={() => setSelectedDay(null)}
        now={now}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <button type="button" onClick={() => setViewDate(new Date(year, month - 1, 1))}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-[12px] font-semibold text-[var(--text-primary)]">
          {viewDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <button type="button" onClick={() => setViewDate(new Date(year, month + 1, 1))}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="text-[9px] font-bold text-[var(--text-tertiary)]/40 py-1">{d}</div>
        ))}
        {Array.from({ length: firstDay }).map((_, i) => <div key={`e-${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dayTasks = tasksByDay[day];
          const hasTasks = !!dayTasks;
          const isToday = isCurrentMonth && today.getDate() === day;
          const highPriority = dayTasks?.some((t) => t.priority === "high");
          const taskCount = dayTasks?.length ?? 0;

          return (
            <button
              key={day}
              type="button"
              onClick={() => setSelectedDay(new Date(year, month, day))}
              className={cn(
                "relative flex flex-col items-center justify-center h-[34px] rounded-xl text-[11px] font-medium transition-all",
                hasTasks ? "hover:bg-[var(--accent-cyan)]/8 text-[var(--text-primary)]" : "text-[var(--text-secondary)]/70 hover:bg-[var(--bg-hover)]/50",
                isToday && "ring-1 ring-[var(--accent-cyan)]/30 font-bold",
              )}
            >
              {day}
              {hasTasks && (
                <div className="absolute bottom-[2px] flex gap-[2px]">
                  {taskCount <= 3 ? (
                    Array.from({ length: taskCount }).map((_, di) => (
                      <div key={di} className={cn("h-[3px] w-[3px] rounded-full",
                        highPriority ? "bg-rose-400" : "bg-[var(--accent-cyan)]/60")} />
                    ))
                  ) : (
                    <div className={cn("h-[3px] w-[8px] rounded-full",
                      highPriority ? "bg-rose-400" : "bg-[var(--accent-cyan)]/60")} />
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Upcoming section below calendar */}
      <div className="mt-1 border-t border-[var(--border-default)]/10 pt-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]/50 px-1">Upcoming</span>
        <div className="flex flex-col gap-0.5 mt-1">
          {tasks
            .filter((t) => t.status !== "completed" && t.status !== "cancelled")
            .filter((t) => {
              const ms = t.dueAt ?? (t.dueDate ? new Date(t.dueDate).getTime() : undefined);
              return Boolean(ms && ms >= now);
            })
            .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
            .slice(0, 5)
            .map((t) => (
              <TaskRow key={t.id} task={t} workspaces={workspaces} now={now}
                onToggle={() => onToggle(t.plannerItemId ?? t.id)}
                onClick={() => onTaskClick(t.id)} onRefresh={onRefresh} />
            ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Completed Tasks Section ─────────────────────────── */

function CompletedSection({
  tasks,
  workspaces,
  onToggle,
  onClick,
  onRefresh,
  now,
}: {
  tasks: PlannerTask[];
  workspaces: { id: string; name: string; emoji: string }[];
  onToggle: (taskId: string) => void;
  onClick: (taskId: string) => void;
  onRefresh: () => void;
  now: number;
}) {
  const [show, setShow] = useState(false);
  const completed = tasks.filter((t) => t.status === "completed");
  if (completed.length === 0) return null;

  return (
    <div className="mt-2 border-t border-[var(--border-default)]/10 pt-2">
      <button type="button" onClick={() => setShow(!show)}
        className="flex items-center gap-1.5 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]/40 hover:text-[var(--text-tertiary)] transition-colors">
        <CheckCircle2 className="h-2.5 w-2.5" />
        {completed.length} completed
        <ChevronRight className={cn("h-2.5 w-2.5 transition-transform", show && "rotate-90")} />
      </button>
      {show && (
        <div className="flex flex-col gap-0.5 mt-1">
          {completed.slice(0, 10).map((t) => (
            <TaskRow key={t.id} task={t} workspaces={workspaces} now={now}
              onToggle={() => onToggle(t.plannerItemId ?? t.id)}
              onClick={() => onClick(t.id)} onRefresh={onRefresh} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Main Planner Edge ───────────────────────────────── */

export function PlannerEdge({ tasks: externalTasks, onTaskClick, onToggleTask, onTaskEdit: _onTaskEdit, forceExpanded, className }: PlannerEdgeProps) {
  const [locked, setLocked] = useState(false);
  const [activeTab, setActiveTab] = useState<"list" | "calendar">("list");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [backendTasks, setBackendTasks] = useState<PlannerTask[]>([]);
  const [fetchedOnce, setFetchedOnce] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [renderNow, setRenderNow] = useState(() => Date.now());
  void _onTaskEdit;

  const committedWorkspaceId = useWorkspaceStore((s) => s.committedWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const wsLookup = useMemo(() => {
    const map: Record<string, string> = {};
    for (const ws of workspaces) map[ws.id] = ws.name;
    return map;
  }, [workspaces]);

  const wsOptions = useMemo(() =>
    workspaces.map((ws) => ({ id: ws.id, name: ws.name, emoji: ws.emoji })),
    [workspaces],
  );

  useEffect(() => {
    const interval = window.setInterval(() => setRenderNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [setRenderNow]);

  // Fetch real planner items from backend
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const items = await apiFetchAllTasks();
      if (cancelled) return;
      // Enrich with workspace names
      const enriched = items.map((t) => ({
        ...t,
        workspaceName: t.workspaceId ? (wsLookup[t.workspaceId] ?? "") : "",
      }));
      setBackendTasks(enriched);
      setFetchedOnce(true);
    }
    void load();
    return () => { cancelled = true; };
  }, [refreshKey, wsLookup]);

  // Listen for workspace content mutations to refresh
  useEffect(() => {
    function handler() { setRefreshKey((k) => k + 1); }
    window.addEventListener("workspace:content-mutated", handler);
    return () => window.removeEventListener("workspace:content-mutated", handler);
  }, []);

  // Merge external (prop) tasks with backend tasks, dedup by plannerItemId
  const allTasks = useMemo(() => {
    if (!fetchedOnce && externalTasks && externalTasks.length > 0) return externalTasks;
    if (!fetchedOnce) return [];
    const byId = new Map<string, PlannerTask>();
    for (const t of backendTasks) byId.set(t.id, t);
    // External tasks can override if they have extra info
    if (externalTasks) {
      for (const t of externalTasks) {
        if (t.plannerItemId && byId.has(t.plannerItemId)) continue;
        if (!byId.has(t.id)) byId.set(t.id, t);
      }
    }
    return Array.from(byId.values());
  }, [backendTasks, externalTasks, fetchedOnce]);

  const activeTasks = allTasks.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const groups = useMemo(() => groupTasks(allTasks), [allTasks]);
  const pendingCount = activeTasks.length;
  const inProgressCount = allTasks.filter((t) => t.status === "in_progress").length;
  const completedCount = allTasks.filter((t) => t.status === "completed").length;

  const handleRefresh = useCallback(() => { setRefreshKey((k) => k + 1); }, []);

  const handleToggle = useCallback(async (taskId: string) => {
    const task = allTasks.find((t) => t.id === taskId || t.plannerItemId === taskId);
    const plannerItemId = task?.plannerItemId ?? task?.id;
    if (!task || !plannerItemId) return;

    const newStatus = task.status === "completed" ? "pending" : "completed";
    await apiUpdateTask(plannerItemId, {
      status: newStatus,
      completedAt: newStatus === "completed" ? Date.now() : null,
    });

    notifyWorkspaceContentMutated({
      workstreamId: task.workspaceId ?? undefined,
      refreshHub: true,
    });
    handleRefresh();

    // Also call the external handler if provided
    if (onToggleTask) onToggleTask(taskId);
  }, [allTasks, onToggleTask, handleRefresh]);

  const handleTaskClick = useCallback((taskId: string) => {
    if (onTaskClick) onTaskClick(taskId);
  }, [onTaskClick]);

  const collapsed = (
    <button
      type="button"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-[14px] border border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/95 backdrop-blur-xl shadow-[0_10px_24px_-16px_rgba(8,22,40,0.14)] w-[36px] min-h-[100px] py-3",
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
      onToggleLock={() => setLocked((v) => !v)}
      className="!top-[140px] !-translate-y-0"
      expandedClassName="left-1"
    >
      <div className="flex h-[min(76vh,780px)] w-[360px] flex-col overflow-hidden rounded-[28px]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-1 pt-4">
          <div className="flex items-center gap-2">
            <CalendarCheck className="h-4 w-4 text-[var(--accent-cyan)]" />
            <span className="text-[13px] font-semibold text-[var(--text-primary)]">Planner</span>
          </div>
          {committedWorkspaceId && (
            <span className="text-[9px] font-medium text-[var(--accent-cyan)]/60 bg-[var(--accent-cyan)]/8 rounded-full px-2 py-0.5">
              {wsLookup[committedWorkspaceId] ?? "Workspace"}
            </span>
          )}
        </div>

        {/* Stats bar */}
        <div className="mx-4 mb-2 flex items-center gap-3 text-[10px]">
          {inProgressCount > 0 && (
            <span className="flex items-center gap-1 text-[var(--accent-cyan)]">
              <Clock className="h-2.5 w-2.5" /> {inProgressCount} active
            </span>
          )}
          <span className="text-[var(--text-tertiary)]">{pendingCount} pending</span>
          {completedCount > 0 && (
            <span className="text-[var(--success)]/60">{completedCount} done</span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mx-4 mb-2">
          <button type="button" onClick={() => setActiveTab("list")}
            className={cn(
              "flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11px] font-semibold transition-colors",
              activeTab === "list" ? "bg-[var(--bg-secondary)]/40 text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
            )}>
            <List className="h-3 w-3" /> List
          </button>
          <button type="button" onClick={() => setActiveTab("calendar")}
            className={cn(
              "flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11px] font-semibold transition-colors",
              activeTab === "calendar" ? "bg-[var(--bg-secondary)]/40 text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
            )}>
            <CalendarDays className="h-3 w-3" /> Calendar
          </button>
        </div>

        {/* Task creation */}
        {showCreateForm ? (
          <TaskCreationForm
            workspaceId={committedWorkspaceId}
            workspaces={wsOptions}
            onCreated={() => { setShowCreateForm(false); handleRefresh(); }}
            onCancel={() => setShowCreateForm(false)}
          />
        ) : (
          <QuickAddBar onExpand={() => setShowCreateForm(true)} />
        )}

        <div className="h-px bg-[var(--border-default)]/10 mx-4" />

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
          {activeTab === "calendar" ? (
            <CalendarView
              tasks={allTasks}
              workspaces={wsOptions}
              onTaskClick={handleTaskClick}
              onToggle={handleToggle}
              onRefresh={handleRefresh}
              now={renderNow}
            />
          ) : groups.length === 0 && completedCount === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-center">
              <CheckCircle2 className="mb-2 h-6 w-6 text-[var(--success)] opacity-20" />
              <span className="text-[11px] text-[var(--text-tertiary)]">
                {fetchedOnce ? "All caught up!" : "Loading tasks…"}
              </span>
            </div>
          ) : (
            <>
              {groups.map((group) => (
                <div key={group.label} className="mb-3">
                  <div className="mb-1.5 px-2">
                    <span className={cn("text-[10px] font-bold uppercase tracking-[0.12em]", group.color)}>
                      {group.label}
                      <span className="ml-1.5 text-[var(--text-tertiary)]/30">{group.items.length}</span>
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {group.items.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        workspaces={wsOptions}
                        onToggle={() => handleToggle(task.plannerItemId ?? task.id)}
                        onClick={() => handleTaskClick(task.id)}
                        onRefresh={handleRefresh}
                        now={renderNow}
                      />
                    ))}
                  </div>
                </div>
              ))}

              <CompletedSection
                tasks={allTasks}
                workspaces={wsOptions}
                onToggle={handleToggle}
                onClick={handleTaskClick}
                onRefresh={handleRefresh}
                now={renderNow}
              />
            </>
          )}
        </div>
      </div>
    </HubSurface>
  );
}
