"use client";

import { useCallback, useEffect, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { WorkspaceCanvas } from "@/components/workspace/workspace-canvas";
import { CommandBar } from "@/components/workspace/command-bar";
import {
  WorkspaceDock,
  type WorkspaceDockItem,
} from "@/components/workspace/workspace-dock";
import { TimerWidget } from "@/components/workspace/timer-widget";
import {
  PlannerEdge,
  type PlannerTask,
} from "@/components/workspace/planner-edge";
import { DeepEditSurface } from "@/components/workspace/deep-edit-surface";
import type { WorkspaceData, WorkspaceItemData } from "@/lib/workspace/contracts";

/* u2500u2500u2500 Demo Data (replaced by real queries when backend is wired) u2500u2500u2500 */

const DEMO_ITEMS: WorkspaceItemData[] = [
  {
    id: "i1",
    workspaceId: "ws1",
    title: "Physics \u2014 Momentum Notes",
    preview: "Newton's second law applied to collisions and impulse-momentum theorem",
    itemType: "note",
    status: "active",
    updatedAt: Date.now() - 60_000,
    meta: "Edited 1m ago",
  },
  {
    id: "i2",
    workspaceId: "ws1",
    title: "Energy Conservation Flashcards",
    preview: "25 cards covering kinetic, potential, and thermal energy",
    itemType: "flashcard_deck",
    status: "active",
    updatedAt: Date.now() - 300_000,
    meta: "12 due",
  },
  {
    id: "i3",
    workspaceId: "ws1",
    title: "Lab Report: Pendulum Experiment",
    preview: "Simple harmonic motion analysis with uncertainty propagation",
    itemType: "export",
    status: "idle",
    updatedAt: Date.now() - 3_600_000,
  },
  {
    id: "i4",
    workspaceId: "ws1",
    title: "AI Tutor: Circular Motion Q&A",
    preview: "Thread about centripetal acceleration and orbital mechanics",
    itemType: "thread",
    status: "active",
    updatedAt: Date.now() - 120_000,
    meta: "3 new",
  },
  {
    id: "i5",
    workspaceId: "ws1",
    title: "Python: Projectile Simulation",
    preview: "Numerical integration of 2D projectile with air resistance",
    itemType: "code",
    status: "idle",
    updatedAt: Date.now() - 7_200_000,
  },
  {
    id: "i6",
    workspaceId: "ws1",
    title: "Mock Exam: Mechanics Paper 1",
    preview: "45 minutes, 6 structured questions, Cambridge style",
    itemType: "quiz",
    status: "completed",
    meta: "Score: 82%",
  },
  {
    id: "i7",
    workspaceId: "ws1",
    title: "Revision Timetable",
    itemType: "planner",
    status: "active",
    meta: "3 tasks today",
  },
  {
    id: "i8",
    workspaceId: "ws2",
    title: "Organic Chemistry Mind Map",
    preview: "Reaction pathways for alkenes, alcohols, and carbonyls",
    itemType: "visual",
    status: "active",
    updatedAt: Date.now() - 180_000,
  },
  {
    id: "i9",
    workspaceId: "ws2",
    title: "Titration Calculations",
    preview: "Worked examples with molar concentration calculations",
    itemType: "note",
    status: "idle",
  },
  {
    id: "i10",
    workspaceId: "ws2",
    title: "Bonding Quiz",
    preview: "Ionic, covalent, and metallic bonding assessment",
    itemType: "quiz",
    status: "active",
    meta: "Not started",
  },
  {
    id: "i11",
    workspaceId: "ws3",
    title: "Shakespeare Essay Draft",
    preview: "Analysis of power in Macbeth with textual references",
    itemType: "note",
    status: "active",
    updatedAt: Date.now() - 600_000,
    meta: "1,240 words",
  },
  {
    id: "i12",
    workspaceId: "ws3",
    title: "Vocabulary Flashcards: Rhetoric",
    preview: "Literary terms and rhetorical devices",
    itemType: "flashcard_deck",
    status: "idle",
    meta: "8 due",
  },
];

const DEMO_WORKSPACES: WorkspaceData[] = [
  {
    id: "ws1",
    name: "IB Physics HL",
    emoji: "\u2699\ufe0f",
    status: "active",
    itemCount: 7,
    lastActivity: Date.now() - 60_000,
    items: DEMO_ITEMS.filter((i) => i.workspaceId === "ws1"),
  },
  {
    id: "ws2",
    name: "Chemistry SL",
    emoji: "\ud83e\uddea",
    status: "active",
    itemCount: 3,
    lastActivity: Date.now() - 180_000,
    items: DEMO_ITEMS.filter((i) => i.workspaceId === "ws2"),
  },
  {
    id: "ws3",
    name: "English Literature",
    emoji: "\ud83d\udcda",
    status: "quiet",
    itemCount: 2,
    lastActivity: Date.now() - 600_000,
    items: DEMO_ITEMS.filter((i) => i.workspaceId === "ws3"),
  },
];

const DEMO_PLANNER_TASKS: PlannerTask[] = [
  {
    id: "t1",
    title: "Finish momentum notes",
    workspaceName: "IB Physics HL",
    dueDate: new Date().toISOString(),
    priority: "high",
    status: "in_progress",
  },
  {
    id: "t2",
    title: "Review flashcard deck",
    workspaceName: "IB Physics HL",
    dueDate: new Date().toISOString(),
    priority: "medium",
    status: "pending",
  },
  {
    id: "t3",
    title: "Complete titration exercises",
    workspaceName: "Chemistry SL",
    dueDate: new Date(Date.now() + 86_400_000).toISOString(),
    priority: "medium",
    status: "pending",
  },
  {
    id: "t4",
    title: "Macbeth essay first draft",
    workspaceName: "English Literature",
    dueDate: new Date(Date.now() + 86_400_000 * 3).toISOString(),
    priority: "high",
    status: "pending",
  },
];

/* u2500u2500u2500 Main Workspace Page u2500u2500u2500 */

export default function WorkspacePage() {
  const {
    committedWorkspaceId,
    commitToWorkspace,
    setWorkspaces,
    workspaces,
    setFocusedItem,
    openDeepEdit,
    closeDeepEdit,
    toggleDeepEditLock,
    toggleDeepEditPin,
    deepEditTargets,
    closeAllDeepEdits,
  } = useWorkspaceStore();

  // Load demo data on mount
  useEffect(() => {
    setWorkspaces(DEMO_WORKSPACES);
  }, [setWorkspaces]);

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
      commitToWorkspace(id);
    },
    [commitToWorkspace],
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
      commitToWorkspace(workspaceId);
    },
    [commitToWorkspace],
  );

  const handleCanvasItemClick = useCallback(
    (itemId: string) => {
      const allItems = workspaces.flatMap((w) => w.items);
      const item = allItems.find((i) => i.id === itemId);
      if (item) handleItemClick(item);
    },
    [workspaces, handleItemClick],
  );

  // Command bar action handler — uses result card stack, not thread-first
  const pushResultCard = useWorkspaceStore.getState().pushResultCard;
  const updateResultCard = useWorkspaceStore.getState().updateResultCard;

  const handleSendMessage = useCallback((message: string) => {
    const cardId = `rc-${Date.now()}`;
    // Determine action type from message heuristic
    const actionType = message.startsWith("/")
      ? "created" as const
      : message.startsWith("?")
        ? "searched" as const
        : "answered" as const;

    // Push a loading result card
    pushResultCard({
      id: cardId,
      state: "loading",
      promptSnippet: message,
      actionType,
    });

    // Simulate completion after delay (will be replaced by real backend)
    setTimeout(() => {
      updateResultCard(cardId, {
        state: "done",
        summary: `AI processed: "${message.slice(0, 60)}${message.length > 60 ? "..." : ""}"`,
      });
    }, 1800);
  }, [pushResultCard, updateResultCard]);

  const noop = useCallback(() => {}, []);

  const handleTaskClick = useCallback(
    (taskId: string) => {
      const task = DEMO_PLANNER_TASKS.find((t) => t.id === taskId);
      if (task) {
        console.log("[workspace] Task clicked:", task.title);
      }
    },
    [],
  );

  const handleToggleTask = useCallback((taskId: string) => {
    console.log("[workspace] Toggle task:", taskId);
  }, []);

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
      {/* Continuous canvas u2014 always present, never replaced */}
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
            onTogglePin={() => toggleDeepEditPin(target.item.id)}
          />
        ))}
      </AnimatePresence>

      {/* Hub ecology: Left-edge planner (above dock) */}
      <PlannerEdge
        tasks={DEMO_PLANNER_TASKS}
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

      {/* Hub ecology: Bottom-center unified command bar with result cards */}
      <CommandBar
        workspaceName={committedWorkspace?.name}
        onSendMessage={handleSendMessage}
        onCreateNote={noop}
        onCreateCode={noop}
        onCreateVisual={noop}
        onCreateTask={noop}
        onCreateThread={noop}
        onCreateWithAi={noop}
      />

      {/* Hub ecology: Bottom-right timer */}
      <TimerWidget />
    </div>
  );
}
