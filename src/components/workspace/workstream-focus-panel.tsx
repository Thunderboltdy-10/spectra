"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  FileText,
  Layers,
  MessageSquare,
  Plus,
  StickyNote,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type CardBounds } from "@/stores/workspace-store";
import type { Workstream } from "@/hooks/use-workspace-data";
import { getWorkstreamColor } from "@/lib/workspace/zoom-helpers";
import { useCompactChat, type CompactMessage } from "@/hooks/use-compact-chat";

const TiptapEditor = dynamic(
  () => import("@/components/editor/tiptap-editor").then((m) => m.TiptapEditor),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-40 text-xs text-[var(--text-tertiary)]">Loading editor…</div> },
);

// ─── Types ─────────────────────────────────────────────────────────────────

type PanelSection = "overview" | "chat" | "notes" | "artifacts" | "planner";

// ─── Animation helpers ──────────────────────────────────────────────────────

function boundsToCSS(bounds: CardBounds) {
  return {
    left: bounds.x,
    top: bounds.y,
    width: bounds.w,
    height: bounds.h,
    borderRadius: 18,
  };
}

// ─── Main panel ────────────────────────────────────────────────────────────

interface WorkstreamFocusPanelProps {
  workstream: Workstream;
  cardBounds: CardBounds;
  onClose: () => void;
  containerBounds: { w: number; h: number };
  initialChatOpen?: boolean;
  initialQuery?: string;
}

export function WorkstreamFocusPanel({
  workstream,
  cardBounds,
  onClose,
  containerBounds,
  initialChatOpen,
  initialQuery,
}: WorkstreamFocusPanelProps) {
  const router = useRouter();
  const [entered, setEntered] = useState(false);
  const [activeSection, setActiveSection] = useState<PanelSection>("overview");
  const [chatOpen, setChatOpen] = useState(initialChatOpen ?? false);
  const panelRef = useRef<HTMLDivElement>(null);
  const c = getWorkstreamColor(workstream.color);

  // Enter animation: first render uses card bounds, then immediately animate to full
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setEntered(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Escape key to close
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const handleOpenFullChat = useCallback(() => {
    router.push(
      `/chat?from=workspace&ws=${encodeURIComponent(workstream._id)}`,
    );
  }, [router, workstream._id]);

  // Animated container: starts at card position, expands to full
  const panelStyle = entered
    ? {
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
        borderRadius: 0,
      }
    : boundsToCSS(cardBounds);

  return (
    // Backdrop — click outside to close
    <div
      className="absolute inset-0 z-50"
      onClick={handleBackdropClick}
      style={{
        background: entered ? "rgba(0,0,0,0.4)" : "transparent",
        backdropFilter: entered ? "blur(2px)" : "none",
        transition: "background 380ms cubic-bezier(0.22,1,0.36,1), backdrop-filter 380ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      {/* The expanding panel */}
      <div
        ref={panelRef}
        style={{
          position: "absolute",
          ...panelStyle,
          background: "var(--bg-primary, #13111a)",
          overflow: "hidden",
          transition: entered
            ? "left 380ms cubic-bezier(0.22,1,0.36,1), top 380ms cubic-bezier(0.22,1,0.36,1), width 380ms cubic-bezier(0.22,1,0.36,1), height 380ms cubic-bezier(0.22,1,0.36,1), border-radius 380ms cubic-bezier(0.22,1,0.36,1)"
            : "none",
          display: "flex",
          flexDirection: "column",
          boxShadow: entered
            ? "0 0 0 1px var(--border-default, #2d2a3a), 0 32px 80px -16px rgba(0,0,0,0.5)"
            : "none",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Color accent bar */}
        <div
          style={{
            height: 3,
            background: `linear-gradient(90deg, ${c.value}, ${c.value}60)`,
            flexShrink: 0,
            opacity: entered ? 1 : 0,
            transition: "opacity 400ms cubic-bezier(0.22,1,0.36,1) 200ms",
          }}
        />

        {/* Header */}
        <PanelHeader
          workstream={workstream}
          onClose={onClose}
          onOpenFullChat={handleOpenFullChat}
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          chatOpen={chatOpen}
          onToggleChat={() => setChatOpen((v) => !v)}
          entered={entered}
        />

        {/* Body */}
        <div
          className="flex flex-1 min-h-0"
          style={{
            opacity: entered ? 1 : 0,
            transform: entered ? "translateY(0)" : "translateY(12px)",
            transition: "opacity 350ms cubic-bezier(0.22,1,0.36,1) 180ms, transform 350ms cubic-bezier(0.22,1,0.36,1) 180ms",
          }}
        >
          {/* Left sidebar — workstream sections */}
          <WorkstreamSidebar
            workstream={workstream}
            activeSection={activeSection}
            onSectionChange={setActiveSection}
          />

          {/* Main content area */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
            <MainContent
              workstream={workstream}
              activeSection={activeSection}
              onSectionChange={setActiveSection}
              chatOpen={chatOpen}
              onOpenFullChat={handleOpenFullChat}
              onToggleChat={() => setChatOpen((v) => !v)}
            />
          </div>

          {/* Chat panel — slides in from right */}
          {chatOpen && (
            <CompactChatDrawer
              workstream={workstream}
              onClose={() => setChatOpen(false)}
              onOpenFull={handleOpenFullChat}
              initialDraft={initialQuery}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Panel Header ───────────────────────────────────────────────────────────

function PanelHeader({
  workstream,
  onClose,
  onOpenFullChat,
  activeSection,
  onSectionChange,
  chatOpen,
  onToggleChat,
  entered,
}: {
  workstream: Workstream;
  onClose: () => void;
  onOpenFullChat: () => void;
  activeSection: PanelSection;
  onSectionChange: (s: PanelSection) => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  entered: boolean;
}) {
  const c = getWorkstreamColor(workstream.color);

  return (
    <div
      className="shrink-0 border-b border-[var(--border-default)]"
      style={{
        background: "var(--bg-elevated, #211e2e)",
        opacity: entered ? 1 : 0,
        transition: "opacity 300ms cubic-bezier(0.22,1,0.36,1) 100ms",
      }}
    >
      {/* Top row: back + title + actions */}
      <div className="flex items-center gap-3 px-5 h-13" style={{ height: 52 }}>
        {/* Back */}
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Canvas</span>
        </button>

        <div className="w-px h-5 bg-[var(--border-default)] mx-1" />

        {/* Emoji + title */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-xl leading-none">{workstream.emoji || "📚"}</span>
          <h1 className="font-display text-base font-bold text-[var(--text-primary)] truncate">
            {workstream.title}
          </h1>
          {/* Status dot */}
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              background: workstream.status === "active" ? c.value : "var(--text-tertiary)",
              boxShadow: workstream.status === "active" ? `0 0 6px ${c.value}60` : "none",
            }}
          />
          {workstream.description && (
            <span className="text-xs text-[var(--text-tertiary)] truncate hidden md:block ml-1">
              {workstream.description}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onToggleChat}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
              chatOpen
                ? "bg-[var(--accent-cyan)] text-white shadow-sm"
                : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
            )}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Chat
          </button>
          <button
            type="button"
            onClick={onOpenFullChat}
            title="Open full chat"
            className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <ArrowUpRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Left Sidebar ───────────────────────────────────────────────────────────

const SECTIONS: Array<{ id: PanelSection; label: string; icon: typeof MessageSquare; count?: number }> = [
  { id: "overview", label: "Overview", icon: Layers },
  { id: "chat", label: "Threads", icon: MessageSquare },
  { id: "notes", label: "Notes", icon: StickyNote },
  { id: "artifacts", label: "Artifacts", icon: FileText },
];

function WorkstreamSidebar({
  workstream,
  activeSection,
  onSectionChange,
}: {
  workstream: Workstream;
  activeSection: PanelSection;
  onSectionChange: (s: PanelSection) => void;
}) {
  const c = getWorkstreamColor(workstream.color);

  return (
    <div
      className="shrink-0 flex flex-col border-r border-[var(--border-default)]"
      style={{
        width: 220,
        background: "var(--bg-elevated, #211e2e)",
      }}
    >
      {/* Navigation sections */}
      <nav className="flex-1 p-3 space-y-0.5">
        {SECTIONS.map((sec) => {
          const Icon = sec.icon;
          const count =
            sec.id === "chat"
              ? workstream.threadCount
              : sec.id === "artifacts"
                ? workstream.artifactCount
                : undefined;

          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => onSectionChange(sec.id)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all text-left",
                activeSection === sec.id
                  ? "text-[var(--text-primary)] bg-[var(--bg-hover)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]/50",
              )}
            >
              <Icon
                className="w-4 h-4 shrink-0"
                style={{ color: activeSection === sec.id ? c.value : undefined }}
              />
              <span className="flex-1">{sec.label}</span>
              {count !== undefined && count > 0 && (
                <span className="text-[10px] font-semibold text-[var(--text-tertiary)] tabular-nums">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Workstream meta */}
      <div className="p-3 border-t border-[var(--border-default)]">
        <div className="text-[10px] text-[var(--text-tertiary)] space-y-1">
          <div className="flex justify-between">
            <span>Type</span>
            <span className="capitalize text-[var(--text-secondary)]">{workstream.type}</span>
          </div>
          <div className="flex justify-between">
            <span>Status</span>
            <span className="capitalize" style={{ color: c.value }}>{workstream.status}</span>
          </div>
          {workstream.lastActivityAt && (
            <div className="flex justify-between">
              <span>Last active</span>
              <span className="text-[var(--text-secondary)]">
                {formatRelativeTime(workstream.lastActivityAt)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main content area ──────────────────────────────────────────────────────

function MainContent({
  workstream,
  activeSection,
  onSectionChange,
  chatOpen,
  onOpenFullChat,
  onToggleChat,
}: {
  workstream: Workstream;
  activeSection: PanelSection;
  onSectionChange: (s: PanelSection) => void;
  chatOpen: boolean;
  onOpenFullChat: () => void;
  onToggleChat: () => void;
}) {
  switch (activeSection) {
    case "overview":
      return (
        <WorkstreamOverview
          workstream={workstream}
          onSectionChange={onSectionChange}
          onOpenFullChat={onOpenFullChat}
          onToggleChat={onToggleChat}
        />
      );
    case "chat":
      return <ThreadsSection workstream={workstream} onOpenFullChat={onOpenFullChat} onToggleChat={onToggleChat} />;
    case "notes":
      return <NotesSection workstream={workstream} />;
    case "artifacts":
      return <ArtifactsSection workstream={workstream} />;
    default:
      return <WorkstreamOverview workstream={workstream} onSectionChange={onSectionChange} onOpenFullChat={onOpenFullChat} onToggleChat={onToggleChat} />;
  }
}

// ─── Overview section ───────────────────────────────────────────────────────

function WorkstreamOverview({
  workstream,
  onSectionChange,
  onOpenFullChat,
  onToggleChat,
}: {
  workstream: Workstream;
  onSectionChange: (s: PanelSection) => void;
  onOpenFullChat: () => void;
  onToggleChat: () => void;
}) {
  const c = getWorkstreamColor(workstream.color);

  const stats = [
    { label: "Threads", value: workstream.threadCount ?? 0, section: "chat" as PanelSection, color: "var(--accent-cyan)" },
    { label: "Artifacts", value: workstream.artifactCount ?? 0, section: "artifacts" as PanelSection, color: "var(--accent-mint)" },
    { label: "Notes", value: 0, section: "notes" as PanelSection, color: "var(--accent-coral)" },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-start gap-4 mb-8">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0"
          style={{ background: c.bg, border: `1px solid ${c.border}` }}
        >
          {workstream.emoji || "📚"}
        </div>
        <div>
          <h2 className="font-display text-2xl font-bold text-[var(--text-primary)]">
            {workstream.title}
          </h2>
          {workstream.description && (
            <p className="text-sm text-[var(--text-secondary)] mt-1 max-w-prose">
              {workstream.description}
            </p>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        {stats.map((stat) => (
          <button
            key={stat.label}
            type="button"
            onClick={() => onSectionChange(stat.section)}
            className="p-4 rounded-xl border border-[var(--border-default)] text-left hover:border-[var(--accent-cyan)]/30 hover:bg-[var(--bg-hover)] transition-all group"
            style={{ background: "var(--bg-elevated)" }}
          >
            <div
              className="text-2xl font-bold mb-1 tabular-nums"
              style={{ color: stat.color }}
            >
              {stat.value}
            </div>
            <div className="text-xs text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] transition-colors">
              {stat.label}
            </div>
          </button>
        ))}
      </div>

      {/* Quick actions */}
      <div className="mb-6">
        <h3 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wide mb-3">
          Quick Actions
        </h3>
        <div className="flex flex-wrap gap-2">
          <QuickAction
            icon="💬"
            label="Start a conversation"
            onClick={onToggleChat}
          />
          <QuickAction
            icon="📝"
            label="New note"
            onClick={() => onSectionChange("notes")}
          />
          <QuickAction
            icon="📋"
            label="View artifacts"
            onClick={() => onSectionChange("artifacts")}
          />
        </div>
      </div>

      {/* Activity */}
      {workstream.lastActivityAt && (
        <div className="text-xs text-[var(--text-tertiary)]">
          Last active {formatRelativeTime(workstream.lastActivityAt)}
        </div>
      )}
    </div>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[var(--text-secondary)] border border-[var(--border-default)] hover:text-[var(--text-primary)] hover:border-[var(--accent-cyan)]/30 hover:bg-[var(--bg-hover)] transition-all"
      style={{ background: "var(--bg-elevated)" }}
    >
      <span>{icon}</span>
      {label}
    </button>
  );
}

// ─── Threads section ────────────────────────────────────────────────────────

function ThreadsSection({
  workstream,
  onOpenFullChat,
  onToggleChat,
}: {
  workstream: Workstream;
  onOpenFullChat: () => void;
  onToggleChat: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-[var(--text-primary)]">Conversations</h3>
        <button
          type="button"
          onClick={onToggleChat}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-cyan)] text-white hover:brightness-110 transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          New conversation
        </button>
      </div>

      {(workstream.threadCount ?? 0) === 0 ? (
        <EmptyState
          icon="💬"
          title="No conversations yet"
          description="Start a conversation to begin working with this workstream"
          action={{ label: "Start conversation", onClick: onToggleChat }}
        />
      ) : (
        <div className="space-y-2">
          {/* Placeholder thread items — real data would come from Convex */}
          <PlaceholderThreadItem index={0} workstream={workstream} onOpen={onOpenFullChat} />
          {(workstream.threadCount ?? 0) > 1 && (
            <button
              type="button"
              onClick={onOpenFullChat}
              className="w-full text-center text-xs text-[var(--accent-cyan)] py-2 hover:underline"
            >
              View all {workstream.threadCount} conversations →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PlaceholderThreadItem({
  index,
  workstream,
  onOpen,
}: {
  index: number;
  workstream: Workstream;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-start gap-3 p-3 rounded-xl border border-[var(--border-default)] text-left hover:border-[var(--accent-cyan)]/30 hover:bg-[var(--bg-hover)] transition-all"
      style={{ background: "var(--bg-elevated)" }}
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[var(--accent-cyan)]/10">
        <MessageSquare className="w-4 h-4 text-[var(--accent-cyan)]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--text-primary)] truncate">
          {workstream.title} — conversation
        </div>
        <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
          {workstream.lastActivityAt ? formatRelativeTime(workstream.lastActivityAt) : "Recently"}
        </div>
      </div>
      <ArrowUpRight className="w-3.5 h-3.5 text-[var(--text-tertiary)] shrink-0 mt-0.5" />
    </button>
  );
}

// ─── Notes section ──────────────────────────────────────────────────────────

function NotesSection({ workstream }: { workstream: Workstream }) {
  const [isCreating, setIsCreating] = useState(false);
  const [savedContent, setSavedContent] = useState<object | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(async (json: object, text: string) => {
    if (!text.trim()) return;
    setIsSaving(true);
    try {
      await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          workstreamId: workstream._id,
          title: text.slice(0, 60).split("\n")[0] || "Untitled",
          content: json,
          contentPlaintext: text,
          editorMode: "notion",
        }),
      });
      setIsCreating(false);
      setSavedContent(null);
    } catch {
      // silent — user can retry
    } finally {
      setIsSaving(false);
    }
  }, [workstream._id]);

  if (isCreating) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--border-default)] shrink-0"
          style={{ background: "var(--bg-elevated)" }}>
          <h3 className="font-semibold text-[var(--text-primary)] text-sm">New note</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="px-3 py-1.5 rounded-lg text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => {
                // Save triggered by the editor's onSave
                // This button is a visual affordance; actual save is in TiptapEditor onSave
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-cyan)] text-white hover:brightness-110 transition-all disabled:opacity-60"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <TiptapEditor
            placeholder="Start writing your note…"
            content={savedContent}
            onSave={handleSave}
            onChange={(json) => setSavedContent(json)}
            className="min-h-[300px]"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-[var(--text-primary)]">Notes</h3>
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-cyan)] text-white hover:brightness-110 transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          New note
        </button>
      </div>
      <EmptyState
        icon="📝"
        title="No notes yet"
        description="Create notes to capture ideas, summaries, and key information"
        action={{ label: "Create first note", onClick: () => setIsCreating(true) }}
      />
    </div>
  );
}

// ─── Artifacts section ──────────────────────────────────────────────────────

function ArtifactsSection({ workstream }: { workstream: Workstream }) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-[var(--text-primary)]">Artifacts</h3>
      </div>
      {(workstream.artifactCount ?? 0) === 0 ? (
        <EmptyState
          icon="📄"
          title="No artifacts yet"
          description="AI-generated content like study plans, flashcard decks, and documents will appear here"
        />
      ) : (
        <div className="space-y-2">
          {/* Placeholder — real data from Convex */}
          <div className="p-3 rounded-xl border border-[var(--border-default)] text-sm text-[var(--text-secondary)]"
            style={{ background: "var(--bg-elevated)" }}>
            {workstream.artifactCount} artifact{workstream.artifactCount !== 1 ? "s" : ""} — open full chat to view
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Compact chat drawer ────────────────────────────────────────────────────

function CompactChatDrawer({
  workstream,
  onClose,
  onOpenFull,
  initialDraft,
}: {
  workstream: Workstream;
  onClose: () => void;
  onOpenFull: () => void;
  initialDraft?: string;
}) {
  const { messages, streaming, streamPhase, error, sendMessage, stopGeneration } =
    useCompactChat(workstream._id);
  const [draft, setDraft] = useState(initialDraft ?? "");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    if (!draft.trim() || streaming) return;
    const text = draft;
    setDraft("");
    await sendMessage(text);
  }, [draft, streaming, sendMessage]);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const phaseLabel: Record<string, string> = {
    routing: "thinking...",
    searching: "searching...",
    generating: "writing...",
    thinking: "reasoning...",
    synthesizing: "synthesizing...",
  };

  return (
    <div
      className="shrink-0 flex flex-col border-l border-[var(--border-default)]"
      style={{
        width: 380,
        background: "var(--bg-primary, #13111a)",
      }}
    >
      {/* Chat header */}
      <div className="flex items-center gap-2 px-4 h-12 shrink-0 border-b border-[var(--border-default)]"
        style={{ background: "var(--bg-elevated)" }}>
        <MessageSquare className="w-4 h-4 text-[var(--accent-cyan)]" />
        <span className="text-sm font-semibold text-[var(--text-primary)] flex-1 truncate">
          {workstream.title}
        </span>
        <button
          type="button"
          onClick={onOpenFull}
          title="Open full chat"
          className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-8">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl"
              style={{ background: getWorkstreamColor(workstream.color).bg }}>
              {workstream.emoji || "📚"}
            </div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              Chat with {workstream.title}
            </p>
            <p className="text-xs text-[var(--text-tertiary)] max-w-[220px]">
              Ask questions, generate content, and explore this workstream
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {streaming && messages.length > 0 && messages[messages.length - 1]?.role === "assistant" && messages[messages.length - 1]?.content === "" && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
            <LoadingDots />
            <span>{phaseLabel[streamPhase] ?? "..."}</span>
          </div>
        )}

        {error && (
          <div className="text-xs text-[var(--error)] px-3 py-2 rounded-lg bg-[var(--error)]/10 border border-[var(--error)]/20">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-[var(--border-default)] p-3">
        <div className="flex items-end gap-2 px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-default)] focus-within:border-[var(--accent-cyan)]/50 focus-within:ring-1 focus-within:ring-[var(--accent-cyan)]/20 transition-all">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this workstream..."
            rows={1}
            className="flex-1 bg-transparent border-none outline-none resize-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] max-h-[120px]"
            style={{ height: "auto", minHeight: "1.5rem" }}
          />
          {streaming ? (
            <button
              type="button"
              onClick={stopGeneration}
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--error)] transition-colors"
              title="Stop"
            >
              <div className="w-2.5 h-2.5 rounded-sm bg-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!draft.trim()}
              className={cn(
                "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all",
                draft.trim()
                  ? "bg-[var(--accent-cyan)] text-white shadow-sm hover:brightness-110"
                  : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]",
              )}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          )}
        </div>
        <p className="text-[10px] text-[var(--text-tertiary)] mt-1.5 text-center">
          Shift+Enter for new line · Enter to send
        </p>
      </div>
    </div>
  );
}

// ─── Chat message component ─────────────────────────────────────────────────

function ChatMessage({ message }: { message: CompactMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-2.5", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-[var(--accent-cyan)]/15 text-xs">
          ✨
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] px-3 py-2.5 rounded-2xl text-sm leading-relaxed",
          isUser
            ? "bg-[var(--accent-cyan)] text-white rounded-br-sm"
            : "bg-[var(--bg-elevated)] text-[var(--text-primary)] rounded-bl-sm border border-[var(--border-default)]",
          message.streaming && "animate-pulse",
        )}
      >
        {message.content || (
          <span className="text-[var(--text-tertiary)] italic text-xs">Thinking...</span>
        )}
        {message.modelUsed && !isUser && (
          <div className="text-[10px] text-[var(--text-tertiary)] mt-1 opacity-70">
            {message.modelUsed}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: string;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
      <div className="text-4xl">{icon}</div>
      <h4 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h4>
      <p className="text-xs text-[var(--text-tertiary)] max-w-[240px]">{description}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 px-4 py-2 rounded-lg text-xs font-semibold bg-[var(--accent-cyan)] text-white hover:brightness-110 transition-all"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// ─── Loading dots ────────────────────────────────────────────────────────────

function LoadingDots() {
  return (
    <div className="flex gap-1 items-center">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-1 h-1 rounded-full bg-[var(--text-tertiary)]"
          style={{
            animation: "pulse 1.4s ease-in-out infinite",
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Hub focus panel ────────────────────────────────────────────────────────

interface HubFocusPanelProps {
  cardBounds: CardBounds;
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
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const panelStyle = entered
    ? { left: "50%", top: "50%", width: 480, height: 560, transform: "translate(-50%,-50%)", borderRadius: 24 }
    : { left: cardBounds.x, top: cardBounds.y, width: cardBounds.w, height: cardBounds.h, transform: "none", borderRadius: "50%" };

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
      style={{
        background: entered ? "rgba(0,0,0,0.5)" : "transparent",
        backdropFilter: entered ? "blur(4px)" : "none",
        transition: "background 400ms cubic-bezier(0.22,1,0.36,1), backdrop-filter 400ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      <div
        style={{
          position: "absolute",
          ...panelStyle,
          background: "var(--bg-elevated, #211e2e)",
          border: "1px solid var(--border-default, #3a3448)",
          boxShadow: entered ? "0 32px 80px -16px rgba(0,0,0,0.6)" : "none",
          overflow: "hidden",
          transition: "all 420ms cubic-bezier(0.22,1,0.36,1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {entered && (
          <HubPanelContent
            userName={userName}
            userAvatar={userAvatar}
            totalWorkstreams={totalWorkstreams}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

function HubPanelContent({
  userName,
  userAvatar,
  totalWorkstreams,
  onClose,
}: {
  userName: string;
  userAvatar: string;
  totalWorkstreams: number;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col h-full p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {userAvatar ? (
            <img
              src={userAvatar}
              alt=""
              className="w-10 h-10 rounded-full object-cover border-2 border-[var(--accent-cyan)]/30"
            />
          ) : (
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold bg-gradient-to-br from-[var(--accent-cyan)] to-[var(--accent-mint)]">
              {(userName || "?")[0]?.toUpperCase()}
            </div>
          )}
          <div>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)]">
              {userName}
            </h2>
            <p className="text-xs text-[var(--text-tertiary)]">
              {totalWorkstreams} active workstream{totalWorkstreams !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content sections */}
      <div className="space-y-4 flex-1 overflow-y-auto">
        <HubSection title="Upcoming deadlines" icon="⏰">
          <EmptyState icon="✅" title="No upcoming deadlines" description="Deadlines from your workstreams will appear here" />
        </HubSection>

        <HubSection title="Recent notes" icon="📝">
          <EmptyState icon="📝" title="No recent notes" description="Notes from across your workstreams will appear here" />
        </HubSection>

        <HubSection title="Personal memory" icon="🧠">
          <p className="text-xs text-[var(--text-tertiary)]">
            Spectra remembers your learning preferences and academic context across all workstreams.
          </p>
        </HubSection>
      </div>
    </div>
  );
}

function HubSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">{icon}</span>
        <h4 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wide">
          {title}
        </h4>
      </div>
      <div className="pl-5">{children}</div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}
