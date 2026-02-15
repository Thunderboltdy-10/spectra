"use client";

import { CheckCircle2, LoaderCircle, Sparkles, XCircle, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ActiveCollaborator = {
  role: string;
  status: "pending" | "running" | "done" | "failed";
  model?: string;
  preview?: string;
  tokensUsed?: number;
};

type CollaboratorsLiveProps = {
  collaborators: ActiveCollaborator[];
  phase: "idle" | "running" | "synthesizing";
};

function roleLabel(value: string) {
  return value.replace(/_/g, " ");
}

function sanitizeModelLabel(value: string) {
  return value
    .replace(/:free$/i, "")
    .replace(/[\s(_-]*\bfree\b[\s)_-]*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function formatTokens(value: number) {
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function StatusDot({ status }: { status: ActiveCollaborator["status"] }) {
  if (status === "done") return <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />;
  if (status === "failed") return <XCircle className="h-3.5 w-3.5 text-[var(--danger)]" />;
  if (status === "running") return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[var(--accent-cyan)]" />;
  return <Circle className="h-3.5 w-3.5 text-[var(--text-secondary)] opacity-40" />;
}

export function CollaboratorsLive({ collaborators, phase }: CollaboratorsLiveProps) {
  if (collaborators.length === 0) return null;
  const totalTokens = collaborators.reduce((sum, item) => sum + (item.tokensUsed ?? 0), 0);
  const doneCount = collaborators.filter((c) => c.status === "done").length;
  // Sort: done first, running middle, pending bottom
  const ordered = [...collaborators].sort((a, b) => {
    const rank = (status: ActiveCollaborator["status"]) => {
      if (status === "done") return 0;
      if (status === "running") return 1;
      if (status === "pending") return 2;
      return 3;
    };
    return rank(a.status) - rank(b.status);
  });

  return (
    <section className="mb-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2.5 lg:fixed lg:right-6 lg:top-24 lg:z-30 lg:w-[340px] lg:max-h-[70vh] lg:overflow-y-auto">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            Orchestrator
          </p>
          <span className="rounded-full bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--text-secondary)]">
            {doneCount}/{collaborators.length}
          </span>
        </div>
        <p className="text-[11px] text-[var(--text-secondary)]">
          {phase === "synthesizing" ? "Synthesizing..." : "Running"}
          {totalTokens > 0 ? ` • ${formatTokens(totalTokens)} tok` : ""}
        </p>
      </div>

      {/* Connecting line from orchestrator */}
      <div className="relative pl-4">
        <div className="absolute left-[7px] top-0 bottom-0 w-px bg-[var(--border-default)]" />

        <ol className="space-y-1.5">
          {ordered.map((agent) => (
            <li
              key={agent.role}
              className={cn(
                "relative rounded-xl border px-2.5 py-2 transition-all duration-300",
                agent.status === "done" && "border-[color-mix(in_oklab,var(--success)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_6%,transparent)]",
                agent.status === "failed" && "border-[color-mix(in_oklab,var(--danger)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_6%,transparent)]",
                agent.status === "running" && "border-[color-mix(in_oklab,var(--accent-cyan)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_6%,transparent)]",
                agent.status === "pending" && "border-[var(--border-default)] bg-[var(--bg-secondary)] opacity-60",
              )}
            >
              {/* Horizontal connecting line */}
              <div className="absolute -left-4 top-1/2 w-3 border-t border-[var(--border-default)]" />

              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 text-xs">
                  <StatusDot status={agent.status} />
                  <span className="font-medium capitalize text-[var(--text-primary)]">{roleLabel(agent.role)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {agent.model ? (
                    <span className="rounded-full bg-[var(--bg-secondary)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--text-secondary)]">
                      {sanitizeModelLabel(agent.model).split("/").pop()}
                    </span>
                  ) : null}
                  {typeof agent.tokensUsed === "number" && agent.tokensUsed > 0 ? (
                    <span className="rounded-full bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9px] text-[var(--text-secondary)]">
                      {formatTokens(agent.tokensUsed)}
                    </span>
                  ) : null}
                </div>
              </div>
              {agent.status === "running" && agent.preview ? (
                <p className="mt-1 truncate text-[11px] text-[var(--text-secondary)]">
                  {agent.preview.slice(0, 80)}...
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>

      {phase === "synthesizing" ? (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-[color-mix(in_oklab,var(--accent-cyan)_30%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_8%,transparent)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]">
          <Sparkles className="h-3.5 w-3.5 animate-pulse text-[var(--accent-cyan)]" />
          Synthesizing final answer from specialist findings
        </div>
      ) : null}
    </section>
  );
}
