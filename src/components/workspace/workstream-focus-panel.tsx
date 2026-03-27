"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  ChevronRight,
  Clock,
  Columns3,
  FileText,
  GitBranch,
  GripVertical,
  Layers,
  MessageSquare,
  Notebook,
  Plus,
  Sparkles,
  StickyNote,
  X,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { cn } from "@/lib/utils";
import { type CardBounds } from "@/stores/workspace-store";
import type { Workstream } from "@/hooks/use-workspace-data";
import { getWorkstreamColor } from "@/lib/workspace/zoom-helpers";
import { useCompactChat, type CompactMessage } from "@/hooks/use-compact-chat";
import { useNotesData, type WorkspaceNote } from "@/hooks/use-notes-data";
import { usePlannerData, type PlannerItem } from "@/hooks/use-planner-data";
import { useEditorStore, type EditorMode } from "@/stores/editor-store";

const TiptapEditor = dynamic(
  () => import("@/components/editor/tiptap-editor").then((module) => module.TiptapEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-48 items-center justify-center text-xs text-[var(--text-tertiary)]">
        Loading editor...
      </div>
    ),
  },
);

/* ─── Types ──────────────────────────────────────────────── */

type WorkstreamView = "structured" | "columns" | "graph";
type WorkspacePanelKind = "chat" | "note" | "artifact" | undefined;
type RouteHistoryMode = "push" | "replace";

type WorkstreamFocusPanelProps = {
  workstream: Workstream;
  cardBounds?: CardBounds;
  onClose: () => void;
  containerBounds: { w: number; h: number };
  focusView: WorkstreamView;
  activePanel?: string;
  activeNoteId?: string;
  initialChatOpen?: boolean;
  initialQuery?: string;
  onRouteChange: (updates: Record<string, string | undefined | null>, history?: RouteHistoryMode) => void;
};

type WorkstreamChatSummary = {
  _id: string;
  title: string;
  latestUserPrompt?: string;
  updatedAt: number;
  workstreamId?: string;
};

/* ─── Module System ──────────────────────────────────────── */

type ModuleType = "threads" | "notes" | "planner" | "artifacts" | "agents";

interface ModuleConfig {
  type: ModuleType;
  label: string;
  icon: typeof MessageSquare;
  visible: boolean;
  priority: number;
}

function getActiveModules(
  workstream: Workstream,
  chats: WorkstreamChatSummary[],
  notes: WorkspaceNote[],
  plannerItems: PlannerItem[],
): ModuleConfig[] {
  const modules: ModuleConfig[] = [
    {
      type: "threads",
      label: "Threads",
      icon: MessageSquare,
      visible: true,
      priority: chats.length > 0 ? 10 : 40,
    },
    {
      type: "notes",
      label: "Notes",
      icon: StickyNote,
      visible: true,
      priority: notes.length > 0 ? 15 : 45,
    },
    {
      type: "planner",
      label: "Planner",
      icon: CalendarClock,
      visible: true,
      priority: plannerItems.length > 0 ? 20 : 50,
    },
    {
      type: "artifacts",
      label: "Artifacts",
      icon: FileText,
      visible: (workstream.artifactCount ?? 0) > 0 || chats.length > 0,
      priority: 30,
    },
    {
      type: "agents",
      label: "Agent",
      icon: Zap,
      visible: Boolean(workstream.linkedAgentId),
      priority: 25,
    },
  ];

  return modules.filter((m) => m.visible).sort((a, b) => a.priority - b.priority);
}

/* ─── Constants ──────────────────────────────────────────── */

const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

const SPRING_ENTER = {
  type: "spring" as const,
  stiffness: 280,
  damping: 32,
  mass: 0.9,
};

const SPRING_EXIT = {
  type: "spring" as const,
  stiffness: 320,
  damping: 36,
  mass: 0.8,
};

/* ─── Helpers ────────────────────────────────────────────── */

function defaultBounds(containerBounds: { w: number; h: number }): CardBounds {
  return {
    x: Math.max(32, containerBounds.w / 2 - 220),
    y: Math.max(72, containerBounds.h / 2 - 140),
    w: Math.min(440, containerBounds.w - 64),
    h: Math.min(280, containerBounds.h - 144),
  };
}

function formatRelativeTime(timestamp?: number) {
  if (!timestamp) return "Fresh";
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  if (delta < 604_800_000) return `${Math.floor(delta / 86_400_000)}d ago`;
  return new Date(timestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function excerptFromNote(note?: WorkspaceNote | null) {
  if (!note) return "";
  const text = note.contentPlaintext?.trim();
  if (!text) return "Empty note — start writing to see a preview.";
  return text.slice(0, 160);
}

/* ─── Data hooks ─────────────────────────────────────────── */

function useWorkstreamChats(workstreamId: string) {
  const [chats, setChats] = useState<WorkstreamChatSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function run() {
      try {
        const response = await fetch(`/api/chats?workstreamId=${encodeURIComponent(workstreamId)}&limit=30`);
        if (!response.ok) throw new Error("Failed to load workstream chats");
        const data = (await response.json()) as { chats: WorkstreamChatSummary[] };
        if (active) setChats(data.chats ?? []);
      } catch {
        if (active) setChats([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    void run();
    return () => { active = false; };
  }, [workstreamId]);

  return { chats, loading };
}

/* ─── Main Focus Panel ───────────────────────────────────── */

export function WorkstreamFocusPanel({
  workstream,
  cardBounds,
  onClose,
  containerBounds,
  focusView,
  activePanel,
  activeNoteId,
  initialChatOpen,
  initialQuery,
  onRouteChange,
}: WorkstreamFocusPanelProps) {
  const router = useRouter();
  const color = getWorkstreamColor(workstream.color);
  const routePanel: WorkspacePanelKind =
    activePanel === "chat" || activePanel === "note" || activePanel === "artifact"
      ? activePanel
      : undefined;
  const resolvedPanel = routePanel ?? (initialChatOpen ? "chat" : undefined);
  const { chats, loading: chatsLoading } = useWorkstreamChats(workstream._id);
  const {
    notes,
    activeNote,
    loading: notesLoading,
    createNote,
    updateNote,
  } = useNotesData({
    workstreamId: workstream._id,
    noteId: activeNoteId,
  });
  const { plannerItems, loading: plannerLoading } = usePlannerData(workstream._id);
  const { editorMode, setEditorMode } = useEditorStore();
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (activeNote?.editorMode) {
      setEditorMode(activeNote.editorMode);
    }
  }, [activeNote?.editorMode, setEditorMode]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (resolvedPanel) {
          onRouteChange({ panel: undefined, note: undefined, prompt: undefined }, "replace");
          return;
        }
        handleCloseWithAnimation();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onRouteChange, resolvedPanel]);

  const stageItem = useMemo(() => {
    const upcoming = plannerItems.find((item) => item.status !== "completed");
    if (upcoming) {
      return { eyebrow: "Next up", title: upcoming.title, description: upcoming.description || "Upcoming milestone in this workstream." };
    }
    if (activeNote || notes[0]) {
      const note = activeNote ?? notes[0]!;
      return { eyebrow: "Active note", title: note.title, description: excerptFromNote(note) };
    }
    if (chats[0]) {
      return { eyebrow: "Last thread", title: chats[0].title, description: chats[0].latestUserPrompt || "Continue the conversation." };
    }
    return { eyebrow: "Ready", title: "Start working", description: "Open chat, create notes, or add planner items to this workstream." };
  }, [activeNote, chats, notes, plannerItems]);

  const startBounds = cardBounds ?? defaultBounds(containerBounds);

  const openChatPanel = useCallback(() => {
    onRouteChange({ panel: "chat", note: undefined, prompt: initialQuery ?? undefined }, "push");
  }, [initialQuery, onRouteChange]);

  const closeDetailPanel = useCallback(() => {
    onRouteChange({ panel: undefined, note: undefined, prompt: undefined }, "replace");
  }, [onRouteChange]);

  const handleChangeView = useCallback((view: WorkstreamView) => {
    onRouteChange({ view }, "replace");
  }, [onRouteChange]);

  const handleOpenNote = useCallback((noteId: string) => {
    onRouteChange({ panel: "note", note: noteId }, "push");
  }, [onRouteChange]);

  const handleCreateNote = useCallback(async () => {
    const noteId = await createNote({
      title: `${workstream.title} note`,
      content: EMPTY_DOC,
      contentPlaintext: "",
      editorMode: "notion",
      workstreamId: workstream._id,
    });
    onRouteChange({ panel: "note", note: noteId }, "push");
  }, [createNote, onRouteChange, workstream._id, workstream.title]);

  const handleOpenFullChat = useCallback((chatId?: string) => {
    const query = new URLSearchParams({ from: "workspace", ws: workstream._id });
    if (chatId) query.set("chatId", chatId);
    router.push(`/chat?${query.toString()}`);
  }, [router, workstream._id]);

  const handleOpenFullNote = useCallback((noteId: string) => {
    const query = new URLSearchParams({ note: noteId, from: "workspace", ws: workstream._id });
    router.push(`/notes?${query.toString()}`);
  }, [router, workstream._id]);

  const handleCloseWithAnimation = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onClose(), 380);
  }, [onClose]);

  const activeModules = useMemo(
    () => getActiveModules(workstream, chats, notes, plannerItems),
    [workstream, chats, notes, plannerItems],
  );

  return (
    <div className="absolute inset-0 z-50">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: isExiting ? 0 : 1 }}
        transition={{ duration: 0.32 }}
        style={{ background: "color-mix(in oklab, var(--bg-primary) 72%, transparent)", backdropFilter: "blur(12px)" }}
        onClick={handleCloseWithAnimation}
      />

      {/* Focus container — morphs from card bounds */}
      <motion.div
        className="absolute overflow-hidden bg-[var(--bg-primary)]"
        initial={{
          left: startBounds.x,
          top: startBounds.y,
          width: startBounds.w,
          height: startBounds.h,
          borderRadius: 28,
          opacity: 0.85,
          scale: 0.96,
        }}
        animate={isExiting ? {
          left: startBounds.x,
          top: startBounds.y,
          width: startBounds.w,
          height: startBounds.h,
          borderRadius: 28,
          opacity: 0,
          scale: 0.92,
        } : {
          left: 0,
          top: 0,
          width: containerBounds.w,
          height: containerBounds.h,
          borderRadius: 0,
          opacity: 1,
          scale: 1,
        }}
        transition={isExiting ? SPRING_EXIT : SPRING_ENTER}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Top accent line */}
        <motion.div
          className="absolute inset-x-0 top-0 z-10 h-[2px]"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: isExiting ? 0 : 1 }}
          transition={{ delay: 0.18, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          style={{
            background: `linear-gradient(90deg, transparent, ${color.value}, ${color.value}80, transparent)`,
            transformOrigin: "left",
          }}
        />

        {/* Subtle ambient glow */}
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background: `radial-gradient(ellipse 60% 40% at 20% 0%, ${color.value}18 0%, transparent 70%)`,
          }}
        />

        <div className="flex h-full min-h-0 flex-col">
          {/* Top bar */}
          <FocusTopBar
            workstream={workstream}
            activeView={focusView}
            activePanel={resolvedPanel}
            onClose={handleCloseWithAnimation}
            onOpenChat={openChatPanel}
            onChangeView={handleChangeView}
          />

          {/* Content + optional panel */}
          <div className="flex min-h-0 flex-1">
            <motion.div
              className="min-h-0 flex-1 overflow-y-auto"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.22, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              {focusView === "structured" ? (
                <StructuredView
                  workstream={workstream}
                  chats={chats}
                  chatsLoading={chatsLoading}
                  notes={notes}
                  notesLoading={notesLoading}
                  plannerItems={plannerItems}
                  plannerLoading={plannerLoading}
                  stageItem={stageItem}
                  activeModules={activeModules}
                  onOpenChat={openChatPanel}
                  onOpenNote={handleOpenNote}
                  onCreateNote={handleCreateNote}
                  onOpenFullChat={handleOpenFullChat}
                  onViewChange={handleChangeView}
                />
              ) : focusView === "columns" ? (
                <ColumnView
                  workstream={workstream}
                  chats={chats}
                  notes={notes}
                  plannerItems={plannerItems}
                  onOpenChat={openChatPanel}
                  onOpenNote={handleOpenNote}
                  onCreateNote={handleCreateNote}
                />
              ) : (
                <GraphWorkspaceView
                  workstream={workstream}
                  chats={chats}
                  notes={notes}
                  plannerItems={plannerItems}
                />
              )}
            </motion.div>

            {/* Right panel */}
            <AnimatePresence mode="wait">
              {resolvedPanel === "chat" && (
                <WorkspaceDetailPanel key="chat" title="Chat" onClose={closeDetailPanel}>
                  <WorkspaceChatPanel
                    workstream={workstream}
                    initialDraft={initialQuery}
                    onOpenFull={handleOpenFullChat}
                  />
                </WorkspaceDetailPanel>
              )}

              {resolvedPanel === "note" && (
                <WorkspaceDetailPanel
                  key="note"
                  title={activeNote?.title || "Note"}
                  onClose={closeDetailPanel}
                  onMaximize={activeNote ? () => handleOpenFullNote(activeNote._id) : undefined}
                  maximizeLabel="Open in /notes"
                >
                  <WorkspaceNotePanel
                    note={activeNote}
                    editorMode={editorMode}
                    onModeChange={setEditorMode}
                    onSave={async (content, text) => {
                      if (!activeNote) return;
                      await updateNote(activeNote._id, {
                        title: text.trim().split("\n")[0] || activeNote.title || "Untitled note",
                        content,
                        contentPlaintext: text,
                        editorMode,
                      });
                    }}
                  />
                </WorkspaceDetailPanel>
              )}

              {resolvedPanel === "artifact" && (
                <WorkspaceDetailPanel
                  key="artifact"
                  title="Artifacts"
                  onClose={closeDetailPanel}
                  onMaximize={() => handleOpenFullChat()}
                  maximizeLabel="Open full"
                >
                  <ArtifactPanelPlaceholder workstream={workstream} />
                </WorkspaceDetailPanel>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ─── Top Bar ────────────────────────────────────────────── */

function FocusTopBar({
  workstream,
  activeView,
  activePanel,
  onClose,
  onOpenChat,
  onChangeView,
}: {
  workstream: Workstream;
  activeView: WorkstreamView;
  activePanel?: WorkspacePanelKind;
  onClose: () => void;
  onOpenChat: () => void;
  onChangeView: (view: WorkstreamView) => void;
}) {
  const color = getWorkstreamColor(workstream.color);

  return (
    <motion.div
      className="flex items-center gap-3 border-b border-[var(--border-default)] px-5 py-3"
      style={{
        background: "color-mix(in oklab, var(--bg-elevated) 60%, transparent)",
        backdropFilter: "blur(16px)",
      }}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.12, duration: 0.3 }}
    >
      {/* Back */}
      <button
        type="button"
        onClick={onClose}
        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Map
      </button>

      <div className="h-4 w-px bg-[var(--border-default)]" />

      {/* Identity */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="text-lg">{workstream.emoji || "📚"}</span>
        <h1 className="truncate font-display text-base font-semibold text-[var(--text-primary)]">
          {workstream.title}
        </h1>
        <span
          className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: color.bg, color: color.value }}
        >
          {workstream.type}
        </span>
      </div>

      {/* View toggle */}
      <ViewToggle activeView={activeView} onChange={onChangeView} />

      {/* Chat toggle */}
      <button
        type="button"
        onClick={onOpenChat}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all",
          activePanel === "chat"
            ? "bg-[var(--accent-cyan)] text-white shadow-[0_2px_8px_-2px_rgba(14,142,232,0.4)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
        )}
      >
        <MessageSquare className="h-3.5 w-3.5" />
        Chat
      </button>

      {/* Close */}
      <button
        type="button"
        onClick={onClose}
        className="rounded-xl p-2 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.div>
  );
}

function ViewToggle({
  activeView,
  onChange,
}: {
  activeView: WorkstreamView;
  onChange: (view: WorkstreamView) => void;
}) {
  const items = [
    { id: "structured" as const, label: "Structured", icon: Layers },
    { id: "columns" as const, label: "Columns", icon: Columns3 },
    { id: "graph" as const, label: "Graph", icon: GitBranch },
  ];

  return (
    <div className="flex items-center gap-0.5 rounded-xl bg-[var(--bg-secondary)] p-0.5">
      {items.map((item) => {
        const Icon = item.icon;
        const active = activeView === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-200",
              active
                ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
            )}
          >
            <Icon className="h-3 w-3" />
            <span className="hidden sm:inline">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ─── STRUCTURED VIEW ────────────────────────────────────── */

function StructuredView({
  workstream,
  chats,
  chatsLoading,
  notes,
  notesLoading,
  plannerItems,
  plannerLoading,
  stageItem,
  activeModules,
  onOpenChat,
  onOpenNote,
  onCreateNote,
  onOpenFullChat,
  onViewChange,
}: {
  workstream: Workstream;
  chats: WorkstreamChatSummary[];
  chatsLoading: boolean;
  notes: WorkspaceNote[];
  notesLoading: boolean;
  plannerItems: PlannerItem[];
  plannerLoading: boolean;
  stageItem: { eyebrow: string; title: string; description: string };
  activeModules: ModuleConfig[];
  onOpenChat: () => void;
  onOpenNote: (noteId: string) => void;
  onCreateNote: () => void;
  onOpenFullChat: () => void;
  onViewChange: (view: WorkstreamView) => void;
}) {
  const color = getWorkstreamColor(workstream.color);

  return (
    <div className="h-full overflow-y-auto">
      {/* Main stage — no card wrapper */}
      <div className="border-b border-[var(--border-default)] px-8 py-8">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28, duration: 0.4 }}
        >
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            <div className="h-1.5 w-1.5 rounded-full" style={{ background: color.value }} />
            {stageItem.eyebrow}
          </div>
          <h2 className="mt-3 max-w-2xl font-display text-3xl leading-tight text-[var(--text-primary)]">
            {stageItem.title}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--text-secondary)]">
            {stageItem.description}
          </p>

          {/* Quick action strip */}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <QuickAction icon={MessageSquare} label={`${chats.length} threads`} onClick={onOpenChat} />
            <QuickAction icon={StickyNote} label={`${notes.length} notes`} onClick={() => notes[0] ? onOpenNote(notes[0]._id) : onCreateNote()} />
            <QuickAction icon={CalendarClock} label={`${plannerItems.filter((i) => i.status !== "completed").length} upcoming`} />
            <QuickAction icon={GitBranch} label="Graph" onClick={() => onViewChange("graph")} />
          </div>
        </motion.div>
      </div>

      {/* Adaptive modules — rendered from registry, not hard-coded */}
      <div className="px-8 py-6">
        <div className="grid gap-8 xl:grid-cols-2">
          {activeModules.map((mod, idx) => (
            <motion.div
              key={mod.type}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + idx * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              {mod.type === "threads" && (
                <ThreadsModule
                  chats={chats}
                  loading={chatsLoading}
                  onOpenChat={onOpenChat}
                  onOpenFullChat={onOpenFullChat}
                />
              )}
              {mod.type === "notes" && (
                <NotesModule
                  notes={notes}
                  loading={notesLoading}
                  onOpenNote={onOpenNote}
                  onCreateNote={onCreateNote}
                />
              )}
              {mod.type === "planner" && (
                <PlannerModule
                  items={plannerItems}
                  loading={plannerLoading}
                />
              )}
              {mod.type === "artifacts" && (
                <ArtifactsModule
                  workstream={workstream}
                  onViewChange={onViewChange}
                />
              )}
              {mod.type === "agents" && (
                <AgentModule workstream={workstream} />
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Quick Action Button (inline strip, not card) ──────── */

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof MessageSquare;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] active:scale-[0.97]"
    >
      <Icon className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
      {label}
    </button>
  );
}

/* ─── Module: Threads ────────────────────────────────────── */

function ThreadsModule({
  chats,
  loading,
  onOpenChat,
  onOpenFullChat,
}: {
  chats: WorkstreamChatSummary[];
  loading: boolean;
  onOpenChat: () => void;
  onOpenFullChat: () => void;
}) {
  return (
    <ModuleSection
      title="Threads"
      icon={MessageSquare}
      count={chats.length}
      actionLabel="New chat"
      onAction={onOpenChat}
    >
      {loading ? (
        <LoadingSkeleton lines={2} />
      ) : chats.length > 0 ? (
        <div className="space-y-1">
          {chats.slice(0, 4).map((chat, idx) => (
            <motion.button
              key={chat._id}
              type="button"
              onClick={() => onOpenFullChat()}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.04, duration: 0.25 }}
              className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all hover:bg-[var(--bg-hover)]"
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)] transition-colors group-hover:text-[var(--accent-cyan)]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-[var(--text-primary)]">
                  {chat.title}
                </div>
                {chat.latestUserPrompt && (
                  <div className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]">
                    {chat.latestUserPrompt}
                  </div>
                )}
              </div>
              <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">
                {formatRelativeTime(chat.updatedAt)}
              </span>
              <ChevronRight className="h-3 w-3 shrink-0 text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100" />
            </motion.button>
          ))}
        </div>
      ) : (
        <EmptyHint icon={MessageSquare} text="Open the chat panel to start a conversation." action="Start chat" onAction={onOpenChat} />
      )}
    </ModuleSection>
  );
}

/* ─── Module: Notes ──────────────────────────────────────── */

function NotesModule({
  notes,
  loading,
  onOpenNote,
  onCreateNote,
}: {
  notes: WorkspaceNote[];
  loading: boolean;
  onOpenNote: (noteId: string) => void;
  onCreateNote: () => void;
}) {
  return (
    <ModuleSection
      title="Notes"
      icon={StickyNote}
      count={notes.length}
      actionLabel="New note"
      onAction={onCreateNote}
    >
      {loading ? (
        <LoadingSkeleton lines={2} />
      ) : notes.length > 0 ? (
        <div className="space-y-1">
          {notes.slice(0, 5).map((note, idx) => (
            <motion.button
              key={note._id}
              type="button"
              onClick={() => onOpenNote(note._id)}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.04, duration: 0.25 }}
              className="group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-all hover:bg-[var(--bg-hover)]"
            >
              <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)] transition-colors group-hover:text-[var(--accent-coral)]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-[var(--text-primary)]">
                  {note.title}
                </div>
                <div className="mt-0.5 line-clamp-1 text-xs text-[var(--text-tertiary)]">
                  {excerptFromNote(note)}
                </div>
              </div>
              <span className="mt-0.5 shrink-0 rounded-md bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">
                {note.editorMode}
              </span>
            </motion.button>
          ))}
        </div>
      ) : (
        <EmptyHint icon={StickyNote} text="Create a note to begin drafting." action="New note" onAction={onCreateNote} />
      )}
    </ModuleSection>
  );
}

/* ─── Module: Planner ────────────────────────────────────── */

function PlannerModule({
  items,
  loading,
}: {
  items: PlannerItem[];
  loading: boolean;
}) {
  const pending = items.filter((i) => i.status !== "completed");
  const completed = items.filter((i) => i.status === "completed");

  return (
    <ModuleSection title="Planner" icon={CalendarClock} count={pending.length}>
      {loading ? (
        <LoadingSkeleton lines={2} />
      ) : items.length > 0 ? (
        <div className="space-y-1">
          {pending.slice(0, 5).map((item, idx) => (
            <motion.div
              key={item._id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.04, duration: 0.25 }}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5"
            >
              <div
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: item.priority === "high" ? "var(--danger)" : item.priority === "medium" ? "var(--warning)" : "var(--accent-mint)",
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-[var(--text-primary)]">
                  {item.title}
                </div>
                {item.dueAt && (
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
                    <Clock className="h-2.5 w-2.5" />
                    Due {formatRelativeTime(item.dueAt)}
                  </div>
                )}
              </div>
              <span className="rounded-md bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--text-tertiary)]">
                {item.priority}
              </span>
            </motion.div>
          ))}
          {completed.length > 0 && (
            <div className="mt-2 border-t border-[var(--border-default)] pt-2 text-xs text-[var(--text-tertiary)]">
              {completed.length} completed
            </div>
          )}
        </div>
      ) : (
        <EmptyHint icon={CalendarClock} text="No deadlines or milestones yet." />
      )}
    </ModuleSection>
  );
}

/* ─── Module: Artifacts ──────────────────────────────────── */

function ArtifactsModule({
  workstream,
  onViewChange,
}: {
  workstream: Workstream;
  onViewChange: (view: WorkstreamView) => void;
}) {
  const count = workstream.artifactCount ?? 0;

  return (
    <ModuleSection
      title="Artifacts"
      icon={FileText}
      count={count}
      actionLabel="Column view"
      onAction={() => onViewChange("columns")}
    >
      {count > 0 ? (
        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[var(--text-secondary)]">
          <FileText className="h-3.5 w-3.5 text-[var(--accent-mint)]" />
          {count} durable {count === 1 ? "artifact" : "artifacts"} in this workstream
        </div>
      ) : (
        <EmptyHint icon={FileText} text="Artifacts are auto-saved when AI generates outputs." />
      )}
    </ModuleSection>
  );
}

/* ─── Module: Agent ──────────────────────────────────────── */

function AgentModule({ workstream }: { workstream: Workstream }) {
  return (
    <ModuleSection title="Linked Agent" icon={Zap}>
      <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[var(--text-secondary)]">
        <Zap className="h-3.5 w-3.5 text-[var(--warning)]" />
        Agent attached to this workstream for domain-specific help.
      </div>
    </ModuleSection>
  );
}

/* ─── Module Section (shared shell — NOT a card) ─────────── */

function ModuleSection({
  title,
  icon: Icon,
  count,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  icon: typeof MessageSquare;
  count?: number;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-[var(--text-tertiary)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {title}
          </h3>
          {count !== undefined && count > 0 && (
            <span className="text-[10px] tabular-nums text-[var(--text-tertiary)]">
              {count}
            </span>
          )}
        </div>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex items-center gap-1 text-xs text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent-cyan)]"
          >
            <Plus className="h-3 w-3" />
            {actionLabel}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/* ─── COLUMNS VIEW ───────────────────────────────────────── */

function ColumnView({
  workstream,
  chats,
  notes,
  plannerItems,
  onOpenChat,
  onOpenNote,
  onCreateNote,
}: {
  workstream: Workstream;
  chats: WorkstreamChatSummary[];
  notes: WorkspaceNote[];
  plannerItems: PlannerItem[];
  onOpenChat: () => void;
  onOpenNote: (noteId: string) => void;
  onCreateNote: () => void;
}) {
  const pending = plannerItems.filter((i) => i.status !== "completed");
  const completed = plannerItems.filter((i) => i.status === "completed");

  return (
    <div className="h-full overflow-x-auto">
      <div className="grid h-full min-w-[960px] grid-cols-3 divide-x divide-[var(--border-default)]">
        {/* Column: Threads & Notes */}
        <div className="flex flex-col">
          <ColumnHeader title="Threads" count={chats.length} icon={MessageSquare} actionLabel="Chat" onAction={onOpenChat} />
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <div className="space-y-1.5">
              {chats.map((chat, idx) => (
                <motion.div
                  key={chat._id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.04, duration: 0.3 }}
                  className="group cursor-pointer rounded-xl px-3 py-3 transition-all hover:bg-[var(--bg-hover)]"
                  onClick={onOpenChat}
                >
                  <div className="text-sm font-medium text-[var(--text-primary)]">{chat.title}</div>
                  {chat.latestUserPrompt && (
                    <div className="mt-1 line-clamp-2 text-xs text-[var(--text-tertiary)]">{chat.latestUserPrompt}</div>
                  )}
                  <div className="mt-1.5 text-[10px] text-[var(--text-tertiary)]">{formatRelativeTime(chat.updatedAt)}</div>
                </motion.div>
              ))}
              {chats.length === 0 && (
                <EmptyHint icon={MessageSquare} text="No threads yet." action="Start chat" onAction={onOpenChat} />
              )}
            </div>
          </div>
        </div>

        {/* Column: Notes */}
        <div className="flex flex-col">
          <ColumnHeader title="Notes" count={notes.length} icon={StickyNote} actionLabel="New" onAction={onCreateNote} />
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <div className="space-y-1.5">
              {notes.map((note, idx) => (
                <motion.button
                  key={note._id}
                  type="button"
                  onClick={() => onOpenNote(note._id)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.04, duration: 0.3 }}
                  className="group w-full cursor-pointer rounded-xl px-3 py-3 text-left transition-all hover:bg-[var(--bg-hover)]"
                >
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-[var(--text-primary)]">{note.title}</div>
                    <span className="rounded-md bg-[var(--bg-secondary)] px-1 py-0.5 text-[9px] text-[var(--text-tertiary)]">{note.editorMode}</span>
                  </div>
                  <div className="mt-1 line-clamp-3 text-xs leading-relaxed text-[var(--text-tertiary)]">
                    {excerptFromNote(note)}
                  </div>
                </motion.button>
              ))}
              {notes.length === 0 && (
                <EmptyHint icon={StickyNote} text="No notes yet." action="New note" onAction={onCreateNote} />
              )}
            </div>
          </div>
        </div>

        {/* Column: Planner */}
        <div className="flex flex-col">
          <ColumnHeader title="Planner" count={pending.length} icon={CalendarClock} />
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {pending.length > 0 && (
              <div className="mb-3">
                <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Active</div>
                <div className="space-y-1.5">
                  {pending.map((item, idx) => (
                    <motion.div
                      key={item._id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.04, duration: 0.3 }}
                      className="rounded-xl px-3 py-3"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2 w-2 rounded-full"
                          style={{
                            background: item.priority === "high" ? "var(--danger)" : item.priority === "medium" ? "var(--warning)" : "var(--accent-mint)",
                          }}
                        />
                        <div className="text-sm font-medium text-[var(--text-primary)]">{item.title}</div>
                      </div>
                      {item.dueAt && (
                        <div className="mt-1 flex items-center gap-1 pl-4 text-[10px] text-[var(--text-tertiary)]">
                          <Clock className="h-2.5 w-2.5" />
                          Due {formatRelativeTime(item.dueAt)}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
            {completed.length > 0 && (
              <div>
                <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Done</div>
                <div className="space-y-1">
                  {completed.slice(0, 5).map((item) => (
                    <div key={item._id} className="rounded-xl px-3 py-2 text-sm text-[var(--text-tertiary)] line-through">
                      {item.title}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {plannerItems.length === 0 && (
              <EmptyHint icon={CalendarClock} text="No planner items yet." />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ColumnHeader({
  title,
  count,
  icon: Icon,
  actionLabel,
  onAction,
}: {
  title: string;
  count: number;
  icon: typeof MessageSquare;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">{title}</span>
        <span className="text-[10px] tabular-nums text-[var(--text-tertiary)]">{count}</span>
      </div>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="text-xs text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent-cyan)]">
          + {actionLabel}
        </button>
      )}
    </div>
  );
}

/* ─── GRAPH VIEW ─────────────────────────────────────────── */

function GraphWorkspaceView({
  workstream,
  chats,
  notes,
  plannerItems,
}: {
  workstream: Workstream;
  chats: WorkstreamChatSummary[];
  notes: WorkspaceNote[];
  plannerItems: PlannerItem[];
}) {
  const color = getWorkstreamColor(workstream.color);

  const nodes = useMemo<Node[]>(() => {
    const graphNodes: Node[] = [
      {
        id: "root",
        position: { x: 300, y: 220 },
        draggable: true,
        selectable: false,
        data: { label: workstream.title },
        style: {
          width: 200,
          borderRadius: 16,
          border: `2px solid ${color.value}`,
          background: "var(--bg-elevated)",
          color: "var(--text-primary)",
          fontWeight: 700,
          fontSize: 14,
          padding: "14px 16px",
          boxShadow: `0 8px 24px -8px ${color.value}30`,
        },
      },
    ];

    const noteRadius = 220;
    notes.slice(0, 6).forEach((note, index) => {
      const angle = (-Math.PI / 2) + (index / Math.max(notes.length, 1)) * Math.PI;
      graphNodes.push({
        id: `note-${note._id}`,
        position: {
          x: 300 + Math.cos(angle) * noteRadius - 80,
          y: 220 + Math.sin(angle) * noteRadius - 20,
        },
        draggable: true,
        selectable: false,
        data: { label: note.title },
        style: graphNodeStyle("var(--accent-coral)"),
      });
    });

    const chatRadius = 240;
    chats.slice(0, 4).forEach((chat, index) => {
      const angle = (Math.PI / 2) + (index / Math.max(chats.length, 1)) * Math.PI * 0.8;
      graphNodes.push({
        id: `chat-${chat._id}`,
        position: {
          x: 300 + Math.cos(angle) * chatRadius - 80,
          y: 220 + Math.sin(angle) * chatRadius - 20,
        },
        draggable: true,
        selectable: false,
        data: { label: chat.title },
        style: graphNodeStyle("var(--accent-cyan)"),
      });
    });

    plannerItems.slice(0, 4).forEach((item, index) => {
      const angle = Math.PI + (index / Math.max(plannerItems.length, 1)) * Math.PI * 0.6;
      graphNodes.push({
        id: `planner-${item._id}`,
        position: {
          x: 300 + Math.cos(angle) * 200 - 80,
          y: 220 + Math.sin(angle) * 200 - 20,
        },
        draggable: true,
        selectable: false,
        data: { label: item.title },
        style: graphNodeStyle("var(--warning)"),
      });
    });

    return graphNodes;
  }, [chats, color.value, notes, plannerItems, workstream.title]);

  const edges = useMemo<Edge[]>(() => {
    const graphEdges: Edge[] = [];
    notes.slice(0, 6).forEach((note) => {
      graphEdges.push(graphEdge(`note-edge-${note._id}`, `note-${note._id}`, "root", "var(--accent-coral)"));
    });
    chats.slice(0, 4).forEach((chat) => {
      graphEdges.push(graphEdge(`chat-edge-${chat._id}`, "root", `chat-${chat._id}`, "var(--accent-cyan)"));
    });
    plannerItems.slice(0, 4).forEach((item) => {
      graphEdges.push(graphEdge(`planner-edge-${item._id}`, "root", `planner-${item._id}`, "var(--warning)"));
    });
    return graphEdges;
  }, [chats, notes, plannerItems]);

  const totalItems = notes.length + chats.length + plannerItems.length;

  return (
    <div className="flex h-full flex-col">
      {/* Graph header */}
      <div className="border-b border-[var(--border-default)] px-8 py-4">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.3 }}
          className="flex items-center justify-between"
        >
          <div>
            <h2 className="font-display text-lg text-[var(--text-primary)]">
              Relationship graph
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
              {totalItems} {totalItems === 1 ? "item" : "items"} connected to this workstream
            </p>
          </div>
          <div className="flex items-center gap-4 text-[10px] text-[var(--text-tertiary)]">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--accent-coral)]" /> Notes
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--accent-cyan)]" /> Threads
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--warning)]" /> Planner
            </span>
          </div>
        </motion.div>
      </div>

      {/* Graph canvas */}
      <div className="flex-1 overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodesDraggable
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll
          zoomOnDoubleClick={false}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.4}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={0.8} color="color-mix(in oklab, var(--border-default) 60%, transparent)" />
        </ReactFlow>
      </div>
    </div>
  );
}

/* ─── Right Panel Shell ──────────────────────────────────── */

function WorkspaceDetailPanel({
  title,
  onClose,
  onMaximize,
  maximizeLabel = "Open full",
  children,
}: {
  title: string;
  onClose: () => void;
  onMaximize?: () => void;
  maximizeLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 420, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 34 }}
      className="flex h-full shrink-0 flex-col overflow-hidden border-l border-[var(--border-default)]"
      style={{
        background: "color-mix(in oklab, var(--bg-elevated) 80%, transparent)",
        backdropFilter: "blur(16px)",
      }}
    >
      {/* Panel header */}
      <div className="flex items-center gap-2 border-b border-[var(--border-default)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</div>
        </div>
        {onMaximize && (
          <button
            type="button"
            onClick={onMaximize}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <ArrowUpRight className="h-3 w-3" />
            {maximizeLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </motion.aside>
  );
}

/* ─── Chat Panel ─────────────────────────────────────────── */

function WorkspaceChatPanel({
  workstream,
  initialDraft,
  onOpenFull,
}: {
  workstream: Workstream;
  initialDraft?: string;
  onOpenFull: (chatId?: string) => void;
}) {
  const { chatId, messages, streaming, streamPhase, error, sendMessage, stopGeneration } = useCompactChat(workstream._id);
  const [draft, setDraft] = useState(initialDraft ?? "");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialDraft) setDraft(initialDraft);
  }, [initialDraft]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming]);

  const handleSend = useCallback(async () => {
    if (!draft.trim() || streaming) return;
    const text = draft;
    setDraft("");
    await sendMessage(text);
  }, [draft, sendMessage, streaming]);

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Sparkles className="h-6 w-6 text-[var(--accent-cyan)] opacity-60" />
            <p className="mt-3 text-sm text-[var(--text-secondary)]">Ask anything about {workstream.title}</p>
          </div>
        )}
        <AnimatePresence mode="popLayout">
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.25 }}
            >
              <ChatBubble message={message} />
            </motion.div>
          ))}
        </AnimatePresence>
        {streaming && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 px-1 text-xs text-[var(--text-tertiary)]"
          >
            <div className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent-cyan)]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent-cyan)] [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent-cyan)] [animation-delay:300ms]" />
            </div>
            {streamPhase === "routing" ? "Routing..." : streamPhase === "thinking" ? "Thinking..." : "Writing..."}
          </motion.div>
        )}
        {error && (
          <div className="rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/8 px-3 py-2 text-xs text-[var(--danger)]">
            {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-[var(--border-default)] p-3">
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-primary)] transition-shadow focus-within:shadow-[0_0_0_2px_var(--accent-cyan)20]">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Ask about this workstream..."
            rows={3}
            className="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          />
          <div className="flex items-center justify-between px-3 pb-2">
            <button
              type="button"
              onClick={() => onOpenFull(chatId ?? undefined)}
              className="text-[10px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
            >
              Open full chat
            </button>
            <div className="flex items-center gap-1.5">
              {streaming && (
                <button
                  type="button"
                  onClick={stopGeneration}
                  className="rounded-lg px-2 py-1 text-[10px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)]"
                >
                  Stop
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!draft.trim()}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                  draft.trim()
                    ? "bg-[var(--accent-cyan)] text-white shadow-[0_2px_8px_-2px_rgba(14,142,232,0.3)] hover:brightness-110"
                    : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]",
                )}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Note Panel ─────────────────────────────────────────── */

function WorkspaceNotePanel({
  note,
  editorMode,
  onModeChange,
  onSave,
}: {
  note: WorkspaceNote | null;
  editorMode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onSave: (content: object, text: string) => Promise<void>;
}) {
  if (!note) {
    return (
      <EmptyHint icon={StickyNote} text="Select a note from the workstream to edit it here." />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border-default)] px-4 py-2.5">
        <div className="flex gap-1">
          {(["simple", "notion", "agentic"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onModeChange(mode)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all",
                editorMode === mode
                  ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <TiptapEditor
          noteId={note._id}
          content={note.content}
          onSave={(content, text) => void onSave(content, text)}
          className="h-full"
        />
      </div>
    </div>
  );
}

/* ─── Artifact Panel Placeholder ─────────────────────────── */

function ArtifactPanelPlaceholder({ workstream }: { workstream: Workstream }) {
  return (
    <div className="px-4 py-8">
      <EmptyHint icon={FileText} text={`Generated artifacts for ${workstream.title} will appear here.`} />
    </div>
  );
}

/* ─── Shared primitives ──────────────────────────────────── */

function ChatBubble({ message }: { message: CompactMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-[var(--accent-cyan)] text-white"
            : "bg-[var(--bg-primary)] text-[var(--text-primary)]",
        )}
      >
        {message.content || "..."}
      </div>
    </div>
  );
}

function EmptyHint({
  icon: Icon,
  text,
  action,
  onAction,
}: {
  icon: typeof MessageSquare;
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-4 text-xs text-[var(--text-tertiary)]">
      <Icon className="h-4 w-4 shrink-0 opacity-40" />
      <span className="flex-1">{text}</span>
      {action && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 text-[var(--accent-cyan)] transition-colors hover:underline"
        >
          {action}
        </button>
      )}
    </div>
  );
}

function LoadingSkeleton({ lines }: { lines: number }) {
  return (
    <div className="space-y-2 px-3">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-10 animate-pulse rounded-lg bg-[var(--bg-secondary)]"
          style={{ animationDelay: `${i * 100}ms`, width: `${85 - i * 10}%` }}
        />
      ))}
    </div>
  );
}

function graphNodeStyle(accent: string) {
  return {
    width: 170,
    borderRadius: 14,
    border: "1px solid var(--border-default)",
    borderLeft: `3px solid ${accent}`,
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: 12,
    padding: "10px 12px",
    boxShadow: "0 2px 8px -2px rgba(0,0,0,0.08)",
  };
}

function graphEdge(id: string, source: string, target: string, accent: string = "var(--accent-cyan)"): Edge {
  return {
    id,
    source,
    target,
    selectable: false,
    deletable: false,
    style: {
      stroke: `color-mix(in oklab, ${accent} 50%, var(--border-default))`,
      strokeWidth: 1.5,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: `color-mix(in oklab, ${accent} 50%, var(--border-default))`,
      width: 14,
      height: 14,
    },
  };
}

/* ─── Hub Focus Panel ────────────────────────────────────── */

interface HubFocusPanelProps {
  cardBounds?: CardBounds;
  userName: string;
  userAvatar: string;
  totalWorkstreams: number;
  onClose: () => void;
}

export function HubFocusPanel({
  cardBounds,
  userName,
  userAvatar,
  totalWorkstreams,
  onClose,
}: HubFocusPanelProps) {
  const router = useRouter();
  const start = cardBounds ?? { x: 120, y: 120, w: 220, h: 220 };
  const [isExiting, setIsExiting] = useState(false);
  const [activeTab, setActiveTab] = useState<"notes" | "planner" | "memory" | "recent">("notes");

  const handleClose = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onClose(), 350);
  }, [onClose]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose]);

  const tabs = [
    { id: "notes" as const, label: "Notes", icon: StickyNote },
    { id: "planner" as const, label: "Planner", icon: CalendarClock },
    { id: "memory" as const, label: "Memory", icon: Sparkles },
    { id: "recent" as const, label: "Recent", icon: Clock },
  ];

  return (
    <div className="absolute inset-0 z-50">
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: isExiting ? 0 : 1 }}
        transition={{ duration: 0.3 }}
        style={{ background: "color-mix(in oklab, var(--bg-primary) 72%, transparent)", backdropFilter: "blur(12px)" }}
        onClick={handleClose}
      />
      <motion.div
        className="absolute overflow-hidden bg-[var(--bg-primary)]"
        initial={{
          left: start.x,
          top: start.y,
          width: start.w,
          height: start.h,
          borderRadius: 32,
          opacity: 0.85,
          scale: 0.96,
        }}
        animate={isExiting ? {
          left: start.x,
          top: start.y,
          width: start.w,
          height: start.h,
          borderRadius: 32,
          opacity: 0,
          scale: 0.9,
        } : {
          left: "10%",
          top: "5%",
          width: "80%",
          height: "90%",
          borderRadius: 24,
          opacity: 1,
          scale: 1,
        }}
        transition={isExiting ? SPRING_EXIT : SPRING_ENTER}
        style={{ boxShadow: "0 40px 120px -40px rgba(14, 142, 232, 0.25)" }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Top accent */}
        <motion.div
          className="absolute inset-x-0 top-0 z-10 h-[2px]"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: isExiting ? 0 : 1 }}
          transition={{ delay: 0.18, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          style={{ background: "linear-gradient(90deg, transparent, var(--accent-cyan), var(--accent-mint), transparent)", transformOrigin: "center" }}
        />

        <div className="flex h-full flex-col">
          {/* Hub header */}
          <motion.div
            className="flex items-center gap-4 border-b border-[var(--border-default)] px-6 py-4"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.3 }}
          >
            {userAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={userAvatar} alt="" className="h-10 w-10 rounded-full object-cover ring-2 ring-[var(--accent-cyan)]/20" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--accent-cyan),var(--accent-mint))] text-base font-semibold text-white">
                {(userName || "Y")[0]?.toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-lg text-[var(--text-primary)]">{userName}</h2>
              <p className="text-xs text-[var(--text-tertiary)]">
                Personal hub · {totalWorkstreams} active {totalWorkstreams === 1 ? "workstream" : "workstreams"}
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-xl p-2 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>

          {/* Tabs */}
          <div className="flex items-center gap-1 border-b border-[var(--border-default)] px-6 py-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all",
                    activeTab === tab.id
                      ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                      : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                {activeTab === "notes" && (
                  <HubSection
                    title="Quick Notes"
                    description="Unattached notes and inbox items across all workstreams."
                    icon={StickyNote}
                    actionLabel="Open /notes"
                    onAction={() => router.push("/notes")}
                  >
                    <EmptyHint icon={Notebook} text="Quick notes you create here will appear across workstreams." action="Open notes" onAction={() => router.push("/notes")} />
                  </HubSection>
                )}
                {activeTab === "planner" && (
                  <HubSection
                    title="Cross-Workstream Planner"
                    description="Upcoming deadlines and milestones from all your workstreams."
                    icon={CalendarClock}
                  >
                    <EmptyHint icon={CalendarClock} text="Planner items from all workstreams will aggregate here." />
                  </HubSection>
                )}
                {activeTab === "memory" && (
                  <HubSection
                    title="Personal Memory"
                    description="What Spectra remembers about you across all your work."
                    icon={Sparkles}
                  >
                    <EmptyHint icon={Sparkles} text="Memory entries build up as you work with Spectra across workstreams." />
                  </HubSection>
                )}
                {activeTab === "recent" && (
                  <HubSection
                    title="Recent Activity"
                    description="Your latest actions across all workstreams."
                    icon={Clock}
                  >
                    <EmptyHint icon={Clock} text="Recent threads, notes, and artifacts will appear here." />
                  </HubSection>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function HubSection({
  title,
  description,
  icon: Icon,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  description: string;
  icon: typeof MessageSquare;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-[var(--accent-cyan)]" />
            <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
          </div>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">{description}</p>
        </div>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <ArrowUpRight className="h-3 w-3" />
            {actionLabel}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
