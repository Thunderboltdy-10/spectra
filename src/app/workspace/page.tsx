"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspaceToolbar } from "@/components/workspace/workspace-toolbar";
import { WorkstreamCreateDialog } from "@/components/workspace/workstream-create-dialog";
import { WorkspaceCommandBar } from "@/components/workspace/workspace-command-bar";
import { HubFocusPanel } from "@/components/workspace/workstream-focus-panel";
import { RightPushPanel } from "@/components/workspace/right-push-panel";
import { WorkstreamInternalView } from "@/components/workspace/views/workstream-internal-view";
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
  const router = useRouter();
  const params = useSearchParams();
  const hubOpen = params.get("hub") === "1";
  const wsParam = params.get("ws") ?? undefined;
  const panelType = params.get("panel") ?? undefined;
  const panelId = params.get("thread") ?? params.get("note") ?? params.get("artifact") ?? undefined;

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
    committedWorkstreamId,
    exitWorkstream,
    hubFocusOpen,
    hubCardBounds,
    exitHub,
    panel,
    openPanel,
    closePanel,
  } = useWorkspaceStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Sync URL with store state
  useEffect(() => {
    if (wsParam && wsParam !== committedWorkstreamId) {
      useWorkspaceStore.getState().commitWorkstream(wsParam);
    }
  }, [wsParam, committedWorkstreamId]);

  // Sync panel from URL
  useEffect(() => {
    if (panelType && panelId) {
      const validTypes = ["chat", "note", "artifact", "route-trace"] as const;
      const type = validTypes.find((t) => t === panelType);
      if (type) {
        openPanel(type, panelId);
      }
    }
  }, [panelType, panelId, openPanel]);

  const handleNewWorkstream = useCallback(() => openCreateDialog(), [openCreateDialog]);

  const updateWorkspaceRoute = useCallback(
    (updates: Record<string, string | undefined | null>, history: "push" | "replace" = "replace") => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === null || value === "") {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      const query = next.toString();
      const href = query ? `/workspace?${query}` : "/workspace";
      if (history === "push") {
        router.push(href);
      } else {
        router.replace(href, { scroll: false });
      }
    },
    [params, router],
  );

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

  const handleCommitWorkstream = useCallback(
    (workstreamId: string | null) => {
      if (workstreamId) {
        updateWorkspaceRoute({ ws: workstreamId, hub: undefined }, "push");
      } else {
        updateWorkspaceRoute({
          ws: undefined,
          panel: undefined,
          thread: undefined,
          note: undefined,
          artifact: undefined,
        });
      }
    },
    [updateWorkspaceRoute],
  );

  const handleOpenWorkstream = useCallback(
    (workstreamId: string) => {
      updateWorkspaceRoute({ ws: workstreamId, hub: undefined }, "push");
    },
    [updateWorkspaceRoute],
  );

  const handleCloseWorkstream = useCallback(() => {
    exitWorkstream();
    updateWorkspaceRoute({
      ws: undefined,
      panel: undefined,
      thread: undefined,
      note: undefined,
      artifact: undefined,
    });
  }, [exitWorkstream, updateWorkspaceRoute]);

  const handleOpenHub = useCallback(() => {
    updateWorkspaceRoute({ hub: "1", ws: undefined }, "push");
  }, [updateWorkspaceRoute]);

  const handleCloseHub = useCallback(() => {
    exitHub();
    updateWorkspaceRoute({ hub: undefined });
  }, [exitHub, updateWorkspaceRoute]);

  // Panel handlers
  const handleOpenPanel = useCallback(
    (type: "chat" | "note" | "artifact" | "route-trace", id: string) => {
      openPanel(type, id);
      const key = type === "chat" ? "thread" : type;
      updateWorkspaceRoute({ panel: type, [key]: id }, "push");
    },
    [openPanel, updateWorkspaceRoute],
  );

  const handleClosePanel = useCallback(() => {
    closePanel();
    updateWorkspaceRoute({
      panel: undefined,
      thread: undefined,
      note: undefined,
      artifact: undefined,
    });
  }, [closePanel, updateWorkspaceRoute]);

  const panelWidth = panel ? getPanelWidth(panel.type) : 0;

  const committedWorkstream = committedWorkstreamId
    ? workstreams.find((ws) => ws._id === committedWorkstreamId)
    : undefined;

  const userName = user?.fullName || user?.firstName || "Student";

  return (
    <AppShell fullBleed noScroll contentClassName="!p-0">
      <div className="flex flex-col h-full">
        <WorkspaceToolbar
          onCenterHub={() => window.dispatchEvent(new CustomEvent("workspace:center-hub"))}
          onNewWorkstream={handleNewWorkstream}
          workstreamCount={activeCount}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          userName={userName}
        />

        {/* Canvas + panel container */}
        <div className="flex-1 relative overflow-hidden flex" ref={containerRef}>
          {loading ? (
            <CanvasLoader />
          ) : (
            <>
              {/* Main canvas area */}
              <div
                className="relative overflow-hidden transition-all duration-300 ease-out"
                style={{ flex: `1 1 ${panelWidth > 0 ? `calc(100% - ${panelWidth}px)` : "100%"}` }}
              >
                <WorkspaceCanvas
                  workstreams={workstreams}
                  userName={userName}
                  userAvatar={user?.imageUrl || ""}
                  onWorkstreamUpdate={updateWorkstream}
                  focusWorkstreamId={wsParam}
                  searchQuery={searchQuery}
                  onOpenWorkstream={handleOpenWorkstream}
                  onOpenHub={handleOpenHub}
                  onCommitWorkstream={handleCommitWorkstream}
                />

                {/* Internal workstream view overlay — appears when committed */}
                <AnimatePresence>
                  {committedWorkstream && (
                    <WorkstreamInternalView
                      workstream={committedWorkstream}
                      onOpenPanel={handleOpenPanel}
                      onBack={handleCloseWorkstream}
                    />
                  )}
                </AnimatePresence>

                {/* Quick Chat Command Bar — hidden when panel is open or inside committed workstream */}
                <WorkspaceCommandBar
                  hidden={!!panel || !!committedWorkstreamId}
                  workstreams={workstreams}
                  committedWorkstreamId={committedWorkstreamId}
                  onOpenWorkstreamChat={(workstreamId) =>
                    handleOpenWorkstream(workstreamId)
                  }
                  onOpenPanel={handleOpenPanel}
                />
              </div>

              {/* Right push-panel */}
              <AnimatePresence>
                {panel && (
                  <RightPushPanel
                    type={panel.type}
                    id={panel.id}
                    workstreamId={committedWorkstreamId}
                    onClose={handleClosePanel}
                    onExpand={(type, id) => {
                      // Navigate to full-page view
                      if (type === "chat") {
                        router.push(`/chat?chatId=${id}&from=workspace&ws=${committedWorkstreamId ?? ""}`);
                      } else if (type === "note") {
                        // Notes don't have a standalone page yet, just expand
                      }
                    }}
                  />
                )}
              </AnimatePresence>
            </>
          )}

          {/* Hub focus overlay */}
          {(hubOpen || hubFocusOpen) && (
            <HubFocusPanel
              cardBounds={hubCardBounds}
              userName={userName}
              userAvatar={user?.imageUrl || ""}
              totalWorkstreams={activeCount}
              onClose={handleCloseHub}
            />
          )}

          {/* Empty state */}
          {!loading && workstreams.length === 0 && !committedWorkstreamId && (
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

function getPanelWidth(type: string): number {
  switch (type) {
    case "chat": return 380;
    case "note": return 520;
    case "artifact": return 480;
    case "route-trace": return 400;
    default: return 380;
  }
}

export default function WorkspacePage() {
  return (
    <Suspense fallback={<CanvasLoader />}>
      <WorkspaceContent />
    </Suspense>
  );
}
