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
  updatedAt?: number;
  pinned?: boolean;
  variant?: string;
  metrics?: Record<string, string | number>;
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
}: {
  artifact: ArtifactCardView;
  selected?: boolean;
  actions?: ReactNode;
  onSelect?: () => void;
  className?: string;
  size?: "compact" | "normal" | "large";
  quiet?: boolean;
}) {
  const meta = blueprintMeta[artifact.blueprintKey];
  const Icon = meta.icon;
  const interactive = Boolean(onSelect);
  const metrics = Object.entries(artifact.metrics ?? {}).slice(0, size === "compact" ? 0 : 4);
  const botanical = artifact.variant === "botanical" || artifact.variant === "flower";

  return (
    <article
      className={cn(
        "relative overflow-hidden border bg-[var(--bg-elevated)] text-left transition-colors duration-150",
        size === "large" ? "min-h-[216px] rounded-[9px] p-4" : "rounded-[8px] p-3.5",
        selected
          ? "border-[#8b6ff0] bg-[color-mix(in_oklab,#8b6ff0_4%,var(--bg-elevated))] shadow-[0_2px_8px_rgba(68,45,123,0.10)]"
          : "border-[var(--border-default)] hover:border-[color-mix(in_oklab,var(--text-tertiary)_36%,var(--border-default))]",
        interactive ? "cursor-pointer" : "",
        quiet ? "shadow-none" : "shadow-[0_1px_2px_rgba(27,20,12,0.03)]",
        className,
      )}
      style={botanical ? {
        background: `
          radial-gradient(circle at 84% 54%, color-mix(in oklab, ${meta.color} 16%, transparent) 0 24%, transparent 25%),
          radial-gradient(circle at 92% 18%, color-mix(in oklab, ${meta.color} 10%, transparent) 0 18%, transparent 19%),
          linear-gradient(110deg, ${meta.soft}, var(--bg-elevated) 58%)
        `,
      } : undefined}
      onClick={onSelect}
    >
      {botanical ? (
        <div className="pointer-events-none absolute -right-5 bottom-0 h-[72%] w-[38%] opacity-70">
          <div className="absolute bottom-4 left-1/2 h-[88%] w-px -rotate-12" style={{ background: `color-mix(in oklab, ${meta.color} 35%, transparent)` }} />
          {[0, 1, 2, 3, 4].map((leaf) => (
            <span
              key={leaf}
              className="absolute h-10 w-5 rounded-[100%_0_100%_0] blur-[0.1px]"
              style={{
                right: `${18 + (leaf % 2) * 18}px`,
                bottom: `${20 + leaf * 25}px`,
                transform: `rotate(${leaf % 2 ? -36 : 26}deg)`,
                background: `color-mix(in oklab, ${meta.color} 34%, transparent)`,
              }}
            />
          ))}
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-0 opacity-[0.22] [background-image:radial-gradient(color-mix(in_oklab,var(--text-primary)_18%,transparent)_0.45px,transparent_0.45px)] [background-size:7px_7px]" />
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] border border-[color-mix(in_oklab,currentColor_24%,transparent)] bg-[color-mix(in_oklab,currentColor_9%,var(--bg-elevated))]" style={{ color: meta.color }}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 pr-5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{meta.label}</span>
            <span className="text-[10px] text-[var(--text-tertiary)]">•</span>
            <span className="min-w-0 truncate text-[11px] text-[var(--text-tertiary)]">{artifact.meta}</span>
          </div>
          <h3 className={cn("mt-2 text-[var(--text-primary)]", size === "large" ? "max-w-[14rem] text-[20px] font-semibold leading-[1.12] font-display" : "truncate text-[14px] font-semibold")}>{artifact.title}</h3>
          <p className={cn("mt-2 text-[12px] leading-5 text-[var(--text-secondary)]", size === "large" ? "line-clamp-3 max-w-[16rem]" : "line-clamp-2")}>{artifact.summary}</p>
          {metrics.length > 0 ? (
            <div className="mt-5 grid grid-cols-3 gap-2">
              {metrics.slice(0, 3).map(([label, value]) => (
                <div key={label} className="rounded-[7px] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_72%,transparent)] px-2 py-1.5 text-center">
                  <div className="text-[12px] font-semibold text-[var(--text-primary)]">{value}</div>
                  <div className="text-[9px] text-[var(--text-tertiary)]">{label}</div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex min-h-7 items-end justify-between gap-2">
            <div className="min-w-0 truncate text-[11px] text-[var(--text-tertiary)]">{artifact.placement === "workspace" ? "In workspace" : "Inbox"}</div>
            {actions ? <div className="flex shrink-0 items-center gap-1.5" onClick={(event) => event.stopPropagation()}>{actions}</div> : null}
          </div>
        </div>
      </div>
    </article>
  );
}
