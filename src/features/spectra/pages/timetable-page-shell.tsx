"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  getSpectraArtifact,
  getSpectraOverview,
  postSpectra,
  type SpectraArtifact,
} from "@/features/spectra/data/api";
import { TimetableStudio } from "@/features/spectra/components/timetable-studio";
import { CommandBar } from "@/features/spectra/components/command-bar";
import { useSpectraRun } from "@/features/spectra/ai/use-spectra-run";

export function TimetablePageShell() {
  const [artifact, setArtifact] = useState<SpectraArtifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        let artifactId: string | undefined;
        try {
          const ensured = await postSpectra<{
            artifactId: string;
            created: boolean;
          }>({ action: "ensurePersonalTimetable" });
          artifactId = ensured.artifactId;
        } catch {
          const overview = await getSpectraOverview();
          const existing = overview.artifacts
            .filter(
              (row) =>
                row.blueprintKey === "timetable" && row.status === "active",
            )
            .sort((left, right) => right.updatedAt - left.updatedAt)[0];
          if (!existing)
            throw new Error(
              "Your Calendar is not available yet. Refresh and try again.",
            );
          artifactId = existing._id;
        }
        const { artifact: resolved } = await getSpectraArtifact(artifactId);
        if (cancelled) return;
        setArtifact(resolved);
      } catch (loadError) {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not open your Calendar.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const runEngine = useSpectraRun({
    surface: "artifacts",
    artifactId: artifact?._id,
    focusMode: "artifact",
    selectedArtifactIds: artifact ? [artifact._id] : [],
    currentView: "artifact",
    initialCards: [],
  });

  return (
    <div className="spectra-wave-y relative flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-6 py-5 sm:px-8">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
            <CalendarClock className="h-3.5 w-3.5" />
            General
          </p>
          <h1 className="mt-1 font-display text-[28px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
            Calendar
          </h1>
          <p className="mt-1 max-w-xl text-[14px] leading-6 text-[var(--text-secondary)]">
            Layered school, class, task, and personal time. Always available in
            General — Spectra can edit it, but it cannot be moved or removed.
          </p>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-[13px] text-[var(--text-secondary)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Opening your Calendar…
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-[14px] text-[var(--text-secondary)]">{error}</p>
            <button
              type="button"
              className="rounded-[8px] bg-[var(--text-primary)] px-3 py-2 text-[12px] font-semibold text-[var(--bg-primary)]"
              onClick={() => setReloadToken((token) => token + 1)}
            >
              Try again
            </button>
          </div>
        ) : artifact ? (
          <div className="h-full min-h-0 overflow-y-auto px-4 pb-28 pt-4 sm:px-8">
            <TimetableStudio
              artifactId={artifact._id}
              artifacts={[artifact]}
              content={artifact.content}
              onChange={(content) => {
                setArtifact((current) =>
                  current
                    ? { ...current, content, updatedAt: Date.now() }
                    : current,
                );
              }}
              readOnly={false}
            />
          </div>
        ) : null}
      </div>

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-50 px-4 pb-5 pt-2 sm:px-8">
        <div className="pointer-events-auto mx-auto max-w-[820px]">
          <CommandBar
            placeholder="Ask Spectra anything about this Calendar…"
            onSubmit={(prompt) => {
              void runEngine.run(prompt).catch((runError) =>
                toast.error(
                  runError instanceof Error
                    ? runError.message
                    : "Spectra could not run that request.",
                ),
              );
            }}
            busy={runEngine.submitting}
            onStop={() => runEngine.stop()}
          />
        </div>
      </div>
    </div>
  );
}
