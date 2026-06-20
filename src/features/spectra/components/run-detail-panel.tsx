"use client";

import { AlertCircle, ArrowUpRight, CheckCircle2, Clock3, Loader2, Pin, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getSpectraRunDetail, type SpectraOperation, type SpectraRunDetail } from "../data/api";
import type { ResultCardStreamView } from "../ai/stream-events";

function operationSummary(operation: SpectraOperation) {
  const input = operation.input && typeof operation.input === "object" ? operation.input as Record<string, unknown> : {};
  if (operation.type === "artifact.create") {
    const content = input.content && typeof input.content === "object" ? input.content as Record<string, unknown> : {};
    const count = Array.isArray(content.cards) ? `${content.cards.length} cards` : Array.isArray(content.questions) ? `${content.questions.length} questions` : Array.isArray(content.blocks) ? `${content.blocks.length} blocks` : null;
    return `${String(input.title ?? "New artifact")}${count ? ` · ${count}` : ""}`;
  }
  if (operation.type === "artifact.update") return `Update ${String(input.artifactId ?? "artifact")}`;
  if (operation.type === "workspaceItem.add") return "Add artifact to workspace";
  if (operation.type === "workspaceItem.hide") return "Remove requested workspace placement";
  if (operation.type === "workspace.create") return `Create ${String(input.title ?? "workspace")}`;
  return operation.type;
}

function statusIcon(status: ResultCardStreamView["status"]) {
  if (status === "running" || status === "queued") return <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-cyan)]" />;
  if (status === "awaiting_confirmation") return <ShieldCheck className="h-4 w-4 text-amber-600" />;
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />;
  if (status === "failed") return <AlertCircle className="h-4 w-4 text-[var(--danger)]" />;
  return <Clock3 className="h-4 w-4 text-[var(--text-tertiary)]" />;
}

export function RunDetailPanel({
  runId,
  card,
  onClose,
  onAction,
}: {
  runId: string;
  card: ResultCardStreamView;
  onClose: () => void;
  onAction: (card: ResultCardStreamView, actionKey: string, targetId?: string) => void;
}) {
  const [detail, setDetail] = useState<SpectraRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setError(null);
    void getSpectraRunDetail(runId)
      .then((value) => { if (active) setDetail(value); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load run details."); });
    return () => { active = false; };
  }, [runId, card.updatedAt]);

  const affected = useMemo(() => {
    const values = detail?.operations.flatMap((operation) => operation.affected ?? []) ?? [];
    return [...new Map(values.map((item) => [`${item.type}:${item.id}`, item])).values()];
  }, [detail]);

  return (
    <aside className="absolute inset-y-0 right-0 z-50 flex w-[min(390px,92vw)] flex-col border-l border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-primary)_97%,var(--bg-elevated))] shadow-[-14px_0_36px_rgba(22,18,13,0.10)]" aria-label="Run details">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-4">
        <div className="flex items-center gap-2.5">
          {statusIcon(card.status)}
          <div>
            <div className="text-[13px] font-semibold text-[var(--text-primary)]">Run details</div>
            <div className="text-[11px] capitalize text-[var(--text-tertiary)]">{card.status.replaceAll("_", " ")}</div>
          </div>
        </div>
        <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" aria-label="Close run details"><X className="h-4 w-4" /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!detail && !error ? <div className="flex items-center gap-2 py-8 text-[12px] text-[var(--text-secondary)]"><Loader2 className="h-4 w-4 animate-spin" />Loading run…</div> : null}
        {error ? <div className="rounded-[8px] border border-[color-mix(in_oklab,var(--danger)_30%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_7%,transparent)] p-3 text-[12px] text-[var(--danger)]">{error}</div> : null}
        {detail ? (
          <div className="space-y-5">
            <section>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--text-tertiary)]">Prompt</div>
              <p className="text-[13px] leading-5 text-[var(--text-primary)]">{detail.run.userPrompt}</p>
              {detail.run.attemptCount && detail.run.attemptCount > 1 ? <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">Attempt {detail.run.attemptCount}</p> : null}
            </section>

            <section className="rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
              <div className="text-[12px] font-semibold text-[var(--text-primary)]">{card.title}</div>
              {card.summary ? <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">{card.summary}</p> : null}
              {detail.run.error ? <p className="mt-2 rounded-[6px] bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] px-2.5 py-2 text-[11px] leading-4 text-[var(--danger)]">{detail.run.error}</p> : null}
            </section>

            <section>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--text-tertiary)]">Operations</div>
              {detail.operations.length === 0 ? <p className="text-[12px] text-[var(--text-secondary)]">Answer only — no data changes.</p> : (
                <div className="overflow-hidden rounded-[8px] border border-[var(--border-default)]">
                  {detail.operations.map((operation) => (
                    <div key={operation._id} className="flex items-start gap-2 border-b border-[var(--border-subtle)] px-3 py-2.5 last:border-b-0">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-tertiary)]" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium text-[var(--text-primary)]">{operationSummary(operation)}</div>
                        <div className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">{operation.type} · {operation.status}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--text-tertiary)]">Affected objects</div>
              {affected.length === 0 ? <p className="text-[12px] text-[var(--text-secondary)]">No objects changed.</p> : (
                <div className="space-y-1.5">
                  {affected.map((item) => <div key={`${item.type}:${item.id}`} className="flex items-center justify-between rounded-[7px] border border-[var(--border-default)] px-3 py-2 text-[11px]"><span className="capitalize text-[var(--text-secondary)]">{item.type}</span><span className="max-w-[210px] truncate font-mono text-[10px] text-[var(--text-tertiary)]">{item.id}</span></div>)}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>

      <footer className="shrink-0 border-t border-[var(--border-subtle)] p-3">
        <div className="grid grid-cols-2 gap-2">
          {card.actions.map((action) => (
            <button key={action.key} type="button" onClick={() => onAction(card, action.key, action.targetId)} className="flex h-9 items-center justify-center gap-2 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
              {action.key === "retry" ? <RotateCcw className="h-3.5 w-3.5" /> : action.key === "confirm" ? <ShieldCheck className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}{action.label}
            </button>
          ))}
          <button type="button" onClick={() => onAction(card, "keep")} className="flex h-9 items-center justify-center gap-2 rounded-[7px] border border-[var(--border-default)] text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><Pin className="h-3.5 w-3.5" />Keep in activity</button>
          <button type="button" onClick={() => onAction(card, "hide")} className="flex h-9 items-center justify-center gap-2 rounded-[7px] border border-[var(--border-default)] text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><X className="h-3.5 w-3.5" />Hide</button>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-[var(--text-tertiary)]">Runs remain in history. Persistent thread conversion is deferred to Wave 5.</p>
      </footer>
    </aside>
  );
}
