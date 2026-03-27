"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspaceToolbar } from "@/components/workspace/workspace-toolbar";
import { WorkstreamCreateDialog } from "@/components/workspace/workstream-create-dialog";
import { QuickChatBar } from "@/components/workspace/chat-side-panel";
import { WorkstreamFocusPanel, HubFocusPanel } from "@/components/workspace/workstream-focus-panel";
import { useWorkspaceData } from "@/hooks/use-workspace-data";
import { useWorkspaceStore } from "@/stores/workspace-store";

const WorkspaceCanvas = dynamic(
  () =>
    import("@/components/workspace/workspace-canvas").then(
      (m) => m.WorkspaceCanvas,
    ),
  { ssr: false, loading: () => <CanvasLoader /> },
);

function CanvasLoader() {
  return (
    <div className="flex-1 flex items-center justify-center bg-[var(--bg-primary)]">
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-8 h-8 rounded-full border-2 border-[var(--border-default)] border-t-[var(--accent-cyan)]"
          style={{ animation: "spin 800ms linear infinite" }}
        />
        <span className="text-xs text-[var(--text-tertiary)]">
          Loading workspace...
        </span>
      </div>
    </div>
  );
}

function WorkspaceContent() {
  const params = useSearchParams();
  const focusId = params.get("focus") ?? undefined;
  const { user } = useUser();
  const {
    workstreams,
    loading,
    createWorkstream,
    updateWorkstream,
  } = useWorkspaceData();

  const {
    isCreateDialogOpen,
    openCreateDialog,
    closeCreateDialog,
    focusedWorkstreamId,
    focusCardBounds,
    exitWorkstream,
    hubFocusOpen,
    hubCardBounds,
    exitHub,
    openChatQuery,
  } = useWorkspaceStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerBounds, setContainerBounds] = useState({ w: 1024, h: 768 });

  // Track container size for animation origin
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () =>
      setContainerBounds({ w: el.offsetWidth, h: el.offsetHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleNewWorkstream = useCallback(() => openCreateDialog(), [openCreateDialog]);

  const handleCreate = useCallback(
    async (data: {
      type: string;
      title: string;
      description?: string;
      emoji?: string;
      color?: string;
    }) => {
      try {
        await createWorkstream(data);
        toast.success("Workstream created");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to create workstream",
        );
        throw err;
      }
    },
    [createWorkstream],
  );

  const activeCount = workstreams.filter((ws) => ws.status === "active").length;

  const focusedWorkstream = focusedWorkstreamId
    ? workstreams.find((ws) => ws._id === focusedWorkstreamId)
    : undefined;

  return (
    <AppShell fullBleed noScroll contentClassName="!p-0">
      <div className="flex flex-col h-full">
        <WorkspaceToolbar
          onCenterHub={() => window.dispatchEvent(new CustomEvent("workspace:center-hub"))}
          onNewWorkstream={handleNewWorkstream}
          workstreamCount={activeCount}
        />

        {/* Canvas container */}
        <div className="flex-1 relative overflow-hidden" ref={containerRef}>
          {loading ? (
            <CanvasLoader />
          ) : (
            <WorkspaceCanvas
              workstreams={workstreams}
              userName={user?.fullName || user?.firstName || "Student"}
              userAvatar={user?.imageUrl || ""}
              onWorkstreamUpdate={updateWorkstream}
              focusWorkstreamId={focusId}
            />
          )}

          {/* Quick Chat bar — only shown when no workstream is focused */}
          <QuickChatBar />

          {/* Workstream focus overlay */}
          {focusedWorkstreamId && focusedWorkstream && focusCardBounds && (
            <WorkstreamFocusPanel
              key={focusedWorkstreamId}
              workstream={focusedWorkstream}
              cardBounds={focusCardBounds}
              onClose={exitWorkstream}
              containerBounds={containerBounds}
              initialChatOpen={!!openChatQuery}
              initialQuery={openChatQuery}
            />
          )}

          {/* Hub focus overlay */}
          {hubFocusOpen && hubCardBounds && (
            <HubFocusPanel
              cardBounds={hubCardBounds}
              userName={user?.fullName || user?.firstName || "Student"}
              userAvatar={user?.imageUrl || ""}
              totalWorkstreams={activeCount}
              onClose={exitHub}
            />
          )}

          {/* Empty state */}
          {!loading && workstreams.length === 0 && !focusedWorkstreamId && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="flex flex-col items-center gap-4 pointer-events-auto">
                <div className="text-5xl">🌱</div>
                <h2 className="font-display text-xl font-bold text-[var(--text-primary)]">
                  Your workspace is empty
                </h2>
                <p className="text-sm text-[var(--text-secondary)] text-center max-w-xs">
                  Create your first workstream to start organizing your academic work
                </p>
                <button
                  type="button"
                  onClick={handleNewWorkstream}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-[var(--accent-cyan)] text-white hover:brightness-110 shadow-[0_4px_12px_-2px_rgba(14,142,232,0.3)] transition-all"
                >
                  Create First Workstream
                </button>
              </div>
            </div>
          )}
        </div>

        <WorkstreamCreateDialog
          open={isCreateDialogOpen}
          onClose={closeCreateDialog}
          onCreate={handleCreate}
        />
      </div>
    </AppShell>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense fallback={<CanvasLoader />}>
      <WorkspaceContent />
    </Suspense>
  );
}
