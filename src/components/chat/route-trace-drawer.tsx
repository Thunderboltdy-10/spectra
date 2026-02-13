"use client";

import { X, CheckCircle2, XCircle, Timer, Milestone } from "lucide-react";
import type { RouteTrace } from "@/types";
import { Button } from "@/components/ui/button";

type RouteTraceDrawerProps = {
  open: boolean;
  onClose: () => void;
  trace?: RouteTrace;
};

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">{children}</p>;
}

function Value({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[var(--text-primary)]">{children}</p>;
}

function InputRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2.5">
      <Label>{label}</Label>
      <Value>{value}</Value>
    </div>
  );
}

function formatMs(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.max(0, Math.round(value))} ms`;
}

function formatScore(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

export function RouteTraceDrawer({ open, onClose, trace }: RouteTraceDrawerProps) {
  if (!open || !trace) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-black/35"
        onClick={onClose}
        aria-label="Close route trace"
      />

      <aside className="absolute inset-y-0 right-0 w-[92vw] max-w-xl overflow-y-auto border-l border-[var(--border-default)] bg-[var(--bg-primary)] p-4 shadow-[var(--shadow-soft)]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Route Trace</p>
            <h3 className="font-display text-2xl text-[var(--text-primary)]">Model Decision Timeline</h3>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close route trace">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <section className="mb-5">
          <h4 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Inputs</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            <InputRow label="Mode" value={trace.inputs.mode} />
            <InputRow label="Tier" value={trace.inputs.spendingTier} />
            <InputRow label="Thinking" value={trace.inputs.thinkingLevel} />
            <InputRow label="Complex" value={trace.inputs.complexPrompt ? "Yes" : "No"} />
            <InputRow label="Prompt Category" value={trace.inputs.promptCategory} />
            <InputRow label="Enhanced" value={trace.inputs.promptEnhanced ? "Yes" : "No"} />
            <InputRow label="Attachments" value={`${trace.inputs.attachmentTypes.join(", ") || "none"}`} />
            <InputRow label="Message Length" value={trace.inputs.messageLength} />
          </div>
        </section>

        <section className="mb-5">
          <h4 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Candidates</h4>
          <div className="space-y-2">
            {trace.candidates.map((candidate, index) => (
              <div
                key={`${candidate.modelId}-${index}`}
                className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2.5"
              >
                <div className="flex items-center gap-2">
                  {candidate.allowed ? (
                    <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                  ) : (
                    <XCircle className="h-4 w-4 text-[var(--danger)]" />
                  )}
                  <span className="font-mono text-xs text-[var(--text-primary)]">{candidate.modelId}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Score: {formatScore(candidate.score)}
                </p>
                {candidate.reason && (
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">{candidate.reason}</p>
                )}
                {candidate.scoreBreakdown && candidate.scoreBreakdown.length > 0 && (
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {candidate.scoreBreakdown.join(" · ")}
                  </p>
                )}
                {!candidate.allowed && candidate.eliminatedBecause && (
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">{candidate.eliminatedBecause}</p>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="mb-5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
          <h4 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Selected</h4>
          <p className="font-mono text-xs text-[var(--text-primary)]">{trace.selected.modelId}</p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">{trace.selected.reason}</p>
        </section>

        <section className="mb-5">
          <h4 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Toolchain</h4>
          <div className="flex flex-wrap gap-2">
            {trace.toolchain.length > 0 ? (
              trace.toolchain.map((tool) => (
                <span
                  key={tool}
                  className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]"
                >
                  {tool}
                </span>
              ))
            ) : (
              <span className="text-xs text-[var(--text-secondary)]">No auxiliary tools used.</span>
            )}
          </div>
        </section>

        <section className="mb-5">
          <h4 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Fallbacks</h4>
          {trace.fallbacks.length === 0 ? (
            <p className="text-xs text-[var(--text-secondary)]">No model fallback required.</p>
          ) : (
            <ol className="space-y-2">
              {trace.fallbacks.map((fallback, index) => (
                <li
                  key={`${fallback.fromModel}-${fallback.toModel}-${index}`}
                  className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2.5"
                >
                  <div className="mb-1 flex items-center gap-2 text-xs text-[var(--text-primary)]">
                    <Milestone className="h-3.5 w-3.5" />
                    <span className="font-medium">Attempt {fallback.attemptIndex + 1}</span>
                  </div>
                  <p className="font-mono text-[11px] text-[var(--text-secondary)]">
                    {fallback.fromModel} → {fallback.toModel}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">{fallback.error}</p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
          <h4 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Timing</h4>
          <div className="space-y-1 text-xs text-[var(--text-secondary)]">
            <p className="inline-flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5" />
              Routing: {formatMs(trace.routingDurationMs)}
            </p>
            <p>Total: {formatMs(trace.totalDurationMs)}</p>
          </div>
        </section>
      </aside>
    </div>
  );
}
