"use client";

import { useEffect, useState } from "react";
import WorkspaceV2 from "@/components/workspace-v2/app";
import { useWorkspaceData } from "@/hooks/use-workspace-data";
import { useWorkspaceStore } from "@/stores/workspace-store";

/**
 * Workspace route — thin wrapper around the v2 redesign.
 *
 * Responsibilities kept from the old page:
 *  - Top-center "Loading workspace…" toast while useWorkspaceData is fetching.
 *  - "Live" flash toast when live backend data connects.
 *  - Best-effort hydration of user preferences into the legacy Zustand store
 *    (old surfaces that still listen to it keep working).
 *
 * Events (workspace:open-item, workspace:context-action) are now handled
 * directly inside WorkspaceV2 itself.
 */
export default function WorkspacePage() {
  const [hydrated, setHydrated] = useState(false);
  const { committedWorkspaceId } = useWorkspaceStore();
  const { isLive, loading: dataLoading } = useWorkspaceData(committedWorkspaceId);

  /* Best-effort preference hydration for legacy store consumers. */
  useEffect(() => {
    if (hydrated) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/preferences");
        if (!response.ok) return;
        const payload = (await response.json()) as {
          preferences?: {
            workspaceViewMode?: "byType" | "byTopic" | "timeline";
            workspaceBackgroundMode?: "dots" | "blank" | "grid";
            workspaceHubVisibility?: "hidden" | "collapsed" | "expanded";
            workspaceAutoSelectContext?: boolean;
          };
        };
        if (!cancelled && payload.preferences) {
          useWorkspaceStore.getState().hydratePreferences(payload.preferences);
        }
      } catch {
        /* best-effort */
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      {/* Loading indicator while fetching real data */}
      {dataLoading && (
        <div className="fixed left-1/2 top-4 z-[80] -translate-x-1/2 rounded-full border border-[var(--border-default)]/30 bg-[var(--bg-elevated)]/95 px-4 py-1.5 backdrop-blur-xl">
          <span className="text-[11px] font-medium text-[var(--text-tertiary)] animate-pulse">
            Loading workspace…
          </span>
        </div>
      )}

      {/* Live data indicator — brief flash */}
      {isLive && !dataLoading && (
        <div className="fixed left-1/2 top-4 z-[80] -translate-x-1/2 rounded-full border border-[color-mix(in_oklab,var(--success)_20%,var(--border-default))] bg-[var(--bg-elevated)]/95 px-3 py-1 backdrop-blur-xl animate-[fadeInOut_2s_ease-in-out_forwards]">
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--success)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
            Live
          </span>
        </div>
      )}

      <WorkspaceV2 />
    </div>
  );
}
