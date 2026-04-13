"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { CalendarDays, FileText, Sparkles } from "lucide-react";
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
  { id: "t1", plannerItemId: "t1", title: "Finish momentum notes", workspaceName: "IB Physics HL", dueDate: new Date().toISOString(), priority: "high", status: "in_progress" },
  { id: "t2", plannerItemId: "t2", title: "Review flashcard deck", workspaceName: "IB Physics HL", dueDate: new Date().toISOString(), priority: "medium", status: "pending" },
  { id: "t3", plannerItemId: "t3", title: "Complete titration exercises", workspaceName: "Chemistry SL", dueDate: new Date(Date.now() + 86_400_000).toISOString(), priority: "medium", status: "pending" },
  { id: "t4", plannerItemId: "t4", title: "Macbeth essay first draft", workspaceName: "English Literature", dueDate: new Date(Date.now() + 86_400_000 * 3).toISOString(), priority: "high", status: "pending" },
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
    hubVisibility,
    workspaces: storeWorkspaces,
  } = useWorkspaceStore();
  const [workspacePickerIntent, setWorkspacePickerIntent] = useState<null | {
    kind: "note" | "code" | "visual" | "task" | "thread";
    title?: string;
    content?: string;
  }>(null);
  const [plannerEditorTask, setPlannerEditorTask] = useState<PlannerTask | null>(null);
  const [isEditingWorkspaceName, setIsEditingWorkspaceName] = useState(false);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const workspaceNameInputRef = useRef<HTMLInputElement>(null);

  const hubHidden = hubVisibility === "hidden";
  const hubForceExpanded = hubVisibility === "expanded";

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
          const normalizedPreferences = {
            ...payload.preferences,
            workspaceHubVisibility:
              payload.preferences.workspaceHubVisibility === "hidden"
                ? "expanded"
                : payload.preferences.workspaceHubVisibility,
          };
          if (normalizedPreferences.workspaceHubVisibility !== payload.preferences.workspaceHubVisibility) {
            void fetch("/api/preferences", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                workspaceHubVisibility: normalizedPreferences.workspaceHubVisibility,
              }),
            }).catch(() => undefined);
          }
          hydratePreferences(normalizedPreferences);
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

  useEffect(() => {
    if (!committedWorkspace) {
      setIsEditingWorkspaceName(false);
      setWorkspaceNameDraft("");
      return;
    }
    setWorkspaceNameDraft(committedWorkspace.name);
  }, [committedWorkspace]);

  useEffect(() => {
    if (isEditingWorkspaceName) {
      workspaceNameInputRef.current?.focus();
      workspaceNameInputRef.current?.select();
    }
  }, [isEditingWorkspaceName]);

  const dockItems: WorkspaceDockItem[] = useMemo(
    () =>
      [...workspaces]
        .sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0))
        .map((ws) => ({
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

  const renameWorkspaceAction = useCallback(async (workstreamId: string, title: string) => {
    const response = await fetch("/api/workstreams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        workstreamId,
        title,
      }),
    });
    if (!response.ok) throw new Error("Failed to rename workspace");
    notifyWorkspaceContentMutated({ workstreamId, refreshWorkstreams: true, refreshHub: true });
    refreshData();
  }, [refreshData]);

  const commitWorkspaceRename = useCallback(async () => {
    if (!committedWorkspace) return;
    const trimmed = workspaceNameDraft.trim();
    setIsEditingWorkspaceName(false);
    if (!trimmed || trimmed === committedWorkspace.name) {
      setWorkspaceNameDraft(committedWorkspace.name);
      return;
    }
    await renameWorkspaceAction(committedWorkspace.id, trimmed).catch(() => undefined);
  }, [committedWorkspace, workspaceNameDraft, renameWorkspaceAction]);

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

  const submitCreationIntent = useCallback(async (workstreamId: string, intent: NonNullable<typeof workspacePickerIntent>) => {
    switch (intent.kind) {
      case "note":
        await createItemAction({ action: "createNote", workstreamId, title: intent.title ?? "Untitled note", content: intent.content ?? "" });
        break;
      case "code":
        await createItemAction({ action: "createArtifact", workstreamId, type: "code_project", title: intent.title ?? "Untitled code", content: intent.content ?? "// Start coding\n" });
        break;
      case "visual":
        await createItemAction({ action: "createArtifact", workstreamId, type: "visualization", title: intent.title ?? "Untitled visual", content: intent.content ?? "<svg></svg>" });
        break;
      case "task":
        await createItemAction({ action: "createPlannerItem", workstreamId, title: intent.title ?? "New task", type: "deadline", priority: "medium" });
        break;
      case "thread":
        await createItemAction({ action: "createThread", workstreamId, title: intent.title ?? "New thread" });
        break;
    }
    setWorkspacePickerIntent(null);
  }, [createItemAction]);

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

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "general",
          message: normalized,
          thinkingLevel: "low",
          routerMode: "auto",
          usePersonalResources: true,
          skipUserMessagePersist: false,
          workstreamId: committedWorkspaceId ?? undefined,
          scopeLevel: committedWorkspaceId ? "workspace" : "global",
        }),
      });
      if (!response.ok) {
        throw new Error("Workspace command failed");
      }
      updateResultCard(cardId, {
        state: "done",
        summary: committedWorkspaceId
          ? "Working in this workspace. Open chat for live orchestration details."
          : "Working globally. Open chat for live orchestration details.",
        targetId: "workspace-chat",
      });
      window.dispatchEvent(new CustomEvent("ai-school:open-orchestration"));
    } catch (error) {
      updateResultCard(cardId, {
        state: "error",
        summary: error instanceof Error ? error.message : "Workspace command failed",
      });
    }
  }, [pushResultCard, updateResultCard, createItemAction, committedWorkspaceId, createWorkspaceAction]);

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
        plannerItemId: item.id,
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
    const task = livePlannerTasks.find((entry) => entry.id === taskId || entry.plannerItemId === taskId);
    const plannerItemId = task?.plannerItemId ?? task?.id;
    if (!task || !plannerItemId) return;
    const workspace = workspaces.find((ws) => ws.name === task.workspaceName) ?? committedWorkspace;
    await fetch("/api/planner-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plannerItemId,
        status: task.status === "completed" ? "pending" : "completed",
      }),
    }).catch(() => undefined);
    if (workspace) {
      notifyWorkspaceContentMutated({ workstreamId: workspace.id, refreshHub: true });
    }
    refreshData();
  }, [livePlannerTasks, workspaces, committedWorkspace, refreshData]);

  const handlePlannerTaskEdit = useCallback(async (task: PlannerTask) => {
    const plannerItemId = task.plannerItemId ?? task.id;
    const dueAt = task.dueDate ? new Date(task.dueDate).getTime() : undefined;
    await fetch("/api/planner-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plannerItemId,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueAt,
      }),
    }).catch(() => undefined);
    const workspace = workspaces.find((ws) => ws.name === task.workspaceName) ?? committedWorkspace;
    if (workspace) {
      notifyWorkspaceContentMutated({ workstreamId: workspace.id, refreshHub: true, refreshWorkstreams: true });
    }
    refreshData();
  }, [workspaces, committedWorkspace, refreshData]);

  // Clear focused item when switching workspaces
  useEffect(() => {
    setFocusedItem(null);
    closeAllDeepEdits();
  }, [committedWorkspaceId, setFocusedItem, closeAllDeepEdits]);

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
      {!hubHidden && (
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
      )}

      {/* Hub ecology: Left-edge planner (above dock) */}
      {!hubHidden && (
        <PlannerEdge
          tasks={livePlannerTasks.length > 0 ? livePlannerTasks : DEMO_PLANNER_TASKS}
          onTaskClick={handleTaskClick}
          onToggleTask={handleToggleTask}
          onTaskEdit={setPlannerEditorTask}
          forceExpanded={hubForceExpanded}
        />
      )}

      {/* Hub ecology: Left-edge workspace dock */}
      {!hubHidden && (
        <WorkspaceDock
          workspaces={dockItems}
          onSelect={handleWorkspaceSelect}
          onCreateNew={() => { void createWorkspaceAction({ title: "New workspace" }); }}
          onGoHome={handleBack}
        />
      )}

      {/* Hub ecology: Top-right utility controls (always visible for settings access) */}
      <UtilityHubGroup />

      {/* Hub ecology: Left-edge quick notes (~3/4 down) */}
      {!hubHidden && <QuickNotesHub forceExpanded={hubForceExpanded} />}

      {/* Hub ecology: Bottom-center unified command bar with result cards */}
      <CommandBar
        workspaceName={committedWorkspace?.name}
        onSendMessage={handleSendMessage}
        onDismissResultCard={handleDismissResultCard}
        onReopenResultCard={handleReopenResultCard}
        onCreateWorkspace={() => { void createWorkspaceAction({ title: "New workspace" }); }}
        onCreateNote={() => {
          if (!committedWorkspaceId) {
            setWorkspacePickerIntent({ kind: "note", title: "Untitled note", content: "" });
            return;
          }
          void createItemAction({ action: "createNote", workstreamId: committedWorkspaceId, title: "Untitled note", content: "" });
        }}
        onCreateCode={() => {
          if (!committedWorkspaceId) {
            setWorkspacePickerIntent({ kind: "code", title: "Untitled code", content: "// Start coding\n" });
            return;
          }
          void createItemAction({ action: "createArtifact", workstreamId: committedWorkspaceId, type: "code_project", title: "Untitled code", content: "// Start coding\n" });
        }}
        onCreateVisual={() => {
          if (!committedWorkspaceId) {
            setWorkspacePickerIntent({ kind: "visual", title: "Untitled visual", content: "<svg></svg>" });
            return;
          }
          void createItemAction({ action: "createArtifact", workstreamId: committedWorkspaceId, type: "visualization", title: "Untitled visual", content: "<svg></svg>" });
        }}
        onCreateTask={() => {
          if (!committedWorkspaceId) {
            setWorkspacePickerIntent({ kind: "task", title: "New task" });
            return;
          }
          void createItemAction({ action: "createPlannerItem", workstreamId: committedWorkspaceId, title: "New task", type: "deadline", priority: "medium" });
        }}
        onCreateThread={() => {
          if (!committedWorkspaceId) {
            setWorkspacePickerIntent({ kind: "thread", title: "New thread" });
            return;
          }
          void createItemAction({ action: "createThread", workstreamId: committedWorkspaceId, title: "New thread" });
        }}
        onCreateWithAi={noop}
      />

      {/* Hub ecology: Bottom-right timer */}
      {!hubHidden && <TimerWidget forceExpanded={hubForceExpanded} />}

      {committedWorkspace && (
        <div className="absolute left-[92px] top-5 z-[45] flex items-center gap-3 px-1 py-1">
          <span className="text-lg leading-none">{committedWorkspace.emoji}</span>
          {isEditingWorkspaceName ? (
            <input
              ref={workspaceNameInputRef}
              value={workspaceNameDraft}
              onChange={(event) => setWorkspaceNameDraft(event.target.value)}
              onBlur={() => { void commitWorkspaceRename(); }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitWorkspaceRename();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setIsEditingWorkspaceName(false);
                  setWorkspaceNameDraft(committedWorkspace.name);
                }
              }}
              className="max-w-[280px] border-b border-[var(--accent-cyan)]/35 bg-transparent text-[14px] font-semibold text-[var(--text-primary)] outline-none"
            />
          ) : (
            <div
              className="group/name flex max-w-[320px] cursor-text items-center gap-2"
              onDoubleClick={() => {
                setWorkspaceNameDraft(committedWorkspace.name);
                setIsEditingWorkspaceName(true);
              }}
            >
              <span className="truncate text-left text-[14px] font-semibold text-[var(--text-primary)] transition-colors group-hover/name:text-[var(--accent-cyan)]">
                {committedWorkspace.name}
              </span>
              <span className="text-[10px] text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover/name:opacity-100">
                rename
              </span>
            </div>
          )}
        </div>
      )}

      {workspacePickerIntent && storeWorkspaces.length > 0 && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
          <div className="w-[min(420px,calc(100vw-32px))] rounded-3xl border border-[var(--border-default)]/40 bg-[var(--bg-elevated)] p-5 shadow-[0_28px_60px_-28px_rgba(8,22,40,0.35)]">
            <div className="mb-4">
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Choose a workspace</h2>
              <p className="mt-1 text-[12px] text-[var(--text-secondary)]">Create this {workspacePickerIntent.kind} in one of your workspaces.</p>
            </div>
            <div className="flex max-h-[280px] flex-col gap-1 overflow-y-auto">
              {storeWorkspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => { void submitCreationIntent(workspace.id, workspacePickerIntent); }}
                  className="flex items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
                >
                  <span className="text-lg leading-none">{workspace.emoji}</span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">{workspace.name}</p>
                    <p className="text-[11px] text-[var(--text-tertiary)]">{workspace.itemCount} items</p>
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setWorkspacePickerIntent(null)}
                className="rounded-xl px-3 py-2 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {plannerEditorTask && (
        <div className="absolute inset-0 z-[72] flex items-center justify-center bg-black/35 backdrop-blur-[3px]">
          <div className="w-[min(540px,calc(100vw-32px))] rounded-[28px] border border-[var(--border-default)]/40 bg-[var(--bg-elevated)] p-5 shadow-[0_28px_60px_-28px_rgba(8,22,40,0.35)]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[var(--accent-cyan)]">
                  <CalendarDays className="h-4 w-4" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">Planner item</span>
                </div>
                <h2 className="mt-2 text-[18px] font-semibold text-[var(--text-primary)]">{plannerEditorTask.title}</h2>
                <p className="mt-1 text-[12px] text-[var(--text-secondary)]">Edit title, status, priority, and due time.</p>
              </div>
              <button
                type="button"
                onClick={() => setPlannerEditorTask(null)}
                className="rounded-xl px-3 py-2 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Close
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">Title</span>
                <input
                  value={plannerEditorTask.title}
                  onChange={(event) => setPlannerEditorTask((current) => current ? { ...current, title: event.target.value } : current)}
                  className="rounded-2xl border border-[var(--border-default)]/35 bg-[var(--bg-secondary)]/40 px-3 py-2.5 text-[13px] text-[var(--text-primary)] outline-none"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">Due date & time</span>
                <input
                  type="datetime-local"
                  value={plannerEditorTask.dueDate ? new Date(plannerEditorTask.dueDate).toISOString().slice(0, 16) : ""}
                  onChange={(event) => setPlannerEditorTask((current) => current ? { ...current, dueDate: event.target.value ? new Date(event.target.value).toISOString() : undefined } : current)}
                  className="rounded-2xl border border-[var(--border-default)]/35 bg-[var(--bg-secondary)]/40 px-3 py-2.5 text-[13px] text-[var(--text-primary)] outline-none"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">Status</span>
                <select
                  value={plannerEditorTask.status}
                  onChange={(event) => setPlannerEditorTask((current) => current ? { ...current, status: event.target.value as PlannerTask["status"] } : current)}
                  className="rounded-2xl border border-[var(--border-default)]/35 bg-[var(--bg-secondary)]/40 px-3 py-2.5 text-[13px] text-[var(--text-primary)] outline-none"
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In progress</option>
                  <option value="completed">Completed</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">Priority</span>
                <select
                  value={plannerEditorTask.priority}
                  onChange={(event) => setPlannerEditorTask((current) => current ? { ...current, priority: event.target.value as PlannerTask["priority"] } : current)}
                  className="rounded-2xl border border-[var(--border-default)]/35 bg-[var(--bg-secondary)]/40 px-3 py-2.5 text-[13px] text-[var(--text-primary)] outline-none"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-[var(--border-default)]/20 bg-[var(--bg-secondary)]/20 px-3 py-3">
              <Sparkles className="h-4 w-4 text-[var(--accent-cyan)]" />
              <p className="text-[12px] text-[var(--text-secondary)]">Planner is being upgraded toward a richer scheduling app flow. This editor already persists core changes, including time selection.</p>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("ai-school:set-message", {
                    detail: { message: `Plan the next steps for ${plannerEditorTask.title}` },
                  }));
                  window.dispatchEvent(new CustomEvent("ai-school:focus-composer"));
                }}
                className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border-default)]/35 px-3 py-2 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <FileText className="h-3.5 w-3.5" />
                Send to chat
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPlannerEditorTask(null)}
                  className="rounded-xl px-3 py-2 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handlePlannerTaskEdit(plannerEditorTask);
                    setPlannerEditorTask(null);
                  }}
                  className="rounded-xl bg-[var(--accent-cyan)] px-3.5 py-2 text-[12px] font-semibold text-white"
                >
                  Save changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
