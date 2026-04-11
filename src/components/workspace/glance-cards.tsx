"use client";

import { useEffect, useState } from "react";
import {
  CalendarCheck,
  Code2,
  FileDown,
  FileText,
  HelpCircle,
  Image,
  Layout,
  Layers,
  MessageSquare,
  Sparkles,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type GlanceItemType =
  | "note"
  | "code"
  | "visual"
  | "export"
  | "board"
  | "flashcard_deck"
  | "quiz"
  | "thread"
  | "planner_task";

export type GlanceStatus = "active" | "ai_created" | "due" | "completed" | "idle";

export type GlanceCardData = {
  id: string;
  type: GlanceItemType;
  title: string;
  preview?: string;
  status: GlanceStatus;
  meta?: string;
  updatedAt?: number;
};

const TYPE_ICON: Record<GlanceItemType, React.ComponentType<{ className?: string }>> = {
  note: FileText,
  code: Code2,
  visual: Image,
  export: FileDown,
  board: Layout,
  flashcard_deck: Layers,
  quiz: HelpCircle,
  thread: MessageSquare,
  planner_task: CalendarCheck,
};

const TYPE_LABEL: Record<GlanceItemType, string> = {
  note: "Note",
  code: "Code",
  visual: "Visual",
  export: "Export",
  board: "Board",
  flashcard_deck: "Flashcards",
  quiz: "Quiz",
  thread: "Thread",
  planner_task: "Task",
};

const TYPE_COLOR: Record<GlanceItemType, string> = {
  note: "#f59f0a",
  code: "#ba4f26",
  visual: "#1f9fb2",
  export: "#637083",
  board: "#0f6fa7",
  flashcard_deck: "#1f9fb2",
  quiz: "#8f51d9",
  thread: "#0e8ee8",
  planner_task: "#158f72",
};

const STATUS_DOT_COLOR: Record<GlanceStatus, string> = {
  active: "bg-[var(--success)]",
  ai_created: "bg-[var(--accent-cyan)]",
  due: "bg-[var(--warning)]",
  completed: "bg-[var(--text-tertiary)]",
  idle: "bg-[var(--border-default)]",
};

function StatusDot({ status }: { status: GlanceStatus }) {
  return (
    <span
      className={cn(
        "inline-block h-[5px] w-[5px] rounded-full shrink-0",
        STATUS_DOT_COLOR[status],
        status === "active" && "animate-pulse",
      )}
    />
  );
}

function formatTimeAgo(timestamp?: number): string {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export function GlanceCard({ item, className }: { item: GlanceCardData; className?: string }) {
  const Icon = TYPE_ICON[item.type];
  const label = TYPE_LABEL[item.type];
  const color = TYPE_COLOR[item.type];
  const [isRecentlyEdited, setIsRecentlyEdited] = useState(false);

  useEffect(() => {
    if (item.status !== "active" || !item.updatedAt) {
      setIsRecentlyEdited(false);
      return;
    }
    setIsRecentlyEdited(Date.now() - item.updatedAt < 3_600_000);
  }, [item.status, item.updatedAt]);

  return (
    <div
      className={cn(
        "group relative flex flex-col gap-1.5 min-w-[220px] max-w-[280px] rounded-[14px] border px-3.5 py-3",
        "border-[var(--border-default)]/50 bg-[var(--bg-elevated)]/92",
        "transition-all duration-200 ease-[var(--ease-standard)]",
        "hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--border-default))]",
        className,
      )}
      style={{
        boxShadow: "0 6px 18px -14px rgba(7,20,35,0.14)",
      }}
    >
      <div className="flex items-center gap-2">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{
            backgroundColor: `color-mix(in oklab, ${color} 10%, var(--bg-secondary))`,
          }}
        >
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
        <span className="flex-1 truncate text-[13px] font-semibold text-[var(--text-primary)]">
          {item.title}
        </span>
        <div className="flex items-center gap-1.5">
          {item.status === "ai_created" && (
            <Sparkles className="h-3 w-3 text-[var(--accent-cyan)] opacity-60" />
          )}
          <StatusDot status={item.status} />
        </div>
      </div>

      {item.preview ? (
        <p className="pl-9 text-[11.5px] leading-[1.45] text-[var(--text-tertiary)] line-clamp-2">
          {item.preview}
        </p>
      ) : null}

      <div className="flex items-center justify-between pl-9">
        <span
          className="text-[10px] font-medium uppercase tracking-[0.12em] opacity-50"
          style={{ color }}
        >
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          {item.updatedAt && (
            <span className="flex items-center gap-0.5 text-[10px] text-[var(--text-tertiary)]/50">
              <Clock className="h-2.5 w-2.5" />
              {formatTimeAgo(item.updatedAt)}
            </span>
          )}
          {item.meta ? (
            <span className="text-[10.5px] font-medium text-[var(--text-secondary)]">{item.meta}</span>
          ) : null}
        </div>
      </div>

      {/* Recently edited indicator */}
      {isRecentlyEdited && (
        <div
          className="absolute -right-px -top-px h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)] opacity-50"
        />
      )}
    </div>
  );
}
