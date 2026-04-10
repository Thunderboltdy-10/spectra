"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { AppShell } from "@/components/layout/app-shell";
import { WorkstreamCreateDialog } from "@/components/workspace/workstream-create-dialog";
import { CreateArtifactDialog } from "@/components/artifacts/create-artifact-dialog";
import { RightPushPanel } from "@/components/workspace/right-push-panel";
import { EdgeUtilityOverlay } from "@/components/workspace/edge-utility-overlay";
// Internal view is now canvas-native (rendered as React Flow nodes inside workspace-canvas)
import { useWorkspaceData } from "@/hooks/use-workspace-data";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
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
  const pathname = usePathname();
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
  const { activeArtifactId, setActiveArtifactId } = useEditorStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const [searchQuery] = useState("");
  const [artifactDialogOpen, setArtifactDialogOpen] = useState(false);

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
      next.delete("ws");
      next.delete("focus");
      const sanitizedQuery = next.toString();
      const href = sanitizedQuery ? `${pathname}?${sanitizedQuery}` : pathname;
      if (history === "push") {
        router.push(href);
      } else {
        router.replace(href, { scroll: false });
      }
    },
    [params, pathname, router],
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
        commitWorkstream(workstreamId);
        updateWorkspaceRoute({}, "replace");
      } else {
        exitWorkstream();
        updateWorkspaceRoute({
          panel: undefined,
          thread: undefined,
          note: undefined,
          artifact: undefined,
          planner: undefined,
        });
      }
    },
    [commitWorkstream, exitWorkstream, updateWorkspaceRoute],
  );

  const handleOpenWorkstream = useCallback(
    (workstreamId: string) => {
      commitWorkstream(workstreamId);
      updateWorkspaceRoute({}, "replace");
    },
    [commitWorkstream, updateWorkspaceRoute],
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

  // Structured creation through workspace orchestration — creates a real artifact/planner item
  // and opens the panel for it, instead of opening a panel with a sentinel "new" ID.
  const handleCreateItem = useCallback(async (type: 'note' | 'code' | 'visual' | 'planner') => {
    const wsId = primaryWorkstreamId && primaryWorkstreamId !== '__hub__' ? primaryWorkstreamId : undefined;
    try {
      if (type === 'planner') {
        const res = await fetch('/api/workspace-orchestration', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'resolveCommand',
            query: 'create task: New task',
            workstreamId: wsId,
          }),
        });
        if (!res.ok) throw new Error('Failed to create task');
        const data = await res.json() as { outcome: string; openPanel?: { type: string; id: string } };
        if (data.openPanel) {
          handleOpenPanel(data.openPanel.type as 'planner', data.openPanel.id);
        }
        toast.success('Task created');
      } else {
        const artifactType = type === 'code' ? 'code_project' : type === 'visual' ? 'diagram' : 'note';
        const title = type === 'code' ? 'Untitled Code' : type === 'visual' ? 'Untitled Visual' : 'Untitled Note';
        const editorMode = type === 'code' ? 'code' : 'standard';
        const res = await fetch('/api/artifacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create',
            type: artifactType,
            title,
            tags: [],
            content: type === 'code' ? '' : { type: 'doc', content: [{ type: 'paragraph' }] },
            contentPlaintext: '',
            editorMode,
            workstreamId: wsId,
          }),
        });
        if (!res.ok) throw new Error('Failed to create item');
        const data = await res.json() as { artifactId?: string };
        if (data.artifactId) {
          handleOpenPanel('artifact', data.artifactId);
        }
        toast.success(`${title.replace('Untitled ', '')} created`);
      }
      notifyWorkspaceContentMutated({
        workstreamId: wsId,
        refreshHub: true,
        refreshWorkstreams: true,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create item');
    }
  }, [handleOpenPanel, primaryWorkstreamId]);

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
                <div className="flex-1 relative overflow-hidden">
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
                    activeArtifactId={activeArtifactId}
                    activeArtifactTitle={undefined}
                    onClearScope={() => setActiveArtifactId(undefined)}
                    onOpenWorkstream={(wsId) => {
                      if (wsId === "__hub__") {
                        handleCommitWorkstream(null);
                        return;
                      }
                      handleCommitWorkstream(wsId);
                    }}
                    onExitWorkstream={() => handleCommitWorkstream(null)}
                    onOpenHub={() => handleCommitWorkstream(null)}
                    panelOpen={!!panel}
                    onNewWorkstream={handleNewWorkstream}
                    onOpenPanel={handleOpenPanel}
                    onCreateItem={(type) => {
                      if (type === 'note') {
                        void handleCreateItem('note');
                      } else if (type === 'code') {
                        void handleCreateItem('code');
                      } else if (type === 'visual') {
                        void handleCreateItem('visual');
                      } else if (type === 'planner') {
                        void handleCreateItem('planner');
                      }
                    }}
                    onResolveCommand={async (params) => {
                      try {
                        const res = await fetch('/api/workspace-orchestration', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: 'resolveCommand',
                            query: params.query,
                            workstreamId: params.workstreamId,
                            artifactId: params.artifactId,
                          }),
                        });
                        if (!res.ok) return null;
                        const data = await res.json() as {
                          outcome: 'chat' | 'planner' | 'artifact';
                          openPanel?: { type: string; id: string };
                          plannerItemId?: string;
                          artifactId?: string;
                          artifactType?: string;
                        };
                        if (data.outcome !== 'chat') {
                          notifyWorkspaceContentMutated({
                            workstreamId: params.workstreamId,
                            refreshHub: true,
                            refreshWorkstreams: true,
                          });
                          if (data.outcome === 'planner') {
                            toast.success('Task created');
                          } else if (data.outcome === 'artifact') {
                            toast.success('Item created');
                          }
                        }
                        return data;
                      } catch {
                        return null;
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
                      if (primaryWorkstreamId && primaryWorkstreamId !== "__hub__") {
                        handleOpenPanel('chat', 'new');
                        useWorkspaceStore.getState().commitWorkstreamWithChat(primaryWorkstreamId, query);
                      } else {
                        router.push(`/chat?prompt=${encodeURIComponent(query)}`);
                      }
                    }}
                  />

                  {/* Canvas dimming overlay when panel is open — subtle ambient darkening */}
                  <AnimatePresence>
                    {panel && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                        className="absolute inset-0 pointer-events-none z-[5]"
                        style={{
                          background: "radial-gradient(ellipse 80% 90% at 30% 50%, rgba(0,0,0,0.06) 0%, rgba(0,0,0,0.14) 100%)",
                          backdropFilter: "blur(1.5px) saturate(0.9)",
                        }}
                      />
                    )}
                  </AnimatePresence>

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
                <AnimatePresence mode="wait">
                  {panel && (
                    <RightPushPanel
                      key={`${panel.type}-${panel.id}`}
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

