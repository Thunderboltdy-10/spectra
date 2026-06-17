import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { BookOpen, CalendarCheck2, FileText, HelpCircle, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export type ArtifactCardView = {
  id: string;
  title: string;
  blueprintKey: "document" | "thread_reference" | "flashcard_deck" | "quiz" | "planner_task";
  summary: string;
  meta: string;
  placement: "inbox" | "workspace";
};

export const blueprintMeta: Record<ArtifactCardView["blueprintKey"], { label: string; icon: LucideIcon; color: string }> = {
  document: { label: "Document", icon: FileText, color: "var(--mode-document)" },
  thread_reference: { label: "Thread", icon: MessageSquare, color: "var(--mode-research)" },
  flashcard_deck: { label: "Deck", icon: BookOpen, color: "var(--mode-flashcard)" },
  quiz: { label: "Quiz", icon: HelpCircle, color: "var(--mode-quiz)" },
  planner_task: { label: "Task", icon: CalendarCheck2, color: "var(--accent-coral)" },
};

export function ArtifactCard({
  artifact,
  selected = false,
  actions,
  onSelect,
  className,
}: {
  artifact: ArtifactCardView;
  selected?: boolean;
  actions?: ReactNode;
  onSelect?: () => void;
  className?: string;
}) {
  const meta = blueprintMeta[artifact.blueprintKey];
  const Icon = meta.icon;
  const interactive = Boolean(onSelect);

  return (
    <article
      className={cn(
        "relative border bg-[var(--bg-elevated)] p-3.5 text-left transition-colors",
        "rounded-[10px]",
        selected
          ? "border-[color-mix(in_oklab,var(--accent-cyan)_55%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_5%,var(--bg-elevated))]"
          : "border-[var(--border-default)] hover:border-[color-mix(in_oklab,var(--accent-cyan)_28%,var(--border-default))]",
        interactive ? "cursor-pointer" : "",
        className,
      )}
      onClick={onSelect}
    >
      <div className="absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: meta.color }} />
      <div className="flex items-start gap-3 pl-1">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--bg-secondary)]" style={{ color: meta.color }}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[11px] font-semibold" style={{ color: meta.color }}>{meta.label}</span>
            <span className="min-w-0 truncate text-[11px] text-[var(--text-tertiary)]">
              {artifact.placement === "workspace" ? "In workspace" : "Inbox"}
            </span>
          </div>
          <h3 className="mt-1 truncate text-[14px] font-semibold text-[var(--text-primary)]">{artifact.title}</h3>
          <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--text-secondary)]">{artifact.summary}</p>
          <div className="mt-3 flex min-h-7 items-end justify-between gap-2">
            <div className="min-w-0 truncate text-[11px] text-[var(--text-tertiary)]">{artifact.meta}</div>
            {actions ? <div className="flex shrink-0 items-center gap-1.5" onClick={(event) => event.stopPropagation()}>{actions}</div> : null}
          </div>
        </div>
      </div>
    </article>
  );
}
