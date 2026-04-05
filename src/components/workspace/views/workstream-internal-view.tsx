"use client";

/**
 * workstream-internal-view.tsx
 *
 * Canvas-native internal view for a committed workstream.
 * Renders as an overlay on top of the canvas when zoomed in.
 * Delegates to ByTypeView, ByTopicView, or TimelineView based on viewMode.
 * This is NOT a panel or modal — it's the canvas content itself.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  MessageSquare,
  StickyNote,
  CalendarClock,
  FileText,
  Plus,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore, type PanelType } from "@/stores/workspace-store";
import type { Workstream } from "@/hooks/use-workspace-data";
import { getWorkstreamColor } from "@/lib/workspace/zoom-helpers";

type WorkstreamInternalViewProps = {
  workstream: Workstream;
  onOpenPanel: (type: PanelType, id: string) => void;
  onBack: () => void;
};

// Mock data types for internal content
type ThreadSummary = {
  id: string;
  title: string;
  messageCount: number;
  lastActivityAt: number;
};

type NoteSummary = {
  id: string;
  title: string;
  updatedAt: number;
  editorMode: string;
};

type PlannerItem = {
  id: string;
  title: string;
  dueAt?: number;
  status: "pending" | "in_progress" | "done";
};

type ArtifactSummary = {
  id: string;
  title: string;
  type: string;
  createdAt: number;
};

export function WorkstreamInternalView({
  workstream,
  onOpenPanel,
}: WorkstreamInternalViewProps) {
  const { viewMode } = useWorkspaceStore();
  const color = getWorkstreamColor(workstream.color);

  // Fetch workstream content
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [plannerItems] = useState<PlannerItem[]>([]);
  const [artifacts] = useState<ArtifactSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchContent() {
      try {
        // Fetch threads
        const chatsRes = await fetch(`/api/chats?workstreamId=${workstream._id}&limit=20`);
        if (chatsRes.ok) {
          const data = await chatsRes.json();
          if (!cancelled) {
            setThreads(
              (data.chats ?? []).map((c: Record<string, unknown>) => ({
                id: c._id as string,
                title: (c.title as string) || (c.latestUserPrompt as string) || "Untitled",
                messageCount: (c.messageCount as number) ?? 0,
                lastActivityAt: (c.updatedAt as number) ?? Date.now(),
              })),
            );
          }
        }

        // Fetch notes
        const notesRes = await fetch(`/api/notes?workstreamId=${workstream._id}`);
        if (notesRes.ok) {
          const data = await notesRes.json();
          if (!cancelled) {
            setNotes(
              (data.notes ?? []).map((n: Record<string, unknown>) => ({
                id: n._id as string,
                title: (n.title as string) || "Untitled",
                updatedAt: (n.updatedAt as number) ?? Date.now(),
                editorMode: (n.editorMode as string) ?? "standard",
              })),
            );
          }
        }
      } catch {
        // Ignore fetch errors
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchContent();
    return () => { cancelled = true; };
  }, [workstream._id]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="absolute inset-0 z-20 overflow-auto"
      style={{
        // Subtle workstream color tinting
        background: `linear-gradient(180deg, ${color.value}08 0%, transparent 30%)`,
      }}
    >
      <div className="max-w-4xl mx-auto px-8 py-16">
        {viewMode === "byType" && (
          <StructuredView
            workstream={workstream}
            threads={threads}
            notes={notes}
            plannerItems={plannerItems}
            artifacts={artifacts}
            loading={loading}
            onOpenPanel={onOpenPanel}
          />
        )}
        {viewMode === "byTopic" && (
          <ColumnView
            workstream={workstream}
            threads={threads}
            notes={notes}
            plannerItems={plannerItems}
            artifacts={artifacts}
            loading={loading}
            onOpenPanel={onOpenPanel}
          />
        )}
        {viewMode === "timeline" && (
          <GraphViewPlaceholder workstream={workstream} />
        )}
      </div>
    </motion.div>
  );
}

/* ─── Structured View ────────────────────────────────────── */

function StructuredView({
  workstream,
  threads,
  notes,
  plannerItems,
  artifacts,
  loading,
  onOpenPanel,
}: {
  workstream: Workstream;
  threads: ThreadSummary[];
  notes: NoteSummary[];
  plannerItems: PlannerItem[];
  artifacts: ArtifactSummary[];
  loading: boolean;
  onOpenPanel: (type: PanelType, id: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 rounded-full border-2 border-[var(--border-default)] border-t-[var(--accent-cyan)] animate-spin" />
      </div>
    );
  }

  const hasThreads = threads.length > 0;
  const hasNotes = notes.length > 0;
  const hasPlanner = plannerItems.length > 0;
  const hasArtifacts = artifacts.length > 0;
  const hasAgent = !!workstream.linkedAgentId;
  const isEmpty = !hasThreads && !hasNotes && !hasPlanner && !hasArtifacts;

  return (
    <div className="space-y-10">
      {isEmpty && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-16"
        >
          <span className="text-4xl mb-4 block">{workstream.emoji || "📚"}</span>
          <h3 className="font-display text-lg text-[var(--text-primary)] mb-2">
            {workstream.title}
          </h3>
          <p className="text-sm text-[var(--text-secondary)] max-w-xs mx-auto">
            Start a conversation or create a document artifact to get going.
          </p>
        </motion.div>
      )}

      {/* Threads group */}
      {hasThreads && (
        <ContentGroup
          label="Threads"
          icon={<MessageSquare className="w-4 h-4" />}
          count={threads.length}
          onNew={() => onOpenPanel("chat", "new")}
        >
          {threads.map((thread) => (
            <ContentRow
              key={thread.id}
              onClick={() => onOpenPanel("chat", thread.id)}
            >
              <span className="text-sm text-[var(--text-primary)] truncate">
                {thread.title}
              </span>
              <div className="flex items-center gap-3 text-[10px] text-[var(--text-tertiary)] shrink-0">
                <span>{thread.messageCount} msgs</span>
                <span>{formatTimeAgo(thread.lastActivityAt)}</span>
              </div>
            </ContentRow>
          ))}
        </ContentGroup>
      )}

      {/* Artifacts group */}
      {hasNotes && (
        <ContentGroup
          label="Artifacts"
          icon={<StickyNote className="w-4 h-4" />}
          count={notes.length}
          onNew={() => onOpenPanel("artifact", "new")}
        >
          {notes.map((note) => (
            <ContentRow
              key={note.id}
              onClick={() => onOpenPanel("artifact", note.id)}
            >
              <span className="text-sm text-[var(--text-primary)] truncate">
                {note.title}
              </span>
              <div className="flex items-center gap-2 text-[10px] text-[var(--text-tertiary)] shrink-0">
                <span className="capitalize">{note.editorMode === "ai_enhanced" ? "AI" : "Standard"}</span>
                <span>{formatTimeAgo(note.updatedAt)}</span>
              </div>
            </ContentRow>
          ))}
        </ContentGroup>
      )}

      {/* Planner group */}
      {hasPlanner && (
        <ContentGroup
          label="Planner"
          icon={<CalendarClock className="w-4 h-4" />}
          count={plannerItems.length}
        >
          {plannerItems.map((item) => (
            <ContentRow key={item.id}>
              <div className="flex items-center gap-2">
                <span className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  item.status === "done" ? "bg-[var(--accent-mint)]" :
                  item.status === "in_progress" ? "bg-[var(--accent-cyan)]" :
                  "bg-[var(--text-tertiary)]",
                )} />
                <span className={cn(
                  "text-sm truncate",
                  item.status === "done" ? "text-[var(--text-tertiary)] line-through" : "text-[var(--text-primary)]",
                )}>
                  {item.title}
                </span>
              </div>
              {item.dueAt && (
                <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">
                  Due {formatTimeAgo(item.dueAt)}
                </span>
              )}
            </ContentRow>
          ))}
        </ContentGroup>
      )}

      {/* Artifacts group */}
      {hasArtifacts && (
        <ContentGroup
          label="Artifacts"
          icon={<FileText className="w-4 h-4" />}
          count={artifacts.length}
        >
          {artifacts.map((artifact) => (
            <ContentRow
              key={artifact.id}
              onClick={() => onOpenPanel("artifact", artifact.id)}
            >
              <span className="text-sm text-[var(--text-primary)] truncate">
                {artifact.title}
              </span>
              <span className="text-[10px] text-[var(--text-tertiary)] shrink-0 capitalize">
                {artifact.type}
              </span>
            </ContentRow>
          ))}
        </ContentGroup>
      )}

      {/* Linked agent */}
      {hasAgent && (
        <div className="pt-4">
          <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
            <Zap className="w-3.5 h-3.5" />
            <span>Linked agent active</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Column View ────────────────────────────────────────── */

function ColumnView({
  workstream,
  threads,
  notes,
  plannerItems,
  artifacts,
  loading,
  onOpenPanel,
}: {
  workstream: Workstream;
  threads: ThreadSummary[];
  notes: NoteSummary[];
  plannerItems: PlannerItem[];
  artifacts: ArtifactSummary[];
  loading: boolean;
  onOpenPanel: (type: PanelType, id: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 rounded-full border-2 border-[var(--border-default)] border-t-[var(--accent-cyan)] animate-spin" />
      </div>
    );
  }

  // Only show columns that have content (scale-adaptive)
  const columns = [
    { label: "Threads", items: threads, type: "chat" as const, icon: <MessageSquare className="w-4 h-4" /> },
    { label: "Artifacts", items: notes, type: "artifact" as const, icon: <StickyNote className="w-4 h-4" /> },
    { label: "Tasks", items: plannerItems, type: null, icon: <CalendarClock className="w-4 h-4" /> },
    { label: "Artifacts", items: artifacts, type: "artifact" as const, icon: <FileText className="w-4 h-4" /> },
  ].filter((col) => col.items.length > 0);

  if (columns.length === 0) {
    return (
      <div className="text-center py-16">
        <span className="text-4xl mb-4 block">{workstream.emoji || "📚"}</span>
        <p className="text-sm text-[var(--text-secondary)]">No content yet.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-8" style={{ gridTemplateColumns: `repeat(${Math.min(columns.length, 4)}, 1fr)` }}>
      {columns.map((col) => (
        <div key={col.label}>
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[var(--border-default)]">
            <span className="text-[var(--text-tertiary)]">{col.icon}</span>
            <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              {col.label}
            </span>
            <span className="text-[10px] text-[var(--text-tertiary)] ml-auto">
              {col.items.length}
            </span>
          </div>
          <div className="space-y-1">
            {col.items.map((item: Record<string, unknown>) => (
              <button
                key={item.id as string}
                type="button"
                onClick={() => {
                  if (col.type) {
                    onOpenPanel(col.type, item.id as string);
                  }
                }}
                className="w-full text-left px-2 py-1.5 rounded-lg text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]/50 transition-colors truncate"
              >
                {(item.title as string) || "Untitled"}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Graph View Placeholder ─────────────────────────────── */

function GraphViewPlaceholder({ workstream }: { workstream: Workstream }) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center">
        <span className="text-4xl mb-4 block">{workstream.emoji || "📚"}</span>
        <h3 className="font-display text-lg text-[var(--text-primary)] mb-2">
          Graph View
        </h3>
        <p className="text-sm text-[var(--text-secondary)] max-w-xs mx-auto">
          Relationship visualization of threads, notes, and artifacts within this workstream.
        </p>
      </div>
    </div>
  );
}

/* ─── Shared components ──────────────────────────────────── */

function ContentGroup({
  label,
  icon,
  count,
  onNew,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  count: number;
  onNew?: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Group heading — label with thin separator, not boxed header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[var(--text-tertiary)]">{icon}</span>
        <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          {label}
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)]">{count}</span>
        <div className="flex-1 h-px bg-[var(--border-default)]" />
        {onNew && (
          <button
            type="button"
            onClick={onNew}
            className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--accent-cyan)] transition-colors"
          >
            <Plus className="w-3 h-3" />
            <span>New</span>
          </button>
        )}
      </div>
      <div className="space-y-0.5">
        {children}
      </div>
    </motion.div>
  );
}

function ContentRow({
  onClick,
  children,
}: {
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const Component = onClick ? "button" : "div";
  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg transition-colors",
        onClick
          ? "text-left hover:bg-[var(--bg-elevated)]/50 cursor-pointer"
          : "",
      )}
    >
      {children}
    </Component>
  );
}

function formatTimeAgo(timestamp: number) {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  const days = Math.floor(delta / 86_400_000);
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}
