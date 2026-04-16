"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
// lucide-react icons removed (CalendarDays, FileText, Sparkles) — unused after result card cleanup
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
import { PlannerEdge } from "@/components/workspace/planner-edge";
import { DeepEditSurface } from "@/components/workspace/deep-edit-surface";
import { ThreadsHub } from "@/components/workspace/threads-hub";
import type { WorkspaceData, WorkspaceItemData } from "@/lib/workspace/contracts";
import {
  useWorkspaceData,
  dismissCommandResult,
  reopenCommandResult,
  createCommandResult,
  updateCommandResult,
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
    openThreadInHub,
    workspaces: storeWorkspaces,
  } = useWorkspaceStore();
  const [workspacePickerIntent, setWorkspacePickerIntent] = useState<null | {
    kind: "note" | "code" | "visual" | "task" | "thread";
    title?: string;
    content?: string;
  }>(null);
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
      if (item.itemType === "thread") {
        openThreadInHub(item.id);
      } else {
        openDeepEdit(item);
      }
    },
    [openDeepEdit, openThreadInHub, setFocusedItem],
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
  const [isProcessingCommand, setIsProcessingCommand] = useState(false);

  const handleSendMessage = useCallback(async (message: string) => {
    const normalized = message.trim();
    const lowered = normalized.toLowerCase();

    // Determine intent from command prefix
    const isSearch = normalized.startsWith("?") || lowered.startsWith("search ") || lowered.startsWith("find ");
    const isNoteCmd = lowered.startsWith("/note") || lowered.startsWith("create note");
    const isTaskCmd = lowered.startsWith("/task") || lowered.startsWith("create task");
    const isThreadCmd = lowered.startsWith("/thread") || lowered.startsWith("create thread");
    const isWorkspaceCmd = lowered.startsWith("/workspace") || lowered.startsWith("create workspace");

    setIsProcessingCommand(true);

    let createdResultId: string | undefined;

    try {
      /* ── Search ── */
      if (isSearch) {
        const query = normalized.replace(/^\?/, "").replace(/^(search|find)\s+/i, "").trim();
        const res = await createCommandResult({
          workstreamId: committedWorkspaceId ?? "",
          intent: "result",
          title: normalized.length > 60 ? normalized.slice(0, 57) + "\u2026" : normalized,
          status: "processing",
        });
        createdResultId = res?.resultId;

        const result = await createItemAction({
          action: "search",
          workstreamId: committedWorkspaceId ?? "",
          query,
          limit: 8,
        }) as { results?: Array<{ title: string; workspaceTitle?: string; _id?: string }> };
        const count = result.results?.length ?? 0;
        
        if (createdResultId) {
          await updateCommandResult({
            resultId: createdResultId,
            status: "completed",
            summary: count > 0
              ? `${count} result${count === 1 ? "" : "s"} for \u201c${query}\u201d`
              : `No results for \u201c${query}\u201d`,
          });
          refreshData();
        }
        return;
      }

      /* ── Create note ── */
      if (isNoteCmd) {
        if (!committedWorkspaceId) throw new Error("Enter a workspace first");
        const title = normalized.replace(/^\/note\s*/i, "").replace(/^create note\s*/i, "").trim() || "Untitled note";
        // Push optimistic result card for immediate feedback
        const optimisticId = `optimistic-note-${Date.now()}`;
        pushResultCard({
          id: optimisticId,
          state: "loading",
          promptSnippet: `Creating note\u2026`,
          actionType: "created",
          targetItemType: "note",
        });
        try {
          await createItemAction({
            action: "createNote",
            workstreamId: committedWorkspaceId,
            title,
            content: "",
          });
          // Backend result card will be synced by refreshData() inside createItemAction
          // Mark optimistic card as done; the real backend card will appear alongside it
          updateResultCard(optimisticId, {
            state: "done",
            summary: `Note \u201c${title}\u201d created`,
          });
        } catch (err) {
          updateResultCard(optimisticId, {
            state: "error",
            summary: err instanceof Error ? err.message : "Failed to create note",
          });
          throw err;
        }
        return;
      }

      /* ── Create task ── */
      if (isTaskCmd) {
        if (!committedWorkspaceId) throw new Error("Enter a workspace first");
        const title = normalized.replace(/^\/task\s*/i, "").replace(/^create task\s*/i, "").trim() || "New task";
        // Push optimistic result card for immediate feedback
        const optimisticId = `optimistic-task-${Date.now()}`;
        pushResultCard({
          id: optimisticId,
          state: "loading",
          promptSnippet: `Creating task\u2026`,
          actionType: "planned",
          targetItemType: "planner",
        });
        try {
          await createItemAction({
            action: "createPlannerItem",
            workstreamId: committedWorkspaceId,
            title,
            type: "deadline",
            priority: "medium",
          });
          updateResultCard(optimisticId, {
            state: "done",
            summary: `Task \u201c${title}\u201d created`,
          });
        } catch (err) {
          updateResultCard(optimisticId, {
            state: "error",
            summary: err instanceof Error ? err.message : "Failed to create task",
          });
          throw err;
        }
        return;
      }

      /* ── Create thread ── */
      if (isThreadCmd) {
        if (!committedWorkspaceId) throw new Error("Enter a workspace first");
        const title = normalized.replace(/^\/thread\s*/i, "").replace(/^create thread\s*/i, "").trim() || "New thread";
        // Push optimistic result card for immediate feedback
        const optimisticId = `optimistic-thread-${Date.now()}`;
        pushResultCard({
          id: optimisticId,
          state: "loading",
          promptSnippet: `Creating thread\u2026`,
          actionType: "answered",
          targetItemType: "thread",
        });
        try {
          await createItemAction({
            action: "createThread",
            workstreamId: committedWorkspaceId,
            title,
          });
          updateResultCard(optimisticId, {
            state: "done",
            summary: `Thread \u201c${title}\u201d created`,
          });
        } catch (err) {
          updateResultCard(optimisticId, {
            state: "error",
            summary: err instanceof Error ? err.message : "Failed to create thread",
          });
          throw err;
        }
        return;
      }

      /* ── Create workspace ── */
      if (isWorkspaceCmd) {
        const title = normalized.replace(/^\/workspace\s*/i, "").replace(/^create workspace\s*/i, "").trim() || "New workspace";
        const res = await createCommandResult({
          workstreamId: committedWorkspaceId ?? "", // wait, we don't know the new workstream ID yet
          intent: "result",
          title: "Create workspace",
          status: "processing",
        });
        createdResultId = res?.resultId;

        await createWorkspaceAction({ title });
        
        if (createdResultId) {
          await updateCommandResult({
            resultId: createdResultId,
            status: "completed",
            summary: `Workspace \u201c${title}\u201d created`,
          });
        }
        return;
      }

      /* ── General AI message → routed to chat pipeline ── */
      // Create backend processing result first
      if (committedWorkspaceId) {
        const res = await createCommandResult({
          workstreamId: committedWorkspaceId ?? "",
          intent: "result",
          title: normalized.length > 60 ? normalized.slice(0, 57) + "\u2026" : normalized,
          status: "processing",
        });
        createdResultId = res?.resultId;
        refreshData();
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
          workstreamId: committedWorkspaceId,
          scopeLevel: committedWorkspaceId ? "workspace" : "global",
        }),
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(errText || "Request failed");
      }

      let chatId: string | undefined;
      let threadTitle: string | undefined;
      let createdArtifacts: Array<{ id: string; title: string; type: string }> = [];
      try {
        const data = await response.json() as {
          chatId?: string;
          threadTitle?: string;
          artifacts?: Array<{ id: string; title: string; type: string }>;
        };
        chatId = data.chatId;
        threadTitle = data.threadTitle;
        createdArtifacts = data.artifacts ?? [];
      } catch {
        // Response might be streaming or non-JSON — that's ok
      }

      if (createdResultId) {
        if (createdArtifacts.length > 0) {
          const first = createdArtifacts[0];
          const summary = createdArtifacts.length === 1
            ? `Created ${first.type}: \u201c${first.title}\u201d`
            : `Created ${createdArtifacts.length} items`;
          await updateCommandResult({
            resultId: createdResultId,
            status: "completed",
            summary,
            targetKind: "artifact",
            targetId: first.id,
            variant: "artifact",
          });
        } else if (chatId) {
          await updateCommandResult({
            resultId: createdResultId,
            status: "completed",
            summary: threadTitle
              ? `Replied in \u201c${threadTitle}\u201d`
              : "Sent to chat thread",
            targetKind: "chat",
            targetId: chatId,
            variant: "thread",
          });
        } else {
          await updateCommandResult({
            resultId: createdResultId,
            status: "completed",
            summary: "Response sent to chat",
          });
        }
      }

      refreshData();
    } catch (error) {
      if (createdResultId) {
        await updateCommandResult({
          resultId: createdResultId,
          status: "completed", 
          summary: error instanceof Error ? error.message : "Command failed",
        });
        refreshData();
      }
    } finally {
      setIsProcessingCommand(false);
    }
  }, [committedWorkspaceId, createWorkspaceAction, refreshData, createItemAction, pushResultCard, updateResultCard]);

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

  const handleTaskClick = useCallback(
    (taskId: string) => {
      const taskItem = workspaces.flatMap((w) => w.items).find((item) => item.id === taskId);
      if (taskItem) {
        handleItemClick(taskItem);
      }
    },
    [workspaces, handleItemClick],
  );

  // Clear focused item when switching workspaces
  useEffect(() => {
    setFocusedItem(null);
    closeAllDeepEdits();
  }, [committedWorkspaceId, setFocusedItem, closeAllDeepEdits]);

  // Auto-dismiss completed result cards after 12s to keep UI clean
  const resultCards = useWorkspaceStore((s) => s.resultCards);
  useEffect(() => {
    const doneCards = resultCards.filter(
      (c) => c.state === "done" || c.state === "error",
    );
    if (doneCards.length === 0) return;

    const timers = doneCards.map((card) => {
      const age = Date.now() - card.createdAt;
      const remainingMs = Math.max(0, 30_000 - age);
      return setTimeout(() => {
        storeDismissResultCard(card.id);
      }, remainingMs);
    });

    return () => timers.forEach(clearTimeout);
  }, [resultCards, storeDismissResultCard]);

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

  // Handle open-item events from result cards and other surfaces
  useEffect(() => {
    const handleOpenItem = (e: Event) => {
      const customEvent = e as CustomEvent<{ itemId: string; itemType?: string }>;
      const { itemId, itemType } = customEvent.detail ?? {};
      if (!itemId) return;

      // First try to find by direct workspace item ID
      const allItems = workspaces.flatMap((w) => w.items);
      let item = allItems.find((i) => i.id === itemId);

      // If not found, the targetId may be a source entity ID (chatId, artifactId, etc.)
      // Workspace items sometimes have a different ID from their source entity
      if (!item) {
        // Try matching by source entity IDs first (more precise than type-only fallback)
        item = allItems.find((i) =>
          i.sourceChatId === itemId ||
          i.sourceArtifactId === itemId ||
          i.sourcePlannerItemId === itemId
        );
      }

      // Last resort: match by type if itemId is clearly not a database ID
      // (prevents false positives from matching ANY item of the same type)
      if (!item && itemType) {
        // Only use type fallback if the itemId doesn't look like a Convex ID
        const isConvexId = itemId.length > 16;
        if (!isConvexId) {
          item = allItems.find((i) => i.itemType === itemType);
        }
      }

      if (item) {
        handleItemClick(item);
      } else {
        // Item not yet in workspace items (may still be syncing).
        // Refresh data and try again after a short delay.
        refreshData();
        setTimeout(() => {
          const freshItems = useWorkspaceStore.getState().workspaces.flatMap((w) => w.items);
          const freshItem = freshItems.find((i) =>
            i.id === itemId ||
            i.sourceChatId === itemId ||
            i.sourceArtifactId === itemId ||
            i.sourcePlannerItemId === itemId
          );
          if (freshItem) handleItemClick(freshItem);
        }, 1200);
      }
    };
    window.addEventListener("workspace:open-item", handleOpenItem);
    return () => window.removeEventListener("workspace:open-item", handleOpenItem);
  }, [workspaces, handleItemClick, refreshData]);

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

      {/* Hub ecology: Right-edge threads hub */}
      {!hubHidden && <ThreadsHub forceExpanded={hubForceExpanded} />}

      {/* Hub ecology: Left-edge planner (above dock) */}
      {!hubHidden && (
        <PlannerEdge
          onTaskClick={handleTaskClick}
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
        isProcessing={isProcessingCommand}
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
    </div>
  );
}
