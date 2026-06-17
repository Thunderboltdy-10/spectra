import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  BookOpen,
  CalendarCheck2,
  FileText,
  HelpCircle,
  MessageSquare,
  Pin,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ArtifactCardView = {
  id: string;
  title: string;
  blueprintKey: "document" | "thread_reference" | "flashcard_deck" | "quiz" | "planner_task";
  summary: string;
  meta: string;
  placement: "inbox" | "workspace";
  pinned?: boolean;
};

export const blueprintMeta: Record<ArtifactCardView["blueprintKey"], {
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  color: string;
  soft: string;
}> = {
  document: {
    label: "Document",
    shortLabel: "Doc",
    icon: FileText,
    color: "var(--mode-document)",
    soft: "color-mix(in oklab, var(--mode-document) 12%, var(--bg-secondary))",
  },
  thread_reference: {
    label: "Thread reference",
    shortLabel: "Thread",
    icon: MessageSquare,
    color: "var(--mode-research)",
    soft: "color-mix(in oklab, var(--mode-research) 12%, var(--bg-secondary))",
  },
  flashcard_deck: {
    label: "Flashcard deck",
    shortLabel: "Deck",
    icon: BookOpen,
    color: "var(--mode-flashcard)",
    soft: "color-mix(in oklab, var(--mode-flashcard) 12%, var(--bg-secondary))",
  },
  quiz: {
    label: "Quiz",
    shortLabel: "Quiz",
    icon: HelpCircle,
    color: "var(--mode-quiz)",
    soft: "color-mix(in oklab, var(--mode-quiz) 12%, var(--bg-secondary))",
  },
  planner_task: {
    label: "Planner task",
    shortLabel: "Task",
    icon: CalendarCheck2,
    color: "var(--accent-coral)",
    soft: "color-mix(in oklab, var(--accent-coral) 12%, var(--bg-secondary))",
  },
};

export function ArtifactCard({
  artifact,
  selected = false,
  elevated = false,
  actions,
  onSelect,
  className,
}: {
  artifact: ArtifactCardView;
  selected?: boolean;
  elevated?: boolean;
  actions?: ReactNode;
  onSelect?: () => void;
  className?: string;
}) {
  const meta = blueprintMeta[artifact.blueprintKey];
  const Icon = meta.icon;
  const clickable = Boolean(onSelect);

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-[8px] border bg-[var(--bg-elevated)] p-3.5 text-left transition-[background,border-color,box-shadow,transform] duration-200",
        "before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r-full before:opacity-80",
        selected
          ? "border-[color-mix(in_oklab,var(--accent-cyan)_56%,var(--border-default))] shadow-[0_16px_44px_-30px_rgba(8,22,40,0.55)]"
          : "border-[color-mix(in_oklab,var(--border-default)_84%,transparent)] hover:border-[color-mix(in_oklab,var(--accent-cyan)_30%,var(--border-default))]",
        elevated ? "bg-[color-mix(in_oklab,var(--bg-elevated)_94%,var(--bg-secondary))]" : "",
        clickable ? "cursor-pointer hover:-translate-y-0.5 focus-within:-translate-y-0.5" : "",
        className,
      )}
      style={{
        borderTopColor: artifact.pinned ? `color-mix(in oklab, ${meta.color} 38%, var(--border-default))` : undefined,
      }}
      onClick={onSelect}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-14 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{
          background: `linear-gradient(180deg, color-mix(in oklab, ${meta.color} 9%, transparent), transparent)`,
        }}
      />
      <div className="relative flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] ring-1 ring-inset"
          style={{
            color: meta.color,
            background: meta.soft,
            boxShadow: selected ? `0 0 0 1px color-mix(in oklab, ${meta.color} 24%, transparent)` : undefined,
          }}
        >
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10.5px] font-semibold"
              style={{
                color: meta.color,
                background: meta.soft,
              }}
            >
              {meta.shortLabel}
            </span>
            {artifact.pinned ? (
              <span className="inline-flex h-5 items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-secondary))] px-2 text-[10.5px] font-semibold text-[var(--accent-cyan)]">
                <Pin className="h-3 w-3" />
                Pinned
              </span>
            ) : null}
            <span className="min-w-0 truncate text-[11px] text-[var(--text-tertiary)]">
              {artifact.placement === "workspace" ? "In workspace" : "Inbox"}
            </span>
          </div>
          <h3 className="mt-2 line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--text-primary)]">
            {artifact.title}
          </h3>
          <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-5 text-[var(--text-secondary)]">
            {artifact.summary}
          </p>
          <div className="mt-3 flex min-h-7 items-end justify-between gap-2">
            <div className="min-w-0 truncate text-[11px] font-medium text-[var(--text-tertiary)]">{artifact.meta}</div>
            {actions ? <div className="flex shrink-0 items-center gap-1.5" onClick={(event) => event.stopPropagation()}>{actions}</div> : null}
          </div>
        </div>
      </div>
    </article>
  );
}
