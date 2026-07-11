import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { BookOpen, CalendarCheck2, Check, FileText, HelpCircle, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { CardTypeIcon, SpectraCard, type SpectraCardState } from "./card-system";

export type ArtifactCardView = {
  id: string;
  title: string;
  blueprintKey: "document" | "thread_reference" | "flashcard_deck" | "quiz" | "planner_task";
  summary: string;
  meta: string;
  placement: "inbox" | "workspace";
  updatedAt?: number;
  pinned?: boolean;
  variant?: string;
  metrics?: Record<string, string | number>;
  aiState?: "generated" | "edited" | "creating" | "updating" | "failed";
  aiProgress?: number;
};

export const blueprintMeta: Record<ArtifactCardView["blueprintKey"], { label: string; icon: LucideIcon; color: string; soft: string }> = {
  document: { label: "Document", icon: FileText, color: "var(--mode-document)", soft: "color-mix(in oklab, var(--mode-document) 9%, var(--bg-elevated))" },
  thread_reference: { label: "Thread", icon: MessageSquare, color: "#8b6ff0", soft: "color-mix(in oklab, #8b6ff0 10%, var(--bg-elevated))" },
  flashcard_deck: { label: "Deck", icon: BookOpen, color: "#8b6ff0", soft: "color-mix(in oklab, #8b6ff0 8%, var(--bg-elevated))" },
  quiz: { label: "Quiz", icon: HelpCircle, color: "var(--mode-quiz)", soft: "color-mix(in oklab, var(--mode-quiz) 9%, var(--bg-elevated))" },
  planner_task: { label: "Task", icon: CalendarCheck2, color: "#d47a16", soft: "color-mix(in oklab, #d47a16 10%, var(--bg-elevated))" },
};

export function ArtifactCard({
  artifact,
  selected = false,
  actions,
  onSelect,
  className,
  size = "normal",
  quiet = false,
  selectionMode = false,
  contextSelected = false,
  onToggleContext,
}: {
  artifact: ArtifactCardView;
  selected?: boolean;
  actions?: ReactNode;
  onSelect?: () => void;
  className?: string;
  size?: "compact" | "normal" | "large";
  quiet?: boolean;
  selectionMode?: boolean;
  contextSelected?: boolean;
  onToggleContext?: () => void;
}) {
  const meta = blueprintMeta[artifact.blueprintKey];
  const Icon = meta.icon;
  const interactive = Boolean(onSelect);
  const metrics = Object.entries(artifact.metrics ?? {}).slice(0, size === "compact" ? 0 : 4);
  const cardState: SpectraCardState = contextSelected
    ? selectionMode ? "multi-selected" : "context"
    : selected
      ? "focused"
      : artifact.aiState === "creating"
        ? "creating"
        : artifact.aiState === "updating"
          ? "updating"
          : artifact.aiState === "edited" || artifact.aiState === "generated"
            ? "edited"
            : artifact.aiState === "failed"
              ? "failed"
            : "normal";

  return (
    <SpectraCard
      variant={artifact.pinned ? "pinned" : artifact.placement === "inbox" ? "inbox" : "artifact"}
      state={cardState}
      accent={artifact.pinned ? "var(--card-pinned)" : meta.color}
      className={cn(
        "text-left",
        size === "large" ? "min-h-[216px] rounded-[9px] p-4" : "rounded-[8px] p-3.5",
        interactive ? "cursor-pointer" : "",
        quiet ? "shadow-none" : "shadow-[0_1px_2px_rgba(27,20,12,0.03)]",
        className,
      )}
      onClick={(event) => {
        if (onToggleContext && (selectionMode || event.metaKey || event.ctrlKey)) {
          onToggleContext();
          return;
        }
        onSelect?.();
      }}
      data-interactive={interactive ? "true" : undefined}
      data-ai-state={artifact.aiState}
      data-context-state={contextSelected ? "selected" : selected ? "focused" : "normal"}
    >
      {selectionMode ? <button type="button" onClick={(event) => { event.stopPropagation(); onToggleContext?.(); }} className={`absolute right-2.5 top-2.5 z-20 flex h-6 w-6 items-center justify-center rounded-[6px] border transition-all duration-200 ${contextSelected ? "scale-100 border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-primary)]" : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-transparent hover:border-[var(--text-primary)]"}`} aria-label={contextSelected ? "Remove from selection" : "Add to selection"}><Check className="h-3.5 w-3.5" /></button> : null}
      <div className="relative z-[1] flex items-start gap-3">
        <CardTypeIcon icon={Icon} color={meta.color} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 pr-5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{meta.label}</span>
            <span className="text-[10px] text-[var(--text-tertiary)]">•</span>
            <span className="min-w-0 truncate text-[11px] text-[var(--text-tertiary)]">{artifact.meta}</span>
          </div>
          {interactive ? <button type="button" onClick={(event) => { event.stopPropagation(); if (selectionMode && onToggleContext) onToggleContext(); else onSelect?.(); }} className={cn("mt-2 block max-w-full rounded-[4px] text-left text-[var(--text-primary)] outline-none hover:text-[var(--accent-cyan)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--accent-cyan)_35%,transparent)]", size === "large" ? "max-w-[14rem] text-[20px] font-semibold leading-[1.12] font-display" : "truncate text-[14px] font-semibold")}>{artifact.title}</button> : <h3 className={cn("mt-2 text-[var(--text-primary)]", size === "large" ? "max-w-[14rem] text-[20px] font-semibold leading-[1.12] font-display" : "truncate text-[14px] font-semibold")}>{artifact.title}</h3>}
          <p className={cn("mt-2 text-[12px] leading-5 text-[var(--text-secondary)]", size === "large" ? "line-clamp-3 max-w-[16rem]" : "line-clamp-2")}>{artifact.summary}</p>
          {artifact.aiState === "creating" && typeof artifact.aiProgress === "number" ? <div className="mt-3 h-1 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-secondary))]" role="progressbar" aria-label={`Creating ${artifact.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(artifact.aiProgress * 100)}><span className="block h-full rounded-full bg-[var(--accent-cyan)] transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${Math.max(4, artifact.aiProgress * 100)}%` }} /></div> : null}
          {metrics.length > 0 ? (
            <div className="mt-5 grid grid-cols-3 gap-2">
              {metrics.slice(0, 3).map(([label, value]) => (
                <div key={label} className="border-l border-[var(--card-border-soft)] px-2 py-0.5 first:border-l-0 first:pl-0">
                  <div className="text-[12px] font-semibold text-[var(--text-primary)]">{value}</div>
                  <div className="text-[9px] text-[var(--text-tertiary)]">{label}</div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex min-h-7 items-end justify-between gap-2">
            <div className="min-w-0 truncate text-[11px] text-[var(--text-tertiary)]">{artifact.placement === "workspace" ? "In workspace" : "Unplaced"}</div>
            {actions ? <div className="flex shrink-0 items-center gap-1.5" onClick={(event) => event.stopPropagation()}>{actions}</div> : null}
          </div>
        </div>
      </div>
    </SpectraCard>
  );
}
