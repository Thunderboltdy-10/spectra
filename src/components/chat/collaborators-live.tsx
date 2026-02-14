"use client";

import { CheckCircle2, LoaderCircle, Sparkles, XCircle } from "lucide-react";
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

export function CollaboratorsLive({ collaborators, phase }: CollaboratorsLiveProps) {
  if (collaborators.length === 0) return null;

  return (
    <section className="mb-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
          Collaborators
        </p>
        <p className="text-[11px] text-[var(--text-secondary)]">
          {phase === "synthesizing" ? "Synthesizing final answer..." : "Parallel specialist pass"}
        </p>
      </div>

      <ol className="space-y-2">
        {collaborators.map((agent) => (
          <li
            key={agent.role}
            className={cn(
              "rounded-xl border px-2.5 py-2 transition",
              agent.status === "done" && "border-[color-mix(in_oklab,var(--success)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_9%,transparent)]",
              agent.status === "failed" && "border-[color-mix(in_oklab,var(--danger)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_9%,transparent)]",
              agent.status !== "done" && agent.status !== "failed" && "border-[var(--border-default)] bg-[var(--bg-secondary)]",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-xs">
                {agent.status === "done" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />
                ) : agent.status === "failed" ? (
                  <XCircle className="h-3.5 w-3.5 text-[var(--danger)]" />
                ) : (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[var(--accent-cyan)]" />
                )}
                <span className="font-medium capitalize text-[var(--text-primary)]">{roleLabel(agent.role)}</span>
              </div>
              <span className="text-[11px] text-[var(--text-secondary)]">
                {typeof agent.tokensUsed === "number" && agent.tokensUsed > 0
                  ? `${agent.tokensUsed} tokens`
                  : agent.status}
              </span>
            </div>
            {agent.preview ? (
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                {agent.preview}
              </p>
            ) : null}
            {agent.model ? (
              <p className="mt-0.5 font-mono text-[10px] text-[var(--text-secondary)]">{agent.model}</p>
            ) : null}
          </li>
        ))}
      </ol>

      {phase === "synthesizing" ? (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <Sparkles className="h-3.5 w-3.5" />
          Combining specialist findings into one coherent answer.
        </p>
      ) : null}
    </section>
  );
}
