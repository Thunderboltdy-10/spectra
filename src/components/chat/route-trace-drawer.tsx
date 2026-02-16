"use client";

import { useEffect, useState } from "react";
import { X, CheckCircle2, XCircle, Timer, Milestone, ArrowRight, ChevronDown } from "lucide-react";
import type { RouteTrace } from "@/types";
import { Button } from "@/components/ui/button";
import { useCompactSheet } from "@/hooks/use-compact-sheet";
import { useRightPanelDock } from "@/hooks/use-right-panel-dock";

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

function sanitizeModelId(value: string) {
  return value
    .replace(/:free$/i, "")
    .replace(/[\s(_-]*\bfree\b[\s)_-]*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function CandidateBar({ score }: { score?: number }) {
  const width = typeof score === "number" && Number.isFinite(score) ? Math.max(4, Math.round(score * 100)) : 4;
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
      <div className="h-full rounded-full bg-[var(--gradient-brand)]" style={{ width: `${width}%` }} />
    </div>
  );
}

export function RouteTraceDrawer({ open, onClose, trace }: RouteTraceDrawerProps) {
  const compact = useCompactSheet(860);
  const docked = useRightPanelDock({ id: "route-trace-drawer", open, compact, maxWidthPx: 576 });
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCollapsed(compact);
  }, [open, compact]);

  useEffect(() => {
    if (!compact) {
      setCollapsed(false);
    }
  }, [compact]);

  if (!open || !trace) return null;

  return (
    <div className={`fixed z-50 ${docked ? "inset-y-0 right-0 pointer-events-none" : "inset-0"}`} style={docked ? { width: "var(--right-panel-space, 576px)" } : undefined}>
      {!docked ? (
        <button
          type="button"
          className="absolute inset-0 bg-transparent"
          onClick={onClose}
          aria-label="Close route trace"
        />
      ) : null}

      <aside
        className={`right-panel-shell pointer-events-auto absolute flex flex-col border-[var(--border-default)] bg-[var(--bg-sidebar)] p-4 shadow-[var(--shadow-soft)] ${
          docked ? "right-panel-shell--docked" : "right-panel-shell--sheet"
        } ${
          compact
            ? "bottom-3 left-3 right-3 max-h-[78vh] rounded-2xl border"
            : "inset-y-0 right-0 w-[92vw] max-w-xl border-l"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Route Trace</p>
            <h3 className="font-display text-2xl text-[var(--text-primary)]">Model Decision Timeline</h3>
          </div>
          <div className="flex items-center gap-1.5">
            {compact ? (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => setCollapsed((prev) => !prev)}
                aria-label={collapsed ? "Expand details" : "Collapse details"}
              >
                <ChevronDown className={`h-4 w-4 transition ${collapsed ? "-rotate-90" : "rotate-0"}`} />
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close route trace">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {!collapsed ? (
          <div className="right-panel-content min-h-0 flex-1 overflow-y-auto pr-1">
            <section className="mb-5">
          <h4 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Inputs</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            <InputRow label="Mode" value={trace.inputs.mode} />
            <InputRow label="Tier" value={trace.inputs.spendingTier} />
            <InputRow label="Thinking" value={trace.inputs.thinkingLevel} />
            <InputRow label="Complex" value={trace.inputs.complexPrompt ? "Yes" : "No"} />
            <InputRow label="Prompt Category" value={trace.inputs.promptCategory} />
            <InputRow label="Question Type" value={trace.inputs.questionType ?? "—"} />
            <InputRow label="Multipart" value={trace.inputs.isMultipart ? "Yes" : "No"} />
            <InputRow label="Enhanced" value={trace.inputs.promptEnhanced ? "Yes" : "No"} />
            <InputRow label="Attachments" value={`${trace.inputs.attachmentTypes.join(", ") || "none"}`} />
            <InputRow label="Message Length" value={trace.inputs.messageLength} />
          </div>
            </section>

            <section className="mb-5">
          <h4 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Pipeline Timeline</h4>
          <div className="mb-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
            <ol className="space-y-2">
              {[
                { label: "Route analysis", detail: `${formatMs(trace.routingDurationMs)}` },
                { label: "Model execution", detail: trace.totalDurationMs ? `${formatMs(trace.totalDurationMs - trace.routingDurationMs)}` : "—" },
                { label: "Post-process", detail: trace.toolchain.includes("marker_verification") ? "verification enabled" : "standard" },
              ].map((step) => (
                <li key={step.label} className="flex items-center justify-between rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-2">
                  <span className="text-xs font-medium text-[var(--text-primary)]">{step.label}</span>
                  <span className="text-xs text-[var(--text-secondary)]">{step.detail}</span>
                </li>
              ))}
            </ol>
          </div>

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
                  <span className="font-mono text-xs text-[var(--text-primary)]">{sanitizeModelId(candidate.modelId)}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Score: {formatScore(candidate.score)}
                </p>
                <CandidateBar score={candidate.score} />
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
          <p className="font-mono text-xs text-[var(--text-primary)]">{sanitizeModelId(trace.selected.modelId)}</p>
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
                  <p className="font-mono text-[11px] text-[var(--text-secondary)] inline-flex items-center gap-1">
                    {sanitizeModelId(fallback.fromModel)} <ArrowRight className="h-3 w-3" /> {sanitizeModelId(fallback.toModel)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">{fallback.error}</p>
                </li>
              ))}
            </ol>
          )}
            </section>

            {trace.collaborators && trace.collaborators.length > 0 ? (
              <section className="mb-5">
                <h4 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Collaborators</h4>
                <div className="space-y-2">
                  {trace.collaborators.map((collaborator, index) => (
                    <div key={`${collaborator.role}-${index}`} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2.5">
                      <p className="text-xs font-medium text-[var(--text-primary)]">{collaborator.role}</p>
                      <p className="text-[11px] text-[var(--text-secondary)]">{sanitizeModelId(collaborator.model)}</p>
                      <p className="text-[11px] text-[var(--text-secondary)]">{collaborator.tokensUsed} tokens • {formatMs(collaborator.durationMs)}</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
              <h4 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Timing</h4>
              <div className="space-y-1 text-xs text-[var(--text-secondary)]">
                <p className="inline-flex items-center gap-1.5">
                  <Timer className="h-3.5 w-3.5" />
                  Routing: {formatMs(trace.routingDurationMs)}
                </p>
                <p>Total: {formatMs(trace.totalDurationMs)}</p>
                <p>Budget guard: {trace.inputs.spendingTier}</p>
              </div>
            </section>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
