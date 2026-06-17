import type { LucideIcon } from "lucide-react";
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

const blueprintMeta: Record<ArtifactCardView["blueprintKey"], { label: string; icon: LucideIcon; color: string }> = {
  document: { label: "Document", icon: FileText, color: "var(--accent-cyan)" },
  thread_reference: { label: "Thread", icon: MessageSquare, color: "var(--mode-research)" },
  flashcard_deck: { label: "Deck", icon: BookOpen, color: "var(--mode-flashcard)" },
  quiz: { label: "Quiz", icon: HelpCircle, color: "var(--mode-quiz)" },
  planner_task: { label: "Task", icon: CalendarCheck2, color: "var(--success)" },
};

export function ArtifactCard({ artifact, selected = false }: { artifact: ArtifactCardView; selected?: boolean }) {
  const meta = blueprintMeta[artifact.blueprintKey];
  const Icon = meta.icon;
  return (
    <article
      className={cn(
        "rounded-[8px] border bg-[var(--bg-elevated)] p-4 transition-colors",
        selected ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))]" : "border-[var(--border-default)] hover:bg-[var(--bg-hover)]/35",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]"
          style={{
            color: meta.color,
            background: `color-mix(in oklab, ${meta.color} 11%, var(--bg-secondary))`,
          }}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-[var(--text-tertiary)]">{meta.label}</span>
            <span className="h-1 w-1 rounded-full bg-[var(--border-default)]" />
            <span className="text-[11px] text-[var(--text-tertiary)]">
              {artifact.placement === "workspace" ? "In workspace" : "Inbox"}
            </span>
          </div>
          <h3 className="mt-1 truncate text-[14px] font-semibold text-[var(--text-primary)]">{artifact.title}</h3>
          <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--text-secondary)]">{artifact.summary}</p>
          <div className="mt-3 text-[11px] text-[var(--text-tertiary)]">{artifact.meta}</div>
        </div>
      </div>
    </article>
  );
}

