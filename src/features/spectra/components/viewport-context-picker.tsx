"use client";

import { Check, Crosshair, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import {
  contextSourceRegistry,
  type ContextSourceRegistration,
} from "../context";
import { spectraBus } from "../events";
import type { SpectraCommandOutcome } from "../events/contracts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

export function ViewportContextPicker() {
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<
    { kind: "context" } | { kind: "reference"; hostWorkId: string }
  >({ kind: "context" });
  const [entries, setEntries] = useState<ContextSourceRegistration[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string>();
  const addExplicit = useSpectraContextStore((state) => state.addExplicit);
  const selected = useSpectraContextStore((state) => state.explicit);

  useEffect(
    () =>
      contextSourceRegistry.subscribe(() =>
        setEntries(contextSourceRegistry.listEligible()),
      ),
    [],
  );
  useEffect(
    () =>
      spectraBus.handle("context.beginPicking", () => {
        setSelectionError(undefined);
        setIntent({ kind: "context" });
        setEntries(contextSourceRegistry.listEligible());
        setOpen(true);
      }),
    [],
  );
  useEffect(
    () =>
      spectraBus.handle("reference.beginPicking", ({ hostWorkId }) => {
        setSelectionError(undefined);
        setIntent({ kind: "reference", hostWorkId });
        setEntries(
          contextSourceRegistry
            .listEligible()
            .filter((entry) => entry.anchor.workId !== hostWorkId),
        );
        setOpen(true);
      }),
    [],
  );
  useEffect(() => {
    const entry = hovered ? contextSourceRegistry.get(hovered) : null;
    const element = entry?.element?.();
    if (!element) return;
    const priorOutline = element.style.outline;
    const priorOffset = element.style.outlineOffset;
    element.style.outline = "2px solid var(--accent-cyan)";
    element.style.outlineOffset = "2px";
    return () => {
      element.style.outline = priorOutline;
      element.style.outlineOffset = priorOffset;
    };
  }, [hovered]);

  async function selectEntry(entry: ContextSourceRegistration) {
    if (intent.kind === "reference") {
      setSelectionError(undefined);
      try {
        const dispatched = await spectraBus.commandAsyncResults(
          "reference.insert",
          { hostWorkId: intent.hostWorkId, target: entry.anchor },
        );
        const outcome = [...dispatched.results].reverse().find(
          (value): value is SpectraCommandOutcome =>
            value !== null &&
            typeof value === "object" &&
            "status" in value &&
            ["completed", "pending", "needs-human", "failed"].includes(
              String(value.status),
            ) &&
            "message" in value &&
            typeof value.message === "string",
        );
        if (dispatched.listeners === 0) {
          setSelectionError("Reference insertion is not available on this work.");
          return;
        }
        if (outcome?.status !== "completed") {
          setSelectionError(
            outcome?.message ?? "The reference was not inserted. Try again.",
          );
          return;
        }
        setOpen(false);
      } catch (error) {
        setSelectionError(
          error instanceof Error
            ? error.message
            : "The reference was not inserted. Try again.",
        );
      }
      return;
    }
    const summary = await entry
      .contextSummary()
      .catch(() => ({ title: entry.label, text: entry.label }));
    addExplicit({
      type: "artifact",
      id: entry.anchor.workId,
      label: entry.label,
      workspaceId: entry.workspaceId,
      source: "explicit",
      capability: "context",
      semanticTargetId: entry.id,
      semanticAnchor: {
        workId: entry.anchor.workId,
        workType: entry.anchor.workType,
        kind: entry.anchor.kind,
        path: [...entry.anchor.path],
        ...(entry.anchor.stableIds
          ? { stableIds: { ...entry.anchor.stableIds } }
          : {}),
        ...(entry.anchor.fallbackExcerpt
          ? { fallbackExcerpt: entry.anchor.fallbackExcerpt }
          : {}),
        ...(entry.anchor.relativePosition
          ? { relativePosition: Array.from(entry.anchor.relativePosition) }
          : {}),
        schemaVersion: entry.anchor.schemaVersion,
      },
      contextSummary: summary.text.slice(0, 4_000),
    });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
      {/* The picker is a capture surface: its veil stays near-invisible so the
          page remains readable, and it shares the composer-dock layer so the
          portalled card wins the tie against the dock that summoned it. */}
      <DialogContent
        layer="composer-dock"
        hideCloseButton
        overlayClassName="bg-[color-mix(in_oklab,var(--text-primary)_10%,transparent)] backdrop-blur-none"
        aria-label={
          intent.kind === "reference"
            ? "Pick referenced work from page"
            : "Pick context from page"
        }
        className="bottom-5 top-auto max-w-[min(520px,calc(100vw-24px))] -translate-y-0 gap-0 rounded-card p-3"
      >
        <div className="flex items-center gap-2">
          <Crosshair className="h-4 w-4 text-[var(--accent-cyan)]" />
          <DialogTitle className="text-caption">
            {intent.kind === "reference"
              ? "Reference visible work"
              : "Pick from page"}
          </DialogTitle>
          <span className="ml-auto text-micro text-[var(--text-tertiary)]">
            Esc to cancel
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cancel semantic picking"
            className="grid size-6 place-items-center rounded-control text-[var(--text-secondary)] outline-none transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <DialogDescription className="sr-only">
          {intent.kind === "reference"
            ? "Choose a visible work region to reference."
            : "Choose visible work to add as AI context."}
        </DialogDescription>
        {selectionError ? (
          <p role="alert" className="mt-2 text-micro text-[var(--danger)]">
            {selectionError}
          </p>
        ) : null}
        <div className="mt-2 max-h-[280px] space-y-1 overflow-y-auto">
          {entries.map((entry) => {
            const included =
              intent.kind === "context" &&
              selected.some((item) => item.semanticTargetId === entry.id);
            return (
              <button
                key={entry.id}
                type="button"
                onPointerEnter={() => setHovered(entry.id)}
                onPointerLeave={() => setHovered(null)}
                onClick={() => void selectEntry(entry)}
                className="flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left outline-none transition-colors hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-micro font-medium text-[var(--text-primary)]">
                    {entry.label}
                  </span>
                  <span className="block truncate text-micro text-[var(--text-tertiary)]">
                    {entry.type}
                  </span>
                </span>
                {included ? (
                  <Check className="h-3.5 w-3.5 text-[var(--success)]" />
                ) : null}
              </button>
            );
          })}
          {entries.length === 0 ? (
            <p className="px-3 py-6 text-center text-micro text-[var(--text-secondary)]">
              No eligible semantic targets are visible.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
