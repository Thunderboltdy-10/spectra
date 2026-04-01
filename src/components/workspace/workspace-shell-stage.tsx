"use client";

import { motion } from "framer-motion";
import { CalendarClock, FileText, MessageSquare, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkspaceShellMode } from "@/lib/workspace/shell-mode";

export type WorkspaceStageItem = {
  id: string;
  title: string;
  meta?: string;
  statusColor?: string;
};

export type WorkspaceStageContent = {
  threads: WorkspaceStageItem[];
  notes: WorkspaceStageItem[];
  plannerItems: WorkspaceStageItem[];
  artifacts: WorkspaceStageItem[];
};

type WorkspaceShellStageProps = {
  shellMode: WorkspaceShellMode;
  title: string;
  emoji?: string;
  content: WorkspaceStageContent;
  onOpenThread: (id: string) => void;
  onOpenDocument: (id: string) => void;
  onOpenPlanner: (id: string) => void;
  onOpenArtifact: (id: string) => void;
};

export function WorkspaceShellStage(props: WorkspaceShellStageProps) {
  switch (props.shellMode) {
    case "constellations":
      return <ConstellationsStage {...props} />;
    case "lenses":
      return <LensesStage {...props} />;
    case "magnetic":
    default:
      return <MagneticStage {...props} />;
  }
}

function ConstellationsStage({
  title,
  emoji,
  content,
  onOpenThread,
  onOpenDocument,
  onOpenPlanner,
  onOpenArtifact,
}: WorkspaceShellStageProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(14,142,232,0.12),transparent_26%),radial-gradient(circle_at_82%_24%,rgba(32,184,178,0.10),transparent_22%),radial-gradient(circle_at_52%_72%,rgba(255,255,255,0.05),transparent_28%)]" />
      <div className="relative mx-auto grid h-full max-w-[1320px] grid-cols-12 grid-rows-6 px-8 py-16">
        <section className="pointer-events-auto col-span-4 col-start-1 row-start-1 mt-8">
          <ConstellationField
            label="Frequencies"
            items={content.threads}
            glow="rgba(14,142,232,0.28)"
            onSelect={onOpenThread}
          />
        </section>

        <section className="pointer-events-auto col-span-4 col-start-9 row-start-2">
          <ConstellationField
            label="Fragments"
            items={content.notes}
            glow="rgba(167,139,250,0.26)"
            align="right"
            onSelect={onOpenDocument}
          />
        </section>

        <section className="pointer-events-auto col-span-6 col-start-4 row-start-3 flex flex-col items-center justify-center text-center">
          <div className="relative">
            <div className="absolute -inset-10 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.12),transparent_70%)] blur-3xl" />
            <div className="relative text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--text-tertiary)]">
              constellation
            </div>
            <h2 className="relative mt-3 font-display text-5xl text-[var(--text-primary)]">
              {emoji ? `${emoji} ` : ""}
              {title}
            </h2>
            <p className="relative mt-4 max-w-[28rem] text-sm leading-7 text-[var(--text-secondary)]">
              Relationships, references, and active materials gather as one spatial field.
            </p>
          </div>
        </section>

        <section className="pointer-events-auto col-span-3 col-start-2 row-start-5">
          <ConstellationField
            label="Trajectories"
            items={content.plannerItems}
            glow="rgba(255,111,69,0.22)"
            onSelect={onOpenPlanner}
            showStatus
          />
        </section>

        <section className="pointer-events-auto col-span-4 col-start-8 row-start-5">
          <ConstellationField
            label="Constructs"
            items={content.artifacts}
            glow="rgba(32,184,178,0.24)"
            onSelect={onOpenArtifact}
          />
        </section>
      </div>
    </motion.div>
  );
}

function ConstellationField({
  label,
  items,
  glow,
  onSelect,
  align = "left",
  showStatus = false,
}: {
  label: string;
  items: WorkspaceStageItem[];
  glow: string;
  onSelect: (id: string) => void;
  align?: "left" | "right";
  showStatus?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className={cn("relative flex max-w-[20rem] flex-col gap-3", align === "right" && "ml-auto items-end text-right")}>
      <div
        className="pointer-events-none absolute -inset-8 -z-10 rounded-full blur-3xl"
        style={{ background: `radial-gradient(circle, ${glow} 0%, transparent 72%)` }}
      />
      <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className="space-y-2">
        {items.slice(0, 6).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={cn(
              "group flex w-full items-start gap-3 text-left transition-all duration-200",
              align === "right" && "justify-end text-right",
            )}
          >
            {showStatus && (
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full shadow-[0_0_10px_currentColor]"
                style={{ color: item.statusColor ?? "var(--text-tertiary)", backgroundColor: item.statusColor ?? "var(--text-tertiary)" }}
              />
            )}
            <div>
              <div className="text-[1rem] font-medium text-[var(--text-primary)]/72 transition-colors group-hover:text-[var(--text-primary)]">
                {item.title}
              </div>
              {item.meta && <div className="text-[11px] text-[var(--text-tertiary)]/90">{item.meta}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function MagneticStage({
  title,
  emoji,
  content,
  onOpenThread,
  onOpenDocument,
  onOpenPlanner,
  onOpenArtifact,
}: WorkspaceShellStageProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="pointer-events-none absolute inset-0 z-20 overflow-y-auto px-8 py-16"
    >
      <div className="mx-auto max-w-[1380px]">
        <header className="pointer-events-auto mb-10 flex items-end justify-between gap-6">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
              active field
            </div>
            <h2 className="mt-2 font-display text-4xl text-[var(--text-primary)]">
              {emoji ? `${emoji} ` : ""}
              {title}
            </h2>
          </div>
          <div className="max-w-[22rem] text-sm leading-7 text-[var(--text-secondary)]">
            Practical work surface with lanes for discussion, documents, planning, and outputs.
          </div>
        </header>

        <div className="grid grid-cols-12 gap-8">
          <div className="pointer-events-auto col-span-3">
            <MagneticZone title="Planner">
              {content.plannerItems.slice(0, 6).map((item) => (
                <MagneticStrip
                  key={item.id}
                  title={item.title}
                  meta={item.meta}
                  accent={item.statusColor}
                  onClick={() => onOpenPlanner(item.id)}
                />
              ))}
            </MagneticZone>
            <MagneticZone title="Documents" className="mt-6">
              {content.notes.slice(0, 6).map((item) => (
                <MagneticStrip key={item.id} title={item.title} meta={item.meta} onClick={() => onOpenDocument(item.id)} />
              ))}
            </MagneticZone>
          </div>

          <div className="pointer-events-auto col-span-5">
            <MagneticZone title="Threads" dense>
              {content.threads.slice(0, 8).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenThread(item.id)}
                  className="group flex w-full flex-col rounded-[18px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-3 text-left shadow-[0_12px_26px_-24px_rgba(15,23,42,0.35)] transition-all hover:-translate-y-0.5 hover:border-[var(--accent-cyan)]/30"
                >
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-base font-medium text-[var(--text-primary)]">{item.title}</span>
                    <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
                  </div>
                  {item.meta && <span className="mt-1 text-[12px] text-[var(--text-secondary)]">{item.meta}</span>}
                </button>
              ))}
            </MagneticZone>
          </div>

          <div className="pointer-events-auto col-span-4">
            <MagneticZone title="Artifacts">
              {content.artifacts.slice(0, 6).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenArtifact(item.id)}
                  className="group flex w-full items-start gap-3 rounded-[18px] border border-[var(--border-default)]/70 bg-[var(--bg-elevated)]/72 px-4 py-3 text-left transition-colors hover:border-[var(--accent-cyan)]/28 hover:bg-[var(--bg-elevated)]"
                >
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-secondary)] text-[var(--text-tertiary)]">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--text-primary)]">{item.title}</div>
                    {item.meta && <div className="mt-1 text-[12px] text-[var(--text-secondary)]">{item.meta}</div>}
                  </div>
                </button>
              ))}
            </MagneticZone>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function MagneticZone({
  title,
  children,
  className,
  dense = false,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  dense?: boolean;
}) {
  return (
    <section className={cn(className)}>
      <div className="border-b border-[var(--border-default)]/60 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
        {title}
      </div>
      <div className={cn("mt-4 flex flex-col", dense ? "gap-3" : "gap-2")}>{children}</div>
    </section>
  );
}

function MagneticStrip({
  title,
  meta,
  onClick,
  accent,
}: {
  title: string;
  meta?: string;
  onClick: () => void;
  accent?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-elevated)]/78"
    >
      {accent && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: accent }} />}
      {!accent && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--border-default)]" />}
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-[var(--text-primary)]">{title}</div>
        {meta && <div className="mt-0.5 text-[12px] text-[var(--text-secondary)]">{meta}</div>}
      </div>
    </button>
  );
}

function LensesStage({
  title,
  emoji,
  content,
  onOpenThread,
  onOpenDocument,
  onOpenPlanner,
  onOpenArtifact,
}: WorkspaceShellStageProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="pointer-events-none absolute inset-0 z-20 overflow-y-auto px-8 py-12"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(14,142,232,0.18),transparent_24%),radial-gradient(circle_at_80%_80%,rgba(32,184,178,0.12),transparent_24%),radial-gradient(circle_at_center,rgba(255,255,255,0.06),transparent_42%)]" />
      <div className="relative mx-auto grid max-w-[1440px] grid-cols-[280px_minmax(0,1fr)_300px] gap-6">
        <LensRail title="Directives" icon={<CalendarClock className="h-4 w-4" />}>
          {content.plannerItems.slice(0, 5).map((item) => (
            <LensItem key={item.id} title={item.title} meta={item.meta} accent={item.statusColor} onClick={() => onOpenPlanner(item.id)} />
          ))}
          {content.notes.slice(0, 4).map((item) => (
            <LensItem key={item.id} title={item.title} meta={item.meta} icon={<FileText className="h-3.5 w-3.5" />} onClick={() => onOpenDocument(item.id)} />
          ))}
        </LensRail>

        <div className="pointer-events-auto rounded-[36px] border border-white/12 bg-[rgba(255,255,255,0.08)] px-6 py-7 shadow-[0_24px_80px_-42px_rgba(15,23,42,0.65)] backdrop-blur-2xl">
          <div className="mx-auto max-w-[44rem] text-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
              focal lens
            </div>
            <h2 className="mt-3 font-display text-4xl text-[var(--text-primary)]">
              {emoji ? `${emoji} ` : ""}
              {title}
            </h2>
            <p className="mx-auto mt-4 max-w-[32rem] text-sm leading-7 text-[var(--text-secondary)]">
              The active materials sharpen at center while surrounding tools stay close but optically softer.
            </p>
          </div>

          <div className="mt-8 space-y-4">
            {content.threads.slice(0, 7).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenThread(item.id)}
                className="flex w-full items-start justify-between gap-4 rounded-[24px] border border-white/10 bg-[rgba(255,255,255,0.10)] px-5 py-4 text-left backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:bg-[rgba(255,255,255,0.14)]"
              >
                <div className="min-w-0">
                  <div className="truncate text-base font-medium text-[var(--text-primary)]">{item.title}</div>
                  {item.meta && <div className="mt-1 text-[12px] text-[var(--text-secondary)]">{item.meta}</div>}
                </div>
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
              </button>
            ))}
          </div>
        </div>

        <LensRail title="Outputs" icon={<Sparkles className="h-4 w-4" />}>
          {content.artifacts.slice(0, 5).map((item) => (
            <LensItem key={item.id} title={item.title} meta={item.meta} onClick={() => onOpenArtifact(item.id)} />
          ))}
        </LensRail>
      </div>
    </motion.div>
  );
}

function LensRail({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <aside className="pointer-events-auto rounded-[28px] border border-white/10 bg-[rgba(255,255,255,0.07)] px-4 py-5 shadow-[0_18px_54px_-40px_rgba(15,23,42,0.55)] backdrop-blur-xl">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
        {icon}
        {title}
      </div>
      <div className="mt-4 space-y-2">{children}</div>
    </aside>
  );
}

function LensItem({
  title,
  meta,
  onClick,
  icon,
  accent,
}: {
  title: string;
  meta?: string;
  onClick: () => void;
  icon?: React.ReactNode;
  accent?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-[18px] border border-white/8 bg-[rgba(255,255,255,0.06)] px-3 py-3 text-left transition-colors hover:bg-[rgba(255,255,255,0.10)]"
    >
      {accent ? (
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
      ) : (
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgba(255,255,255,0.08)] text-[var(--text-tertiary)]">
          {icon ?? <Sparkles className="h-3.5 w-3.5" />}
        </span>
      )}
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-[var(--text-primary)]">{title}</div>
        {meta && <div className="mt-0.5 text-[12px] text-[var(--text-secondary)]">{meta}</div>}
      </div>
    </button>
  );
}
