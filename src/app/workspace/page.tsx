"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import { AppShell } from "@/components/layout/app-shell";
import { WorkstreamCreateDialog } from "@/components/workspace/workstream-create-dialog";
import { CreateArtifactDialog } from "@/components/artifacts/create-artifact-dialog";
import { RightPushPanel } from "@/components/workspace/right-push-panel";
import { EdgeUtilityOverlay } from "@/components/workspace/edge-utility-overlay";
// Internal view is now canvas-native (rendered as React Flow nodes inside workspace-canvas)
import { useWorkspaceData } from "@/hooks/use-workspace-data";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { registerSyncCallback } from "@/lib/workspace/position-persistence";
import {
  notifyWorkspaceContentMutated,
  subscribeWorkspaceContentMutated,
} from "@/lib/workspace/events";
import { hasClerkPublishableKey } from "@/lib/clerk-config";

// Lightweight workspace-creation intent detection (mirrors command bar logic)
function detectWorkspaceIntent(query: string): string | null {
  const patterns = [
    /^create\s+(?:a\s+)?(?:new\s+)?(.+?)\s+workspace$/i,
    /^(?:new|add)\s+workspace(?:\s+for\s+(.+))?$/i,
    /^make\s+(?:a\s+)?(?:new\s+)?(.+?)\s+workspace$/i,
    /^start\s+(?:a\s+)?(?:new\s+)?(.+?)\s+workspace$/i,
    /^workspace\s+for\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match) return (match[1] ?? "New Workspace").trim();
  }
  return null;
}

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
  const wsParam = params.get("ws") ?? params.get("focus") ?? undefined;
  const panelType = params.get("panel") ?? undefined;
  const panelId = params.get("thread") ?? params.get("note") ?? params.get("artifact") ?? params.get("planner") ?? undefined;

  const {
    workstreams,
    loading,
    refresh,
    createWorkstream,
    updateWorkstream,
  } = useWorkspaceData();

  const {
    isCreateDialogOpen,
    openCreateDialog,
    closeCreateDialog,
    primaryWorkstreamId,
    exitWorkstream,
    panel,
    openPanel,
    closePanel,
    commitWorkstream,
  } = useWorkspaceStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const [searchQuery] = useState("");
  const [artifactDialogOpen, setArtifactDialogOpen] = useState(false);

  // Sync URL with store state
  useEffect(() => {
    if (wsParam && wsParam !== primaryWorkstreamId) {
      commitWorkstream(wsParam);
      return;
    }
    if (!wsParam && primaryWorkstreamId) {
      exitWorkstream();
    }
  }, [commitWorkstream, exitWorkstream, primaryWorkstreamId, wsParam]);

  // Sync panel from URL
  useEffect(() => {
    if (panelType && panelId) {
      const validTypes = ["chat", "note", "artifact", "planner", "route-trace"] as const;
      const type = validTypes.find((t) => t === panelType);
      if (type && (panel?.type !== type || panel?.id !== panelId)) {
        openPanel(type, panelId);
        return;
      }
    }
    if ((!panelType || !panelId) && panel) {
      closePanel();
    }
  }, [closePanel, openPanel, panel, panelId, panelType]);

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

  const handleCommitWorkstream = useCallback(
    (workstreamId: string | null) => {
      if (workstreamId) {
        updateWorkspaceRoute({ ws: workstreamId }, "replace");
      } else {
        exitWorkstream();
        updateWorkspaceRoute({
          ws: undefined,
          panel: undefined,
          thread: undefined,
          note: undefined,
          artifact: undefined,
          planner: undefined,
        });
      }
    },
    [exitWorkstream, updateWorkspaceRoute],
  );

  const handleOpenWorkstream = useCallback(
    (workstreamId: string) => {
      updateWorkspaceRoute({ ws: workstreamId }, "push");
    },
    [updateWorkspaceRoute],
  );

  // Panel handlers — toggle if same type+id, otherwise switch
  const handleOpenPanel = useCallback(
    (type: "chat" | "note" | "artifact" | "planner" | "route-trace", id: string) => {
      if (panel?.type === type && panel?.id === id) {
        closePanel();
        updateWorkspaceRoute({
          panel: undefined,
          thread: undefined,
          note: undefined,
          artifact: undefined,
          planner: undefined,
        });
        return;
      }
      openPanel(type, id);
      const key = type === "chat" ? "thread" : type;
      updateWorkspaceRoute({ panel: type, [key]: id }, "push");
    },
    [closePanel, openPanel, panel, updateWorkspaceRoute],
  );

  const handleClosePanel = useCallback(() => {
    closePanel();
    updateWorkspaceRoute({
      panel: undefined,
      thread: undefined,
      note: undefined,
      artifact: undefined,
      planner: undefined,
    });
  }, [closePanel, updateWorkspaceRoute]);

  const handleCreateArtifact = useCallback(
    async (type: string, title: string, tags: string[], template?: { id: string; content: unknown; contentPlaintext?: string }) => {
      try {
        const wsId = primaryWorkstreamId && primaryWorkstreamId !== "__hub__" ? primaryWorkstreamId : undefined;
        const response = await fetch("/api/artifacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            type,
            title,
            tags,
            content: template?.content ?? { type: "doc", content: [{ type: "paragraph" }] },
            contentPlaintext: template?.contentPlaintext ?? "",
            editorMode: type === "document" || type === "note" ? "standard" : undefined,
            workstreamId: wsId,
          }),
        });
        if (!response.ok) throw new Error("Failed to create artifact");
        const data = (await response.json()) as { artifactId?: string };
        if (data.artifactId) {
          const panelType = type === "document" || type === "note" ? "artifact" : "artifact";
          handleOpenPanel(panelType, data.artifactId);
        }
        notifyWorkspaceContentMutated({
          workstreamId: wsId,
          refreshHub: true,
          refreshWorkstreams: true,
        });
        toast.success(`${title || "Artifact"} created`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create artifact");
      }
    },
    [handleOpenPanel, primaryWorkstreamId],
  );

  const panelWidth = panel ? getPanelWidth(panel.type) : 0;

  // Focus timer tick
  const { timerState, tickTimer, completeTimerSession } = useWorkspaceStore();
  useEffect(() => {
    if (!timerState.active) return;
    const interval = setInterval(() => {
      const { timerState: ts } = useWorkspaceStore.getState();
      if (ts.elapsed + 1 >= ts.sessionMinutes * 60) {
        completeTimerSession();
      } else {
        tickTimer();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [timerState.active, tickTimer, completeTimerSession]);

  useEffect(() => {
    registerSyncCallback(async (overrides) => {
      const positions = Object.entries(overrides).map(([workstreamId, pos]) => ({
        workstreamId,
        x: pos.x,
        y: pos.y,
      }));
      if (positions.length === 0) return;
      await fetch("/api/workstreams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ action: "batchUpdatePositions", positions }),
      });
    });
  }, []);

  useEffect(() => {
    return subscribeWorkspaceContentMutated((detail) => {
      if (detail.refreshWorkstreams) {
        void refresh();
      }
    });
  }, [refresh]);

  return (
    <AppShell fullBleed noScroll contentClassName="!p-0">
      <div className="flex flex-col h-full">
        

        {/* Canvas + panel container */}
        <div className="flex-1 relative overflow-hidden flex flex-col" ref={containerRef}>
          {loading ? (
            <CanvasLoader />
          ) : (
            <>
              {/* Canvas zone + right panel */}
              <div className="flex-1 relative overflow-hidden flex">
                {/* Main canvas area */}
                <div
                  className="relative overflow-hidden transition-all duration-300 ease-out"
                  style={{ flex: `1 1 ${panelWidth > 0 ? `calc(100% - ${panelWidth}px)` : "100%"}` }}
                >
                  <WorkspaceCanvas
                    workstreams={workstreams}
                    onNewWorkstream={handleNewWorkstream}
                    onWorkstreamUpdate={updateWorkstream}
                    focusWorkstreamId={wsParam}
                    searchQuery={searchQuery}
                    onOpenWorkstream={handleOpenWorkstream}
                    onCommitWorkstream={handleCommitWorkstream}
                    onOpenPanel={handleOpenPanel}
                    onCreateArtifact={() => setArtifactDialogOpen(true)}
                    panelWidth={panelWidth}
                  />

                  <EdgeUtilityOverlay
                    workstreams={workstreams}
                    primaryWorkstreamId={primaryWorkstreamId}
                    onOpenWorkstream={(wsId) => handleCommitWorkstream(wsId)}
                    onExitWorkstream={() => handleCommitWorkstream(null)}
                    onOpenHub={() => handleCommitWorkstream("__hub__")}
                    panelOpen={!!panel}
                    onNewWorkstream={handleNewWorkstream}
                    onCreateItem={(type) => {
                      if (type === 'note') {
                        handleOpenPanel('artifact', 'new');
                      } else if (type === 'code') {
                        handleOpenPanel('artifact', 'new-code');
                      } else if (type === 'visual') {
                        handleOpenPanel('artifact', 'new-diagram');
                      } else if (type === 'planner') {
                        handleOpenPanel('planner', 'new');
                      }
                    }}
                    onQuickChat={(query) => {
                      // Detect workspace-creation intent before routing to chat
                      const wsName = detectWorkspaceIntent(query);
                      if (wsName) {
                        handleNewWorkstream();
                        window.dispatchEvent(new CustomEvent("workspace:suggest-name", { detail: { name: wsName } }));
                        return;
                      }
                      if (primaryWorkstreamId) {
                        handleOpenPanel('chat', 'new');
                        useWorkspaceStore.getState().setOpenChatQuery(query);
                      } else {
                        router.push(`/chat?prompt=${encodeURIComponent(query)}`);
                      }
                    }}
                  />

                  {/* Canvas dimming overlay when panel is open */}
                  {panel && (
                    <div
                      className="absolute inset-0 bg-black/10 pointer-events-none z-[5] transition-opacity duration-300"
                      style={{ opacity: 1 }}
                    />
                  )}

                  {/* Empty state */}
                  {workstreams.length === 0 && !primaryWorkstreamId && (
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

                {/* Right push-panel — motion wrapper drives the slide-in/out so the
                    canvas and panel animate in perfect sync (no gap or overlap) */}
                <AnimatePresence>
                  {panel && (
                    <div
                      className="h-full shrink-0 overflow-hidden relative"
                      style={{ width: panelWidth }}
                    >
                      <RightPushPanel
                        type={panel.type}
                        id={panel.id}
                        workstreamId={primaryWorkstreamId}
                        onClose={handleClosePanel}
                        onExpand={(type, id) => {
                          if (type === "chat") {
                            router.push(`/chat?chatId=${id}&from=workspace&ws=${primaryWorkstreamId ?? ""}`);
                          } else if (type === "note") {
                            router.push(`/artifacts?id=${id}&from=workspace&ws=${primaryWorkstreamId ?? ""}`);
                          } else if (type === "artifact") {
                            router.push(`/artifacts?id=${id}`);
                          } else if (type === "planner") {
                            router.push(`/planner?item=${id}&from=workspace&ws=${primaryWorkstreamId ?? ""}`);
                          }
                        }}
                        workstreams={workstreams}
                      />
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </>
          )}
        </div>

        <WorkstreamCreateDialog
          open={isCreateDialogOpen}
          onClose={closeCreateDialog}
          onCreate={handleCreate}
        />

        <CreateArtifactDialog
          open={artifactDialogOpen}
          onClose={() => setArtifactDialogOpen(false)}
          onCreate={handleCreateArtifact}
          defaultWorkstreamId={primaryWorkstreamId}
        />
      </div>
    </AppShell>
  );
}

function WorkspaceContentWithClerk() {
  useUser();
  return <WorkspaceContent />;
}

function getPanelWidth(type: string): number {
  switch (type) {
    case "chat": return 380;
    case "note": return 520;
    case "artifact": return 480;
    case "planner": return 420;
    case "route-trace": return 400;
    default: return 380;
  }
}

export default function WorkspacePage() {
  return (
    <Suspense fallback={<CanvasLoader />}>
      {hasClerkPublishableKey() ? (
        <WorkspaceContentWithClerk />
      ) : (
        <WorkspaceContent />
      )}
    </Suspense>
  );
}

