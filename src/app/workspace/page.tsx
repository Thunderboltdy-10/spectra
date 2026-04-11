"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
import { TintZone } from "@/components/workspace/tint-zone";
import {
  GlanceCard,
  type GlanceCardData,
} from "@/components/workspace/glance-cards";
import { FocusPanel } from "@/components/workspace/focus-panel";
import type { WorkspaceData, WorkspaceItemData } from "@/lib/workspace/contracts";
import { TYPE_TO_TINT, TYPE_GROUP_LABELS } from "@/lib/workspace/contracts";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  LayoutGrid,
  Clock,
  Rows3,
  FileText,
  Search,
} from "lucide-react";

/* u2500u2500u2500 Demo Data (replaced by real queries in Wave 2) u2500u2500u2500 */

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

/* u2500u2500u2500 Committed Workspace Interior View u2500u2500u2500 */

function WorkspaceInterior({
  workspace,
  onBack,
  onItemClick,
  selectedItemId,
}: {
  workspace: WorkspaceData;
  onBack: () => void;
  onItemClick: (item: WorkspaceItemData) => void;
  selectedItemId: string | null;
}) {
  const viewMode = useWorkspaceStore((s) => s.viewMode);
  const setViewMode = useWorkspaceStore((s) => s.setViewMode);
  const [filterQuery, setFilterQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  // Group items by type
  const groups = useMemo(() => {
    const result: { key: string; label: string; variant: string; items: GlanceCardData[] }[] = [];
    for (const [key, group] of Object.entries(TYPE_GROUP_LABELS)) {
      let items = workspace.items
        .filter((i) => (group.types as readonly string[]).includes(i.itemType));

      // Apply text filter
      if (filterQuery.trim()) {
        const query = filterQuery.toLowerCase();
        items = items.filter((i) =>
          i.title.toLowerCase().includes(query) ||
          i.preview?.toLowerCase().includes(query),
        );
      }

      const glanceItems = items.map(
        (i): GlanceCardData => ({
          id: i.id,
          type: i.itemType as GlanceCardData["type"],
          title: i.title,
          preview: i.preview,
          status:
            i.status === "active"
              ? "active"
              : i.status === "completed"
                ? "completed"
                : "idle",
          meta: i.meta,
          updatedAt: i.updatedAt,
        }),
      );
      if (glanceItems.length > 0) {
        const tintVariant = TYPE_TO_TINT[group.types[0]];
        result.push({ key, label: group.label, variant: tintVariant, items: glanceItems });
      }
    }
    return result;
  }, [workspace.items, filterQuery]);

  // Keyboard navigation: Escape to exit workspace
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onBack();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack]);

  return (
    <motion.div
      className="flex h-full flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Interior header */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border-default)]/30 px-5">
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          aria-label="Back to all workspaces"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xl leading-none">{workspace.emoji}</span>
        <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
          {workspace.name}
        </h2>
        <span className="text-[11px] text-[var(--text-tertiary)]">
          {workspace.itemCount} items
        </span>

        {/* Search toggle */}
        <div className="ml-auto flex items-center gap-2">
          <div className={cn(
            "flex items-center gap-1.5 overflow-hidden rounded-xl border transition-all duration-200",
            filterOpen
              ? "w-[200px] border-[var(--border-default)]/60 bg-[var(--bg-secondary)] px-2.5 py-1.5"
              : "w-8 border-transparent",
          )}>
            <button
              type="button"
              onClick={() => setFilterOpen(!filterOpen)}
              className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
            {filterOpen && (
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Filter items..."
                className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
              />
            )}
          </div>

          {/* View mode tabs */}
          <div className="flex items-center gap-0.5 rounded-xl bg-[var(--bg-secondary)] p-0.5">
            {[
              { mode: "byType" as const, icon: LayoutGrid, label: "By Type" },
              { mode: "byTopic" as const, icon: Rows3, label: "By Topic" },
              { mode: "timeline" as const, icon: Clock, label: "Timeline" },
            ].map(({ mode, icon: ModeIcon, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all duration-150",
                  viewMode === mode
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_2px_6px_-4px_rgba(0,0,0,0.12)]"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
                )}
                aria-label={label}
              >
                <ModeIcon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Interior content with tint zones */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
          {groups.map((group, groupIdx) => (
            <motion.div
              key={group.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: groupIdx * 0.04 }}
            >
              <TintZone
                label={group.label}
                variant={group.variant as "warm" | "cool" | "neutral" | "accent" | "muted"}
                itemCount={group.items.length}
              >
                {group.items.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => {
                      const originalItem = workspace.items.find(
                        (i) => i.id === card.id,
                      );
                      if (originalItem) onItemClick(originalItem);
                    }}
                    className={cn(
                      "text-left transition-all duration-150",
                      selectedItemId === card.id && "ring-1 ring-[var(--accent-cyan)]/25 rounded-[16px]",
                    )}
                  >
                    <GlanceCard item={card} />
                  </button>
                ))}
              </TintZone>
            </motion.div>
          ))}

          {groups.length === 0 && (
            <div className="flex h-60 flex-col items-center justify-center text-center">
              <FileText className="mb-3 h-10 w-10 text-[var(--text-tertiary)] opacity-20" />
              <p className="text-[13px] text-[var(--text-tertiary)]">
                {filterQuery
                  ? "No items match your filter."
                  : "This workspace is empty. Use the command bar to create items."}
              </p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* u2500u2500u2500 Main Workspace Page u2500u2500u2500 */

export default function WorkspacePage() {
  const {
    committedWorkspaceId,
    commitToWorkspace,
    panelOpen,
    openPanel,
    closePanel,
    setWorkspaces,
    workspaces,
    setFocusedItem,
  } = useWorkspaceStore();

  const [selectedItem, setSelectedItem] = useState<WorkspaceItemData | null>(null);

  // Load demo data on mount (replaced by real Convex queries in Wave 2)
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
    closePanel();
    setSelectedItem(null);
    setFocusedItem(null);
  }, [commitToWorkspace, closePanel, setFocusedItem]);

  const handleItemClick = useCallback(
    (item: WorkspaceItemData) => {
      setSelectedItem(item);
      setFocusedItem(item.id);
      openPanel({
        type: item.itemType === "thread" ? "chat" : "artifact",
        id: item.id,
        workspaceId: item.workspaceId,
      });
    },
    [openPanel, setFocusedItem],
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

  // Command bar handlers (stubs for now, wire to real actions in Wave 2)
  const handleSendMessage = useCallback((message: string) => {
    console.log("[workspace] Quick chat:", message);
  }, []);

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

  // Handle panel close with item deselect
  const handlePanelClose = useCallback(() => {
    closePanel();
    setFocusedItem(null);
  }, [closePanel, setFocusedItem]);

  // Global keyboard: Escape to exit workspace or close panel
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (panelOpen) {
          handlePanelClose();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [panelOpen, handlePanelClose]);

  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-[var(--bg-primary)]">
      {/* Main content area */}
      <div
        className={cn(
          "flex flex-1 flex-col overflow-hidden transition-all duration-300",
          panelOpen && "mr-0",
        )}
      >
        <AnimatePresence mode="wait">
          {committedWorkspace ? (
            /* Interior view when committed to a workspace */
            <WorkspaceInterior
              key={committedWorkspace.id}
              workspace={committedWorkspace}
              onBack={handleBack}
              onItemClick={handleItemClick}
              selectedItemId={selectedItem?.id ?? null}
            />
          ) : (
            /* Canvas view showing all workspaces */
            <motion.div
              key="canvas"
              className="flex-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <WorkspaceCanvas
                onNodeClick={handleCanvasNodeClick}
                onItemClick={handleCanvasItemClick}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Right panel (deep edit / focus panel) */}
      <AnimatePresence>
        {panelOpen && selectedItem && (
          <FocusPanel
            item={selectedItem}
            onClose={handlePanelClose}
          />
        )}
      </AnimatePresence>

      {/* Hub: Left-edge workspace dock */}
      <WorkspaceDock
        workspaces={dockItems}
        onSelect={handleWorkspaceSelect}
        onCreateNew={noop}
      />

      {/* Hub: Bottom-center unified command bar */}
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

      {/* Hub: Bottom-right timer */}
      <TimerWidget />

      {/* Hub: Right-edge planner */}
      <PlannerEdge
        tasks={DEMO_PLANNER_TASKS}
        onTaskClick={handleTaskClick}
        onToggleTask={handleToggleTask}
      />
    </div>
  );
}
