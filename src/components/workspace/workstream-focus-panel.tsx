"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  Columns3,
  FileText,
  GitBranch,
  Layers,
  MessageSquare,
  Plus,
  Sparkles,
  StickyNote,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
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

const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

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
  if (!note) return "Open the note panel to keep writing inside the focused workspace.";
  const text = note.contentPlaintext?.trim();
  if (!text) return "This note is ready for drafting in any of the existing editor modes.";
  return text.slice(0, 180);
}

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
        if (active) {
          setChats(data.chats ?? []);
        }
      } catch {
        if (active) {
          setChats([]);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void run();
    return () => {
      active = false;
    };
  }, [workstreamId]);

  return {
    chats,
    loading,
  };
}

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
        onClose();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onRouteChange, resolvedPanel]);

  const stageItem = useMemo(() => {
    const upcoming = plannerItems.find((item) => item.status !== "completed");
    if (upcoming) {
      return {
        eyebrow: "Planner",
        title: upcoming.title,
        description: upcoming.description || "This item is the clearest next milestone in the workstream.",
      };
    }

    if (activeNote || notes[0]) {
      const note = activeNote ?? notes[0]!;
      return {
        eyebrow: "Notes",
        title: note.title,
        description: excerptFromNote(note),
      };
    }

    if (chats[0]) {
      return {
        eyebrow: "Threads",
        title: chats[0].title,
        description: chats[0].latestUserPrompt || "Resume the conversation from the right-side chat panel.",
      };
    }

    return {
      eyebrow: "Workspace",
      title: "Focus the work",
      description: "Use the stable layout grammar to keep notes, chat, artifacts, and planning inside one anchored state.",
    };
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
    const query = new URLSearchParams({
      from: "workspace",
      ws: workstream._id,
    });
    if (chatId) {
      query.set("chatId", chatId);
    }
    router.push(`/chat?${query.toString()}`);
  }, [router, workstream._id]);

  const handleOpenFullNote = useCallback((noteId: string) => {
    const query = new URLSearchParams({
      note: noteId,
      from: "workspace",
      ws: workstream._id,
    });
    router.push(`/notes?${query.toString()}`);
  }, [router, workstream._id]);

  return (
    <div className="absolute inset-0 z-50">
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24 }}
        style={{ background: "rgba(10, 12, 16, 0.28)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />

      <motion.div
        className="absolute overflow-hidden border border-[var(--border-default)] bg-[var(--bg-primary)]"
        initial={{
          left: startBounds.x,
          top: startBounds.y,
          width: startBounds.w,
          height: startBounds.h,
          borderRadius: 28,
          opacity: 0.96,
        }}
        animate={{
          left: 16,
          top: 16,
          width: containerBounds.w - 32,
          height: containerBounds.h - 32,
          borderRadius: 30,
          opacity: 1,
        }}
        transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        style={{
          boxShadow: `0 42px 110px -34px ${color.value}42`,
          background:
            "linear-gradient(180deg, color-mix(in oklab, var(--bg-elevated) 72%, white), color-mix(in oklab, var(--bg-primary) 92%, black))",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="absolute inset-x-0 top-0 h-[3px]"
          style={{ background: `linear-gradient(90deg, ${color.value}, color-mix(in oklab, ${color.value} 48%, transparent))` }}
        />

        <div className="flex h-full min-h-0 flex-col">
          <FocusTopBar
            workstream={workstream}
            activeView={focusView}
            activePanel={resolvedPanel}
            onClose={onClose}
            onOpenChat={openChatPanel}
            onChangeView={handleChangeView}
          />

          <div className="flex min-h-0 flex-1">
            <div className={cn("min-h-0 flex-1 overflow-y-auto", resolvedPanel && "border-r border-[var(--border-default)]")}>
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
            </div>

            {resolvedPanel === "chat" && (
              <WorkspaceDetailPanel title="Chat" onClose={closeDetailPanel}>
                <WorkspaceChatPanel
                  workstream={workstream}
                  initialDraft={initialQuery}
                  onOpenFull={handleOpenFullChat}
                />
              </WorkspaceDetailPanel>
            )}

            {resolvedPanel === "note" && (
              <WorkspaceDetailPanel
                title={activeNote?.title || "Note"}
                onClose={closeDetailPanel}
                onMaximize={activeNote ? () => handleOpenFullNote(activeNote._id) : undefined}
                maximizeLabel="Open full note"
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
                title="Artifacts"
                onClose={closeDetailPanel}
                onMaximize={() => handleOpenFullChat()}
                maximizeLabel="Open full chat"
              >
                <ArtifactPanelPlaceholder workstream={workstream} />
              </WorkspaceDetailPanel>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

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
    <div className="border-b border-[var(--border-default)] bg-[color:color-mix(in_oklab,var(--bg-elevated)_84%,transparent)] px-5 py-4 backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Map
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xl">{workstream.emoji || "📚"}</span>
            <h1 className="truncate font-display text-xl text-[var(--text-primary)]">
              {workstream.title}
            </h1>
            <span
              className="rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
              style={{ background: color.bg, color: color.value }}
            >
              {workstream.type}
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Route-backed focus state with stable workspace views and panel-first detail flows.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ViewToggle activeView={activeView} onChange={onChangeView} />
          <button
            type="button"
            onClick={onOpenChat}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-all",
              activePanel === "chat"
                ? "bg-[var(--accent-cyan)] text-white"
                : "border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
            )}
          >
            <MessageSquare className="h-4 w-4" />
            Chat
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] p-2 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            aria-label="Close focused workstream"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
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
    <div className="flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] p-1">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
              activeView === item.id
                ? "bg-[var(--accent-cyan)] text-white"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function StructuredView({
  workstream,
  chats,
  chatsLoading,
  notes,
  notesLoading,
  plannerItems,
  plannerLoading,
  stageItem,
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
  onOpenChat: () => void;
  onOpenNote: (noteId: string) => void;
  onCreateNote: () => void;
  onOpenFullChat: () => void;
  onViewChange: (view: WorkstreamView) => void;
}) {
  return (
    <div className="space-y-6 px-6 py-6">
      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.9fr]">
        <section className="overflow-hidden rounded-[28px] border border-[var(--border-default)] bg-[var(--bg-elevated)]">
          <div className="border-b border-[var(--border-default)] px-6 py-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              {stageItem.eyebrow}
            </div>
            <h2 className="mt-3 font-display text-3xl leading-tight text-[var(--text-primary)]">
              {stageItem.title}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
              {stageItem.description}
            </p>
          </div>

          <div className="grid gap-4 p-6 md:grid-cols-3">
            <ActionTile icon={MessageSquare} label="Threads" value={chats.length} helper="Continue the active conversation." onClick={onOpenChat} />
            <ActionTile icon={StickyNote} label="Notes" value={notes.length} helper="Open in panel first, maximize when needed." onClick={() => notes[0] ? onOpenNote(notes[0]._id) : onCreateNote()} />
            <ActionTile icon={GitBranch} label="Graph" value="View" helper="Switch to the relationship graph." onClick={() => onViewChange("graph")} />
          </div>
        </section>

        <section className="rounded-[28px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                Identity
              </div>
              <h3 className="mt-2 font-display text-xl text-[var(--text-primary)]">
                {workstream.title}
              </h3>
            </div>
            <Sparkles className="h-5 w-5 text-[var(--accent-cyan)]" />
          </div>

          <div className="mt-5 grid gap-3">
            <InfoRow label="Last active" value={formatRelativeTime(workstream.lastActivityAt)} />
            <InfoRow label="Default mode" value={workstream.defaultMode || "tutor"} />
            <InfoRow label="Panels" value="Chat, notes, artifacts" />
            <InfoRow label="Views" value="Structured, columns, graph" />
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ModuleCard
          title="Threads"
          icon={MessageSquare}
          actionLabel="Open chat"
          onAction={onOpenChat}
        >
          {chatsLoading ? (
            <PanelLoading label="Loading conversations" />
          ) : chats.length > 0 ? (
            <div className="space-y-3">
              {chats.slice(0, 3).map((chat) => (
                <button
                  key={chat._id}
                  type="button"
                  onClick={onOpenFullChat}
                  className="w-full rounded-2xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
                >
                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                    {chat.title}
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">
                    {chat.latestUserPrompt || "Resume the workstream conversation."}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <ModuleEmptyState
              icon="💬"
              title="No threads yet"
              description="The right-side chat panel is the primary entry point inside the focused workstream."
            />
          )}
        </ModuleCard>

        <ModuleCard
          title="Notes"
          icon={StickyNote}
          actionLabel="New note"
          onAction={onCreateNote}
        >
          {notesLoading ? (
            <PanelLoading label="Loading notes" />
          ) : notes.length > 0 ? (
            <div className="space-y-3">
              {notes.slice(0, 4).map((note) => (
                <NotePreviewCard key={note._id} note={note} onOpen={() => onOpenNote(note._id)} />
              ))}
            </div>
          ) : (
            <ModuleEmptyState
              icon="📝"
              title="No notes yet"
              description="Notes appear here as objects first, then open into the reusable side panel."
            />
          )}
        </ModuleCard>

        <ModuleCard title="Planner" icon={CalendarClock}>
          {plannerLoading ? (
            <PanelLoading label="Loading planner" />
          ) : plannerItems.length > 0 ? (
            <div className="space-y-3">
              {plannerItems.slice(0, 4).map((item) => (
                <PlannerCard key={item._id} item={item} />
              ))}
            </div>
          ) : (
            <ModuleEmptyState
              icon="📅"
              title="No deadlines yet"
              description="Planner items stay in the same layout grammar instead of becoming a separate tool."
            />
          )}
        </ModuleCard>

        <ModuleCard
          title="Artifacts"
          icon={FileText}
          actionLabel="Open detail panel"
          onAction={() => onViewChange("columns")}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <ArtifactCard title="Generated outputs" description="Artifacts remain durable underneath the workspace and open through the panel flow." />
            <ArtifactCard title="Relationship-ready" description="Use Graph view when the internal object network matters more than the fixed structure." />
          </div>
        </ModuleCard>
      </div>
    </div>
  );
}

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
  return (
    <div className="h-full overflow-x-auto px-6 py-6">
      <div className="grid min-w-[1100px] grid-cols-4 gap-4">
        <ColumnGroup title="Threads" icon={MessageSquare} actionLabel="Chat" onAction={onOpenChat}>
          {chats.length > 0 ? chats.map((chat) => (
            <ColumnCard key={chat._id} title={chat.title} description={chat.latestUserPrompt || "Continue the thread from the panel."} />
          )) : <ModuleEmptyState icon="💬" title="No threads" description="Open chat to create the first workstream conversation." />}
        </ColumnGroup>

        <ColumnGroup title="Notes" icon={StickyNote} actionLabel="New" onAction={onCreateNote}>
          {notes.length > 0 ? notes.map((note) => (
            <button key={note._id} type="button" onClick={() => onOpenNote(note._id)}>
              <ColumnCard title={note.title} description={excerptFromNote(note)} />
            </button>
          )) : <ModuleEmptyState icon="📝" title="No notes" description="Notes open in the right panel before they expand into the full notes area." />}
        </ColumnGroup>

        <ColumnGroup title="Planner" icon={CalendarClock}>
          {plannerItems.length > 0 ? plannerItems.map((item) => (
            <ColumnCard key={item._id} title={item.title} description={item.description || `${item.priority} priority ${item.type}`} />
          )) : <ModuleEmptyState icon="📅" title="Clear" description={`${workstream.title} does not have active planner items yet.`} />}
        </ColumnGroup>

        <ColumnGroup title="Artifacts" icon={FileText}>
          <ColumnCard title="Durable outputs" description="Artifacts stay durable underneath the workstream and use the same panel-maximize-return pattern." />
          <ColumnCard title="Adaptive modules" description="The column layout groups note, task, and artifact surfaces without inventing a new UI per workstream." />
        </ColumnGroup>
      </div>
    </div>
  );
}

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
  const nodes = useMemo<Node[]>(() => {
    const graphNodes: Node[] = [
      {
        id: "root",
        position: { x: 240, y: 180 },
        draggable: false,
        selectable: false,
        data: { label: workstream.title },
        style: {
          width: 220,
          borderRadius: 24,
          border: "1px solid var(--border-default)",
          background: "var(--bg-elevated)",
          color: "var(--text-primary)",
          fontWeight: 700,
          padding: 18,
          boxShadow: "var(--shadow-card)",
        },
      },
    ];

    notes.slice(0, 4).forEach((note, index) => {
      graphNodes.push({
        id: `note-${note._id}`,
        position: { x: 20, y: 40 + index * 108 },
        draggable: false,
        selectable: false,
        data: { label: note.title },
        style: graphNodeStyle("var(--accent-coral)"),
      });
    });

    chats.slice(0, 3).forEach((chat, index) => {
      graphNodes.push({
        id: `chat-${chat._id}`,
        position: { x: 520, y: 60 + index * 128 },
        draggable: false,
        selectable: false,
        data: { label: chat.title },
        style: graphNodeStyle("var(--accent-cyan)"),
      });
    });

    plannerItems.slice(0, 3).forEach((item, index) => {
      graphNodes.push({
        id: `planner-${item._id}`,
        position: { x: 250, y: 360 + index * 104 },
        draggable: false,
        selectable: false,
        data: { label: item.title },
        style: graphNodeStyle("var(--warning)"),
      });
    });

    return graphNodes;
  }, [chats, notes, plannerItems, workstream.title]);

  const edges = useMemo<Edge[]>(() => {
    const graphEdges: Edge[] = [];

    notes.slice(0, 4).forEach((note) => {
      graphEdges.push(graphEdge(`note-edge-${note._id}`, `note-${note._id}`, "root"));
    });
    chats.slice(0, 3).forEach((chat) => {
      graphEdges.push(graphEdge(`chat-edge-${chat._id}`, "root", `chat-${chat._id}`));
    });
    plannerItems.slice(0, 3).forEach((item) => {
      graphEdges.push(graphEdge(`planner-edge-${item._id}`, "root", `planner-${item._id}`));
    });

    return graphEdges;
  }, [chats, notes, plannerItems]);

  return (
    <div className="h-full overflow-hidden px-6 py-6">
      <div className="mb-4 max-w-2xl">
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          Internal graph
        </div>
        <h2 className="mt-2 font-display text-2xl text-[var(--text-primary)]">
          Relationships inside the focused workstream
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
          Graph view is secondary and visual. It reveals how notes, conversations, and planner items attach to the same workstream without replacing the stable structured layout.
        </p>
      </div>

      <div className="h-[calc(100%-6rem)] overflow-hidden rounded-[28px] border border-[var(--border-default)] bg-[var(--bg-elevated)]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodesDraggable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll
          zoomOnDoubleClick={false}
          fitView
          fitViewOptions={{ padding: 0.22 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border-default)" />
        </ReactFlow>
      </div>
    </div>
  );
}

function WorkspaceDetailPanel({
  title,
  onClose,
  onMaximize,
  maximizeLabel = "Open full view",
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
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="flex h-full w-[430px] shrink-0 flex-col bg-[color:color-mix(in_oklab,var(--bg-elevated)_90%,transparent)] backdrop-blur-xl"
    >
      <div className="flex items-center gap-2 border-b border-[var(--border-default)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {title}
          </div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            Panel first
          </div>
        </div>
        {onMaximize && (
          <button
            type="button"
            onClick={onMaximize}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            {maximizeLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-[var(--border-default)] p-2 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </motion.aside>
  );
}

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

  useEffect(() => {
    if (initialDraft) {
      setDraft(initialDraft);
    }
  }, [initialDraft]);

  const handleSend = useCallback(async () => {
    if (!draft.trim() || streaming) return;
    const text = draft;
    setDraft("");
    await sendMessage(text);
  }, [draft, sendMessage, streaming]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border-default)] px-4 py-3 text-xs text-[var(--text-secondary)]">
        Workstream-aware compact chat. Maximize keeps the return path back to `/workspace?focus={workstream._id}`.
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <ModuleEmptyState
            icon="✨"
            title={`Chat inside ${workstream.title}`}
            description="This is a real panel flow backed by workstream-aware chat creation, not a redirect shell."
          />
        )}
        {messages.map((message) => (
          <ChatBubble key={message.id} message={message} />
        ))}
        {streaming && (
          <div className="text-xs text-[var(--text-tertiary)]">
            {streamPhase === "routing" ? "Routing..." : streamPhase === "thinking" ? "Thinking..." : "Working..."}
          </div>
        )}
        {error && (
          <div className="rounded-2xl border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]">
            {error}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border-default)] p-4">
        <div className="rounded-[24px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
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
            className="min-h-[88px] w-full resize-none bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          />
          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => onOpenFull(chatId ?? undefined)}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Open full chat
            </button>
            <div className="flex items-center gap-2">
              {streaming && (
                <button
                  type="button"
                  onClick={stopGeneration}
                  className="rounded-full border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"
                >
                  Stop
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!draft.trim()}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-semibold transition-all",
                  draft.trim()
                    ? "bg-[var(--accent-cyan)] text-white"
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
      <ModuleEmptyState
        icon="📝"
        title="Choose a note"
        description="Open a note from the focused workstream first, then maximize it into the dedicated notes area when needed."
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border-default)] px-4 py-3">
        <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
          Editor mode
        </div>
        <div className="mt-2 flex gap-2">
          {(["simple", "notion", "agentic"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onModeChange(mode)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                editorMode === mode
                  ? "bg-[var(--accent-cyan)] text-white"
                  : "border border-[var(--border-default)] text-[var(--text-secondary)]",
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

function ArtifactPanelPlaceholder({ workstream }: { workstream: Workstream }) {
  return (
    <div className="space-y-4 px-4 py-4">
      <ModuleEmptyState
        icon="📄"
        title="Artifact details stay in the panel system"
        description={`Generated outputs for ${workstream.title} should open here first, then maximize into a richer full page when needed.`}
      />
    </div>
  );
}

function ActionTile({
  icon: Icon,
  label,
  value,
  helper,
  onClick,
}: {
  icon: typeof MessageSquare;
  label: string;
  value: string | number;
  helper: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[24px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-4 text-left transition-colors hover:bg-[var(--bg-hover)]"
    >
      <Icon className="h-4 w-4 text-[var(--accent-cyan)]" />
      <div className="mt-4 text-2xl font-semibold text-[var(--text-primary)]">
        {value}
      </div>
      <div className="mt-1 text-sm font-medium text-[var(--text-primary)]">
        {label}
      </div>
      <div className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
        {helper}
      </div>
    </button>
  );
}

function ModuleCard({
  title,
  icon: Icon,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  icon: typeof MessageSquare;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-[var(--accent-cyan)]" />
          <h3 className="font-display text-xl text-[var(--text-primary)]">
            {title}
          </h3>
        </div>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            <Plus className="h-3.5 w-3.5" />
            {actionLabel}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function ColumnGroup({
  title,
  icon: Icon,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  icon: typeof MessageSquare;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-[var(--accent-cyan)]" />
          <h3 className="font-display text-lg text-[var(--text-primary)]">
            {title}
          </h3>
        </div>
        {actionLabel && onAction && (
          <button type="button" onClick={onAction} className="text-xs text-[var(--text-secondary)]">
            {actionLabel}
          </button>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ColumnCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3 text-left">
      <div className="text-sm font-semibold text-[var(--text-primary)]">
        {title}
      </div>
      <div className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
        {description}
      </div>
    </div>
  );
}

function NotePreviewCard({
  note,
  onOpen,
}: {
  note: WorkspaceNote;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-[24px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-4 text-left transition-colors hover:bg-[var(--bg-hover)]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {note.title}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            {note.editorMode}
          </div>
        </div>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
        {excerptFromNote(note)}
      </p>
    </button>
  );
}

function PlannerCard({ item }: { item: PlannerItem }) {
  return (
    <div className="rounded-[24px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-[var(--text-primary)]">
          {item.title}
        </div>
        <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">
          {item.priority}
        </span>
      </div>
      <div className="mt-2 text-xs text-[var(--text-secondary)]">
        {item.description || `${item.type} · ${item.status.replace("_", " ")}`}
      </div>
      {item.dueAt && (
        <div className="mt-3 text-[11px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
          Due {formatRelativeTime(item.dueAt)}
        </div>
      )}
    </div>
  );
}

function ArtifactCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[24px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-4">
      <div className="text-sm font-semibold text-[var(--text-primary)]">
        {title}
      </div>
      <div className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
        {description}
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3">
      <span className="text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        {label}
      </span>
      <span className="text-sm font-medium text-[var(--text-primary)]">
        {value}
      </span>
    </div>
  );
}

function ModuleEmptyState({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-[var(--border-default)] bg-[var(--bg-primary)] px-6 py-8 text-center">
      <div className="text-3xl">{icon}</div>
      <div className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
        {title}
      </div>
      <div className="mt-2 max-w-sm text-xs leading-relaxed text-[var(--text-secondary)]">
        {description}
      </div>
    </div>
  );
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="rounded-[24px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-6 text-center text-xs text-[var(--text-secondary)]">
      {label}
    </div>
  );
}

function ChatBubble({ message }: { message: CompactMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[92%] rounded-[24px] px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "bg-[var(--accent-cyan)] text-white"
            : "border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)]",
        )}
      >
        {message.content || "Thinking..."}
      </div>
    </div>
  );
}

function graphNodeStyle(accent: string) {
  return {
    width: 180,
    borderRadius: 20,
    border: "1px solid var(--border-default)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    padding: 14,
    boxShadow: "var(--shadow-card)",
    boxSizing: "border-box" as const,
    borderLeft: `4px solid ${accent}`,
  };
}

function graphEdge(id: string, source: string, target: string): Edge {
  return {
    id,
    source,
    target,
    selectable: false,
    deletable: false,
    style: {
      stroke: "color-mix(in oklab, var(--accent-cyan) 38%, var(--border-default))",
      strokeWidth: 1.25,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "color-mix(in oklab, var(--accent-cyan) 38%, var(--border-default))",
      width: 16,
      height: 16,
    },
  };
}

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

  return (
    <div className="absolute inset-0 z-50">
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24 }}
        style={{ background: "rgba(10, 12, 16, 0.28)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />
      <motion.div
        className="absolute overflow-hidden rounded-[32px] border border-[var(--border-default)] bg-[var(--bg-elevated)]"
        initial={{ left: start.x, top: start.y, width: start.w, height: start.h }}
        animate={{ left: "50%", top: "50%", width: 520, height: 620, x: "-50%", y: "-50%" }}
        transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        style={{ boxShadow: "0 40px 110px -34px rgba(14, 142, 232, 0.45)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-full flex-col px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {userAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={userAvatar} alt="" className="h-12 w-12 rounded-full object-cover" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--accent-cyan),var(--accent-mint))] text-lg font-semibold text-white">
                  {(userName || "Y")[0]?.toUpperCase()}
                </div>
              )}
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                  Personal hub
                </div>
                <h2 className="mt-1 font-display text-2xl text-[var(--text-primary)]">
                  {userName}
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-[var(--border-default)] p-2 text-[var(--text-secondary)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-6 grid gap-4">
            <InfoRow label="Active workstreams" value={String(totalWorkstreams)} />
            <InfoRow label="Notes area" value="Dedicated /notes route" />
            <InfoRow label="Focus return" value="Route-backed workspace" />
          </div>

          <div className="mt-8 grid gap-4">
            <ModuleCard title="Cross-workstream notes" icon={StickyNote}>
              <ModuleEmptyState icon="🧠" title="Hub notes arrive here" description="The hub uses the same calm visual language as workstreams instead of behaving like a broken special object." />
            </ModuleCard>
            <ModuleCard title="Return paths" icon={ArrowUpRight}>
              <button
                type="button"
                onClick={() => router.push("/notes")}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-secondary)]"
              >
                Open notes area
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </ModuleCard>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
