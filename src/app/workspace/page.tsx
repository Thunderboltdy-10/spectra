"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { AnimatePresence } from "framer-motion";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { WorkspaceCanvas } from "@/components/workspace/workspace-canvas";
import { CommandBar } from "@/components/workspace/command-bar";
import {
  WorkspaceDock,
  type WorkspaceDockItem,
} from "@/components/workspace/workspace-dock";
import { TimerWidget } from "@/components/workspace/timer-widget";
import { UtilityHubGroup } from "@/components/workspace/utility-hub-group";
import { QuickNotesHub } from "@/components/workspace/quick-notes-hub";
// LensHub merged into UtilityHubGroup
import {
  PlannerEdge,
  type PlannerTask,
} from "@/components/workspace/planner-edge";
import { DeepEditSurface } from "@/components/workspace/deep-edit-surface";
import type { WorkspaceData, WorkspaceItemData } from "@/lib/workspace/contracts";
import {
  useWorkspaceData,
  dismissCommandResult,
  reopenCommandResult,
} from "@/hooks/use-workspace-data";
import { notifyWorkspaceContentMutated } from "@/lib/workspace/events";

/* ─── Demo Fallback Data ──────────────────────────────── */

const DEMO_ITEMS: WorkspaceItemData[] = [
  { id: "i1", workspaceId: "ws1", title: "Physics — Momentum Notes", preview: "Newton's second law applied to collisions and impulse-momentum theorem", itemType: "note", status: "active", updatedAt: Date.now() - 60_000, meta: "Edited 1m ago" },
  { id: "i2", workspaceId: "ws1", title: "Energy Conservation Flashcards", preview: "25 cards covering kinetic, potential, and thermal energy", itemType: "flashcard_deck", status: "active", updatedAt: Date.now() - 300_000, meta: "12 due" },
  { id: "i3", workspaceId: "ws1", title: "Lab Report: Pendulum Experiment", preview: "Simple harmonic motion analysis with uncertainty propagation", itemType: "export", status: "idle", updatedAt: Date.now() - 3_600_000 },
  { id: "i4", workspaceId: "ws1", title: "AI Tutor: Circular Motion Q&A", preview: "Thread about centripetal acceleration and orbital mechanics", itemType: "thread", status: "active", updatedAt: Date.now() - 120_000, meta: "3 new" },
  { id: "i5", workspaceId: "ws1", title: "Python: Projectile Simulation", preview: "Numerical integration of 2D projectile with air resistance", itemType: "code", status: "idle", updatedAt: Date.now() - 7_200_000 },
  { id: "i6", workspaceId: "ws1", title: "Mock Exam: Mechanics Paper 1", preview: "45 minutes, 6 structured questions, Cambridge style", itemType: "quiz", status: "completed", meta: "Score: 82%" },
  { id: "i7", workspaceId: "ws1", title: "Revision Timetable", itemType: "planner", status: "active", meta: "3 tasks today" },
  { id: "i8", workspaceId: "ws2", title: "Organic Chemistry Mind Map", preview: "Reaction pathways for alkenes, alcohols, and carbonyls", itemType: "visual", status: "active", updatedAt: Date.now() - 180_000 },
  { id: "i9", workspaceId: "ws2", title: "Titration Calculations", preview: "Worked examples with molar concentration calculations", itemType: "note", status: "idle" },
  { id: "i10", workspaceId: "ws2", title: "Bonding Quiz", preview: "Ionic, covalent, and metallic bonding assessment", itemType: "quiz", status: "active", meta: "Not started" },
  { id: "i11", workspaceId: "ws3", title: "Shakespeare Essay Draft", preview: "Analysis of power in Macbeth with textual references", itemType: "note", status: "active", updatedAt: Date.now() - 600_000, meta: "1,240 words" },
  { id: "i12", workspaceId: "ws3", title: "Vocabulary Flashcards: Rhetoric", preview: "Literary terms and rhetorical devices", itemType: "flashcard_deck", status: "idle", meta: "8 due" },
];

const DEMO_WORKSPACES: WorkspaceData[] = [
  { id: "ws1", name: "IB Physics HL", emoji: "⚙️", status: "active", itemCount: 7, lastActivity: Date.now() - 60_000, items: DEMO_ITEMS.filter((i) => i.workspaceId === "ws1") },
  { id: "ws2", name: "Chemistry SL", emoji: "🧪", status: "active", itemCount: 3, lastActivity: Date.now() - 180_000, items: DEMO_ITEMS.filter((i) => i.workspaceId === "ws2") },
  { id: "ws3", name: "English Literature", emoji: "📚", status: "quiet", itemCount: 2, lastActivity: Date.now() - 600_000, items: DEMO_ITEMS.filter((i) => i.workspaceId === "ws3") },
];

const DEMO_PLANNER_TASKS: PlannerTask[] = [
  { id: "t1", title: "Finish momentum notes", workspaceName: "IB Physics HL", dueDate: new Date().toISOString(), priority: "high", status: "in_progress" },
  { id: "t2", title: "Review flashcard deck", workspaceName: "IB Physics HL", dueDate: new Date().toISOString(), priority: "medium", status: "pending" },
  { id: "t3", title: "Complete titration exercises", workspaceName: "Chemistry SL", dueDate: new Date(Date.now() + 86_400_000).toISOString(), priority: "medium", status: "pending" },
  { id: "t4", title: "Macbeth essay first draft", workspaceName: "English Literature", dueDate: new Date(Date.now() + 86_400_000 * 3).toISOString(), priority: "high", status: "pending" },
];

/* ─── Main Workspace Page ─── */

export default function WorkspacePage() {
  const {
    committedWorkspaceId,
    commitToWorkspace,
    flyToWorkspace,
    setWorkspaces,
    workspaces,
    setFocusedItem,
    openDeepEdit,
    closeDeepEdit,
    toggleDeepEditLock,
    deepEditTargets,
    closeAllDeepEdits,
    pushResultCard,
    updateResultCard,
    dismissResultCard: storeDismissResultCard,
    reopenResultCard: storeReopenResultCard,
    hydratePreferences,
    hasHydratedPreferences,
  } = useWorkspaceStore();

  /* ─── Real data hook: fetches from backend, falls back to demo ─── */
  const {
    workspaces: liveWorkspaces,
    commandResultCards,
    isLive,
    loading: dataLoading,
    refresh: refreshData,
  } = useWorkspaceData(committedWorkspaceId);

  useEffect(() => {
    if (hasHydratedPreferences) return;
    let cancelled = false;

    const loadPreferences = async () => {
      try {
        const response = await fetch("/api/preferences");
        if (!response.ok) return;
        const payload = (await response.json()) as {
          preferences?: {
            workspaceViewMode?: "byType" | "byTopic" | "timeline";
            workspaceBackgroundMode?: "dots" | "blank" | "grid";
            workspaceHubVisibility?: "hidden" | "collapsed" | "expanded";
          };
        };
        if (!cancelled && payload.preferences) {
          hydratePreferences(payload.preferences);
        }
      } catch {
        // Preference hydration is best-effort.
      }
    };

    void loadPreferences();
    return () => {
      cancelled = true;
    };
  }, [hasHydratedPreferences, hydratePreferences]);

  // Sync live data into the store, or use demo fallback
  const prevIsLiveRef = useRef(false);
  useEffect(() => {
    if (isLive && liveWorkspaces.length > 0) {
      setWorkspaces(liveWorkspaces);
      prevIsLiveRef.current = true;
    } else if (!isLive && !dataLoading && !prevIsLiveRef.current) {
      setWorkspaces(DEMO_WORKSPACES);
    }
  }, [isLive, liveWorkspaces, dataLoading, setWorkspaces]);

  // Sync command result cards from backend into the store
  useEffect(() => {
    if (!isLive || commandResultCards.length === 0) return;
    const state = useWorkspaceStore.getState();
    const existingIds = new Set(state.resultCards.map((c) => c.id));
    for (const card of commandResultCards) {
      if (!existingIds.has(card.id)) {
        state.pushResultCard(card);
      } else {
        state.updateResultCard(card.id, { state: card.state, summary: card.summary });
      }
    }
  }, [commandResultCards, isLive]);

  // Refresh data when committing to a workspace
  useEffect(() => {
    if (committedWorkspaceId && isLive) {
      refreshData();
    }
  }, [committedWorkspaceId, isLive, refreshData]);

  const committedWorkspace = useMemo(
    () => workspaces.find((w) => w.id === committedWorkspaceId) ?? null,
    [workspaces, committedWorkspaceId],
  );

  const dockItems: WorkspaceDockItem[] = useMemo(
    () =>
      workspaces.map((ws) => ({
        id: ws.id,
        name: ws.name,
        emoji: ws.emoji,
        isActive: ws.id === committedWorkspaceId,
      })),
    [workspaces, committedWorkspaceId],
  );

  const handleWorkspaceSelect = useCallback(
    (id: string) => {
      flyToWorkspace(id);
    },
    [flyToWorkspace],
  );

  const handleBack = useCallback(() => {
    commitToWorkspace(null);
    closeAllDeepEdits();
    setFocusedItem(null);
  }, [commitToWorkspace, closeAllDeepEdits, setFocusedItem]);

  const handleItemClick = useCallback(
    (item: WorkspaceItemData) => {
      setFocusedItem(item.id);
      openDeepEdit(item);
    },
    [openDeepEdit, setFocusedItem],
  );

  const handleCanvasNodeClick = useCallback(
    (workspaceId: string) => {
      flyToWorkspace(workspaceId);
    },
    [flyToWorkspace],
  );

  const handleCanvasItemClick = useCallback(
    (itemId: string) => {
      const allItems = workspaces.flatMap((w) => w.items);
      const item = allItems.find((i) => i.id === itemId);
      if (item) handleItemClick(item);
    },
    [workspaces, handleItemClick],
  );

  const createWorkspaceAction = useCallback(async (payload: { title: string; description?: string; emoji?: string }) => {
    const response = await fetch("/api/workspace-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "createWorkspace",
        ...payload,
      }),
    });
    if (!response.ok) throw new Error("Failed to create workspace");
    const data = (await response.json()) as { workstreamId?: string };
    notifyWorkspaceContentMutated({ refreshWorkstreams: true, refreshHub: true });
    refreshData();
    if (data.workstreamId) {
      flyToWorkspace(data.workstreamId);
    }
  }, [flyToWorkspace, refreshData]);

  const createItemAction = useCallback(async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/workspace-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error("Failed workspace command");
    notifyWorkspaceContentMutated({
      workstreamId: committedWorkspaceId ?? undefined,
      refreshHub: true,
      refreshWorkstreams: true,
    });
    refreshData();
    return response.json();
  }, [committedWorkspaceId, refreshData]);

  /* ─── Command bar: uses result card stack ─── */
  const handleSendMessage = useCallback(async (message: string) => {
    const cardId = `rc-${Date.now()}`;
    const normalized = message.trim();
    const lowered = normalized.toLowerCase();
    const actionType = normalized.startsWith("/")
      ? "created" as const
      : normalized.startsWith("?")
        ? "searched" as const
        : "answered" as const;

    pushResultCard({
      id: cardId,
      state: "loading",
      promptSnippet: message,
      actionType,
    });

    try {
      if (normalized.startsWith("?") || lowered.startsWith("search ") || lowered.startsWith("find ")) {
        const query = normalized.replace(/^\?/, "").replace(/^(search|find)\s+/i, "").trim();
        const result = await createItemAction({
          action: "search",
          workstreamId: committedWorkspaceId ?? undefined,
          query,
          limit: 8,
        }) as { results?: Array<{ title: string; workspaceTitle?: string }> };
        updateResultCard(cardId, {
          state: "done",
          summary: result.results?.length
            ? `Found ${result.results.length} result${result.results.length === 1 ? "" : "s"}${result.results[0]?.workspaceTitle ? ` in ${result.results[0].workspaceTitle}` : ""}`
            : "No matching workspace results",
        });
        return;
      }

      if (lowered.startsWith("/note") || lowered.startsWith("create note")) {
        if (!committedWorkspaceId) {
          throw new Error("Open a workspace before creating a note");
        }
        const title = normalized.replace(/^\/note\s*/i, "").replace(/^create note\s*/i, "").trim() || "Untitled note";
        await createItemAction({
          action: "createNote",
          workstreamId: committedWorkspaceId,
          title,
          content: "",
        });
        updateResultCard(cardId, { state: "done", summary: `Created note: ${title}` });
        return;
      }

      if (lowered.startsWith("/task") || lowered.startsWith("create task")) {
        if (!committedWorkspaceId) {
          throw new Error("Open a workspace before creating a task");
        }
        const title = normalized.replace(/^\/task\s*/i, "").replace(/^create task\s*/i, "").trim() || "New task";
        await createItemAction({
          action: "createPlannerItem",
          workstreamId: committedWorkspaceId,
          title,
          type: "deadline",
          priority: "medium",
        });
        updateResultCard(cardId, { state: "done", summary: `Added task: ${title}` });
        return;
      }

      if (lowered.startsWith("/thread") || lowered.startsWith("create thread")) {
        if (!committedWorkspaceId) {
          throw new Error("Open a workspace before creating a thread");
        }
        const title = normalized.replace(/^\/thread\s*/i, "").replace(/^create thread\s*/i, "").trim() || "New thread";
        await createItemAction({
          action: "createThread",
          workstreamId: committedWorkspaceId,
          title,
        });
        updateResultCard(cardId, { state: "done", summary: `Created thread: ${title}` });
        return;
      }

      if (lowered.startsWith("/workspace") || lowered.startsWith("create workspace")) {
        const title = normalized.replace(/^\/workspace\s*/i, "").replace(/^create workspace\s*/i, "").trim() || "New workspace";
        await createWorkspaceAction({ title });
        updateResultCard(cardId, { state: "done", summary: `Created workspace: ${title}` });
        return;
      }

      updateResultCard(cardId, {
        state: "done",
        summary: committedWorkspaceId
          ? `Workspace command captured for ${committedWorkspace?.name ?? "workspace"}`
          : `Global command captured`,
      });
    } catch (error) {
      updateResultCard(cardId, {
        state: "done",
        summary: error instanceof Error ? error.message : "Workspace command failed",
      });
    }
  }, [pushResultCard, updateResultCard, createItemAction, committedWorkspaceId, committedWorkspace?.name, createWorkspaceAction]);

  /* ─── Dismiss/reopen: real backend when live, store-only otherwise ─── */
  const handleDismissResultCard = useCallback(
    (cardId: string) => {
      storeDismissResultCard(cardId);
      if (isLive) {
        dismissCommandResult(cardId);
      }
    },
    [storeDismissResultCard, isLive],
  );

  const handleReopenResultCard = useCallback(
    (cardId: string) => {
      storeReopenResultCard(cardId);
      if (isLive) {
        reopenCommandResult(cardId);
      }
    },
    [storeReopenResultCard, isLive],
  );

  const noop = useCallback(() => {}, []);

  const livePlannerTasks = useMemo<PlannerTask[]>(() => {
    if (!committedWorkspace) return DEMO_PLANNER_TASKS;
    return committedWorkspace.items
      .filter((item) => item.itemType === "planner")
      .map((item, index) => ({
        id: item.id,
        title: item.title,
        workspaceName: committedWorkspace.name,
        dueDate: undefined,
        priority: index === 0 ? "high" : "medium",
        status: item.status === "completed" ? "completed" : item.status === "active" ? "in_progress" : "pending",
      }));
  }, [committedWorkspace]);

  const handleTaskClick = useCallback(
    (taskId: string) => {
      const taskItem = workspaces.flatMap((w) => w.items).find((item) => item.id === taskId);
      if (taskItem) {
        handleItemClick(taskItem);
      }
    },
    [workspaces, handleItemClick],
  );

  const handleToggleTask = useCallback(async (taskId: string) => {
    const workspace = workspaces.find((ws) => ws.items.some((item) => item.id === taskId));
    const task = workspace?.items.find((item) => item.id === taskId);
    if (!task || !workspace) return;
    await fetch("/api/planner-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plannerItemId: taskId,
        status: task.status === "completed" ? "pending" : "completed",
      }),
    }).catch(() => undefined);
    notifyWorkspaceContentMutated({ workstreamId: workspace.id, refreshHub: true });
    refreshData();
  }, [workspaces, refreshData]);

  // Global keyboard: Escape closes deep edits
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (deepEditTargets.length > 0) {
          const last = deepEditTargets[deepEditTargets.length - 1];
          closeDeepEdit(last.item.id);
        } else if (committedWorkspaceId) {
          handleBack();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deepEditTargets, closeDeepEdit, committedWorkspaceId, handleBack]);

  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-[var(--bg-primary)]">
      {/* Loading indicator when fetching real data */}
      {dataLoading && (
        <div className="absolute left-1/2 top-4 z-[60] -translate-x-1/2 rounded-full border border-[var(--border-default)]/30 bg-[var(--bg-elevated)]/95 px-4 py-1.5 backdrop-blur-xl">
          <span className="text-[11px] font-medium text-[var(--text-tertiary)] animate-pulse">
            Loading workspace…
          </span>
        </div>
      )}

      {/* Live data indicator — brief flash */}
      {isLive && !dataLoading && (
        <div className="absolute left-1/2 top-4 z-[60] -translate-x-1/2 rounded-full border border-[color-mix(in_oklab,var(--success)_20%,var(--border-default))] bg-[var(--bg-elevated)]/95 px-3 py-1 backdrop-blur-xl animate-[fadeInOut_2s_ease-in-out_forwards]">
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--success)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
            Live
          </span>
        </div>
      )}

      {/* Continuous canvas — always present, never replaced */}
      <div className="flex-1">
        <WorkspaceCanvas
          onNodeClick={handleCanvasNodeClick}
          onItemClick={handleCanvasItemClick}
        />
      </div>

      {/* Hub ecology: Right-edge deep-edit surfaces */}
      <AnimatePresence>
        {deepEditTargets.map((target) => (
          <DeepEditSurface
            key={target.item.id}
            item={target.item}
            locked={target.locked}
            pinned={target.pinned}
            onClose={() => closeDeepEdit(target.item.id)}
            onToggleLock={() => toggleDeepEditLock(target.item.id)}
          />
        ))}
      </AnimatePresence>

      {/* Hub ecology: Left-edge planner (above dock) */}
      <PlannerEdge
        tasks={livePlannerTasks.length > 0 ? livePlannerTasks : DEMO_PLANNER_TASKS}
        onTaskClick={handleTaskClick}
        onToggleTask={handleToggleTask}
      />

      {/* Hub ecology: Left-edge workspace dock */}
      <WorkspaceDock
        workspaces={dockItems}
        onSelect={handleWorkspaceSelect}
        onCreateNew={noop}
        onGoHome={handleBack}
      />

      {/* Hub ecology: Top-right utility controls (background + hub visibility) */}
      <UtilityHubGroup />

      {/* LensHub merged into UtilityHubGroup above */}

      {/* Hub ecology: Left-edge quick notes (~3/4 down) */}
      <QuickNotesHub />

      {/* Hub ecology: Bottom-center unified command bar with result cards */}
      <CommandBar
        workspaceName={committedWorkspace?.name}
        onSendMessage={handleSendMessage}
        onDismissResultCard={handleDismissResultCard}
        onReopenResultCard={handleReopenResultCard}
        onCreateWorkspace={() => { void createWorkspaceAction({ title: "New workspace" }); }}
        onCreateNote={() => {
          if (!committedWorkspaceId) return;
          void createItemAction({ action: "createNote", workstreamId: committedWorkspaceId, title: "Untitled note", content: "" });
        }}
        onCreateCode={() => {
          if (!committedWorkspaceId) return;
          void createItemAction({ action: "createArtifact", workstreamId: committedWorkspaceId, type: "code_project", title: "Untitled code", content: "// Start coding\n" });
        }}
        onCreateVisual={() => {
          if (!committedWorkspaceId) return;
          void createItemAction({ action: "createArtifact", workstreamId: committedWorkspaceId, type: "visualization", title: "Untitled visual", content: "<svg></svg>" });
        }}
        onCreateTask={() => {
          if (!committedWorkspaceId) return;
          void createItemAction({ action: "createPlannerItem", workstreamId: committedWorkspaceId, title: "New task", type: "deadline", priority: "medium" });
        }}
        onCreateThread={() => {
          if (!committedWorkspaceId) return;
          void createItemAction({ action: "createThread", workstreamId: committedWorkspaceId, title: "New thread" });
        }}
        onCreateWithAi={noop}
      />

      {/* Hub ecology: Bottom-right timer */}
      <TimerWidget />
    </div>
  );
}
