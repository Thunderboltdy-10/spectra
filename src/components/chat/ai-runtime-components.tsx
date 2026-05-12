"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, FileText, Hammer, HelpCircle, Layers3, RefreshCw, Users } from "lucide-react";
import { ExecutionTimeline, type ExecutionEvent } from "@/components/shared/execution-timeline";
import { ModelRoutingBadge } from "@/components/chat/model-routing-badge";
import { cn } from "@/lib/utils";
import type { RouteTrace } from "@/types";
import type React from "react";

type RuntimeCardState = "running" | "done" | "failed" | "pending";

const stateStyles: Record<RuntimeCardState, string> = {
  running: "border-[color-mix(in_oklab,var(--accent-cyan)_36%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-secondary))]",
  done: "border-[color-mix(in_oklab,var(--success)_26%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_5%,var(--bg-secondary))]",
  failed: "border-[color-mix(in_oklab,var(--danger)_32%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-secondary))]",
  pending: "border-[var(--border-default)] bg-[var(--bg-secondary)]",
};

function RuntimeCard({
  icon,
  title,
  detail,
  state = "pending",
  children,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: string;
  state?: RuntimeCardState;
  children?: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-2xl border p-3 shadow-[0_18px_50px_-34px_var(--text-primary)]", stateStyles[state])}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-secondary)]">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</p>
            <RuntimeStatusDot state={state} />
          </div>
          {detail ? <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{detail}</p> : null}
          {children ? <div className="mt-3">{children}</div> : null}
        </div>
      </div>
    </section>
  );
}

function RuntimeStatusDot({ state }: { state: RuntimeCardState }) {
  if (state === "done") return <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />;
  if (state === "failed") return <AlertTriangle className="h-3.5 w-3.5 text-[var(--danger)]" />;
  if (state === "running") return <RefreshCw className="h-3.5 w-3.5 animate-spin text-[var(--accent-cyan)]" />;
  return <CircleDashed className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />;
}

export function AiRunHeader({ modelUsed, routeTrace }: { modelUsed?: string; routeTrace?: RouteTrace }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-[var(--border-default)] bg-[linear-gradient(135deg,color-mix(in_oklab,var(--bg-secondary)_92%,transparent),color-mix(in_oklab,var(--accent-cyan)_5%,var(--bg-primary)))] px-3 py-2">
      <AiModelBadge modelUsed={modelUsed} routeTrace={routeTrace} />
      <span className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">AI run</span>
    </div>
  );
}

export function AiModelBadge(props: React.ComponentProps<typeof ModelRoutingBadge>) {
  return <ModelRoutingBadge {...props} />;
}

export function WhyThisModelPopover({ reason }: { reason?: string }) {
  if (!reason) return null;
  return (
    <details className="group rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
      <summary className="cursor-pointer list-none text-xs font-semibold text-[var(--text-primary)] [&::-webkit-details-marker]:hidden">
        Why this model
      </summary>
      <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">{reason}</p>
    </details>
  );
}

export function AiRunTimeline(props: { events?: ExecutionEvent[]; routeTrace?: RouteTrace; streaming?: boolean; compact?: boolean }) {
  return <ExecutionTimeline {...props} className="runtime-timeline" />;
}

export function AiRunEventGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">{title}</p>
      {children}
    </div>
  );
}

export function ToolCallCard({ title, detail, state }: { title: string; detail?: string; state?: RuntimeCardState }) {
  return <RuntimeCard icon={<Hammer className="h-4 w-4" />} title={title} detail={detail} state={state} />;
}

export function WorkerCard({ title, detail, state }: { title: string; detail?: string; state?: RuntimeCardState }) {
  return <RuntimeCard icon={<Users className="h-4 w-4" />} title={title} detail={detail} state={state} />;
}

export function ClarificationInlineCard({ title, detail, children }: { title: string; detail?: string; children?: React.ReactNode }) {
  return <RuntimeCard icon={<HelpCircle className="h-4 w-4" />} title={title} detail={detail} state="running">{children}</RuntimeCard>;
}

export function ResourceStatusCard({ title, detail, state }: { title: string; detail?: string; state?: RuntimeCardState }) {
  return <RuntimeCard icon={<FileText className="h-4 w-4" />} title={title} detail={detail} state={state} />;
}

export function ArtifactOperationCard({ title, detail, state }: { title: string; detail?: string; state?: RuntimeCardState }) {
  return <RuntimeCard icon={<Layers3 className="h-4 w-4" />} title={title} detail={detail} state={state} />;
}

export const WorkspaceMutationCard = ArtifactOperationCard;

export function RuntimeErrorCard({ title, detail }: { title: string; detail?: string }) {
  return <RuntimeCard icon={<AlertTriangle className="h-4 w-4" />} title={title} detail={detail} state="failed" />;
}
