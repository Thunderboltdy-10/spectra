"use client";

import { memo, useState, useRef, useCallback, useEffect } from "react";
import { type Node, type NodeProps, type Edge } from "@xyflow/react";
import {
  MessageSquare,
  CalendarClock,
  FileText,
  Plus,
  Sparkles,
  Workflow,
  Clock,
  ArrowRight,
  Code2,
  Image as ImageIcon,
  BookOpen,
  HelpCircle,
  Download,
  Layout,
  CheckSquare,
  Layers,
  Bold,
  Italic,
  Heading2,
  List,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PanelType, ZoomBand } from "@/stores/workspace-store";
import { formatDistanceToNowStrict } from "date-fns";

/* ─── Data types ────────────────────────────────────────────── */

export type ThreadSummary = {
  id: string;
  title: string;
  messageCount: number;
  lastActivityAt: number;
};

export type NoteSummary = {
  id: string;
  title: string;
  updatedAt: number;
  editorMode: string;
};

export type PlannerItemSummary = {
  id: string;
  title: string;
  dueAt?: number;
  status: "pending" | "in_progress" | "done";
};

export type ArtifactSummary = {
  id: string;
  title: string;
  type: string;
  renderMode?: string;
  createdAt: number;
  updatedAt?: number;
  contentSummary?: string;
  cardCount?: number;
  questionCount?: number;
  lastScore?: number;
  language?: string;
};

export type WorkspaceWidgetSummary = {
  id: string;
  title: string;
  itemType: string;
  renderMode?: string;
  contentSummary?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  panelType: PanelType;
  panelId: string;
};

export type InternalContentData = {
  threads: ThreadSummary[];
  notes: NoteSummary[];
  plannerItems: PlannerItemSummary[];
  artifacts: ArtifactSummary[];
  widgets: WorkspaceWidgetSummary[];
  loading: boolean;
  workstreamEmoji?: string;
  workstreamTitle?: string;
  onOpenPanel: (type: PanelType, id: string) => void;
  band: ZoomBand;
  // W2 Touch tier
  focusedItemId?: string;
  onFocusItem?: (id: string) => void;
  onBlurItem?: () => void;
  onItemContextMenu?: (id: string, itemType: "thread" | "note" | "planner" | "artifact", x: number, y: number) => void;
  onGroupContextMenu?: (groupType: string, x: number, y: number) => void;
};

/* ─── Helper ────────────────────────────────────────────────── */

function formatTimeAgo(timestamp: number) {
  return formatDistanceToNowStrict(new Date(timestamp), { addSuffix: false })
    .replace(/ seconds?/, "s")
    .replace(/ minutes?/, "m")
    .replace(/ hours?/, "h")
    .replace(/ days?/, "d")
    .replace(/ months?/, "mo")
    .replace(/ years?/, "y");
}

/* ─── Touch Tier: Note inline editor ────────────────────────── */

const TOUCH_OVERFLOW_LIMIT = 5;

type NoteTouchEditorProps = {
  note: NoteSummary;
  isFocused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onOpenPanel: (type: PanelType, id: string) => void;
};

function NoteTouchEditor({ note, isFocused, onFocus, onBlur, onOpenPanel }: NoteTouchEditorProps) {
  const [content, setContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingRef = useRef<string | null>(null);

  // Load content when focused
  useEffect(() => {
    if (!isFocused || content !== null) return;
    fetch(`/api/artifacts?action=get&id=${note.id}`)
      .then((r) => r.json())
      .then((data) => {
        const raw = data.artifact?.contentPlaintext ?? data.artifact?.contentSummary ?? "";
        setContent(raw);
      })
      .catch(() => setContent(""));
  }, [isFocused, content, note.id]);

  // Auto-focus textarea
  useEffect(() => {
    if (isFocused && content !== null && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [isFocused, content]);

  const saveContent = useCallback(async () => {
    if (pendingRef.current === null) return;
    setSaving(true);
    try {
      await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id: note.id, contentPlaintext: pendingRef.current }),
      });
    } catch { /* silent */ } finally {
      setSaving(false);
      pendingRef.current = null;
    }
  }, [note.id]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      void saveContent();
      onBlur();
    }
    // Suppress slash commands: "/" is a literal character
  }, [saveContent, onBlur]);

  if (!isFocused) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onFocus(); }}
        className="group relative flex w-full flex-col gap-1 rounded-2xl border border-transparent bg-[var(--bg-elevated)]/40 p-4 text-left shadow-sm backdrop-blur-sm transition-all hover:bg-[var(--bg-elevated)]/60 hover:border-[var(--border-default)]/50"
      >
        <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--accent-purple)]/60 mb-1">
          {note.editorMode === "ai_enhanced" ? "Research Note" : "Draft"}
        </div>
        <div className="font-display text-[15px] font-bold leading-tight text-[var(--text-primary)]">
          {note.title}
        </div>
        <div className="mt-2 h-px w-full bg-[var(--border-default)]/20" />
        <div className="mt-2 text-[10px] text-[var(--text-tertiary)]">
          Updated {formatTimeAgo(note.updatedAt)} ago
        </div>
      </button>
    );
  }

  return (
    <div
      className="relative flex w-full flex-col rounded-2xl border-2 border-[var(--accent-cyan)] bg-[var(--bg-elevated)]/80 shadow-[0_0_0_2px_var(--accent-cyan)/20] outline outline-2 outline-offset-2 outline-[var(--accent-cyan)]"
      style={{ minHeight: 140 }}
    >
      {/* Basic formatting toolbar */}
      <div className="flex items-center gap-0.5 border-b border-[var(--border-default)]/40 px-2 py-1.5">
        {[
          { icon: <Bold className="h-3 w-3" />, label: "Bold", key: "b" },
          { icon: <Italic className="h-3 w-3" />, label: "Italic", key: "i" },
          { icon: <Heading2 className="h-3 w-3" />, label: "Heading", key: "h" },
          { icon: <List className="h-3 w-3" />, label: "List", key: "l" },
        ].map(({ icon, label }) => (
          <button
            key={label}
            type="button"
            title={label}
            className="rounded p-1 text-[var(--text-tertiary)] hover:bg-white/10 hover:text-[var(--text-primary)]"
            onMouseDown={(e) => e.preventDefault()}
          >
            {icon}
          </button>
        ))}
        <div className="flex-1" />
        {saving && <span className="text-[9px] text-[var(--text-tertiary)]">Saving…</span>}
        <button
          type="button"
          onClick={() => { onOpenPanel("artifact", note.id); onBlur(); }}
          className="text-[9px] font-medium text-[var(--accent-cyan)]/70 hover:text-[var(--accent-cyan)]"
        >
          Open full →
        </button>
      </div>
      {content === null ? (
        <div className="flex flex-1 items-center justify-center p-4 text-[11px] text-[var(--text-tertiary)]">Loading…</div>
      ) : (
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            pendingRef.current = e.target.value;
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => { void saveContent(); onBlur(); }}
          className="flex-1 resize-none bg-transparent p-3 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          placeholder="Start typing…"
          rows={5}
        />
      )}
    </div>
  );
}

/* ─── Touch Tier: Code inline editor ────────────────────────── */

type CodeTouchEditorProps = {
  artifact: ArtifactSummary;
  isFocused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onOpenPanel: (type: PanelType, id: string) => void;
};

function CodeTouchEditor({ artifact, isFocused, onFocus, onBlur, onOpenPanel }: CodeTouchEditorProps) {
  const [content, setContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingRef = useRef<string | null>(null);
  const lang = artifact.language ?? ((artifact.renderMode ?? "").replace("code_", "") || "code");

  useEffect(() => {
    if (!isFocused || content !== null) return;
    fetch(`/api/artifacts?action=get&id=${artifact.id}`)
      .then((r) => r.json())
      .then((data) => {
        const raw = data.artifact?.contentPlaintext ?? "";
        setContent(raw);
      })
      .catch(() => setContent(""));
  }, [isFocused, content, artifact.id]);

  useEffect(() => {
    if (isFocused && content !== null && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isFocused, content]);

  const saveContent = useCallback(async () => {
    if (pendingRef.current === null) return;
    setSaving(true);
    try {
      await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id: artifact.id, contentPlaintext: pendingRef.current }),
      });
    } catch { /* silent */ } finally {
      setSaving(false);
      pendingRef.current = null;
    }
  }, [artifact.id]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      void saveContent();
      onBlur();
    }
    // Tab → insert spaces, not focus trap
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      const newVal = `${val.substring(0, start)}  ${val.substring(end)}`;
      setContent(newVal);
      pendingRef.current = newVal;
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }, [saveContent, onBlur]);

  if (!isFocused) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onFocus(); }}
        className="group flex w-full flex-col gap-1 rounded-2xl border border-[var(--border-default)]/30 bg-[var(--bg-secondary)]/60 p-3 text-left transition-all hover:border-[var(--accent-mint)]/30 hover:bg-[var(--bg-secondary)]/80"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--accent-mint)]/10 text-[var(--accent-mint)]">
            <Code2 className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{artifact.title}</div>
          </div>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest bg-[var(--accent-mint)]/10 text-[var(--accent-mint)]">
            {lang}
          </span>
          {artifact.contentSummary && (
            <span className="text-[10px] text-[var(--text-tertiary)] truncate">{artifact.contentSummary}</span>
          )}
        </div>
      </button>
    );
  }

  return (
    <div
      className="relative flex w-full flex-col rounded-2xl border-2 border-[var(--accent-cyan)] bg-[var(--bg-secondary)] shadow-[0_0_0_2px_var(--accent-cyan)/20] outline outline-2 outline-offset-2 outline-[var(--accent-cyan)]"
      style={{ minHeight: 160 }}
    >
      <div className="flex items-center gap-2 border-b border-[var(--border-default)]/40 px-3 py-1.5">
        <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest bg-[var(--accent-mint)]/10 text-[var(--accent-mint)]">
          {lang}
        </span>
        <div className="flex-1" />
        {saving && <span className="text-[9px] text-[var(--text-tertiary)]">Saving…</span>}
        <button
          type="button"
          onClick={() => { onOpenPanel("artifact", artifact.id); onBlur(); }}
          className="text-[9px] font-medium text-[var(--accent-cyan)]/70 hover:text-[var(--accent-cyan)]"
        >
          Open full →
        </button>
      </div>
      {content === null ? (
        <div className="flex flex-1 items-center justify-center p-4 text-[11px] text-[var(--text-tertiary)]">Loading…</div>
      ) : (
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            pendingRef.current = e.target.value;
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => { void saveContent(); onBlur(); }}
          className="flex-1 resize-none bg-transparent p-3 font-mono text-[12px] text-[var(--text-primary)] outline-none"
          rows={6}
          spellCheck={false}
        />
      )}
    </div>
  );
}

/* ============================================================================
   SYNTHESIZED RENDERER (V2)
============================================================================ */

/**
 * WorkstreamTitleNode
 * The primary typographic anchor for the workstream cluster.
 */
export const WorkstreamTitleNode = memo(function WorkstreamTitleNode({
  data,
}: NodeProps<Node<{ title: string; emoji?: string; band: ZoomBand }>>) {
  const isOverview = data.band === "overview";
  return (
    <div className={cn("flex items-center gap-4 py-2", isOverview && "opacity-80 scale-90 origin-left transition-all")}>
      <span className={cn("filter drop-shadow-sm select-none", isOverview ? "text-2xl" : "text-4xl")}>
        {data.emoji || "📚"}
      </span>
      <h2 className={cn("font-display font-bold tracking-tight text-[var(--text-primary)]", isOverview ? "text-2xl" : "text-4xl")}>
        {data.title}
      </h2>
    </div>
  );
});

/* ─── Canonical Glance Card Components ────────────────────── */

function GlanceArtifactCard({
  artifact,
  onOpenPanel,
}: {
  artifact: ArtifactSummary;
  onOpenPanel: (type: PanelType, id: string) => void;
}) {
  const mode = artifact.renderMode ?? artifact.type;

  if (mode === "visualization" || mode === "concept_map" || mode === "image" || mode === "diagram") {
    return (
      <button
        key={artifact.id}
        onClick={() => onOpenPanel("artifact", artifact.id)}
        className="group relative flex w-full flex-col gap-1 overflow-hidden rounded-2xl border border-[var(--border-default)]/30 bg-[var(--bg-elevated)]/40 text-left transition-all hover:border-[var(--accent-cyan)]/30 hover:bg-[var(--bg-elevated)]/70"
      >
        <div className="flex items-center justify-center h-16 bg-gradient-to-br from-[var(--accent-cyan)]/10 to-[var(--accent-purple)]/10">
          <ImageIcon className="h-7 w-7 text-[var(--accent-cyan)]/60" />
        </div>
        <div className="px-3 pb-3 pt-2">
          <div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{artifact.title}</div>
          {artifact.contentSummary && (
            <div className="mt-0.5 text-[10px] text-[var(--text-tertiary)] line-clamp-2">{artifact.contentSummary}</div>
          )}
          <div className="mt-1 flex items-center gap-1 text-[9px] uppercase tracking-[0.15em] text-[var(--accent-cyan)]/70 font-bold">
            <Workflow className="h-2.5 w-2.5" />
            Visual
          </div>
        </div>
      </button>
    );
  }

  if (mode === "code_project" || mode === "code_output") {
    const lang = artifact.language ?? mode.replace("code_", "");
    return (
      <button
        key={artifact.id}
        onClick={() => onOpenPanel("artifact", artifact.id)}
        className="group flex w-full flex-col gap-1 rounded-2xl border border-[var(--border-default)]/30 bg-[var(--bg-secondary)]/60 p-3 text-left transition-all hover:border-[var(--accent-mint)]/30 hover:bg-[var(--bg-secondary)]/80"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--accent-mint)]/10 text-[var(--accent-mint)]">
            <Code2 className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{artifact.title}</div>
          </div>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest bg-[var(--accent-mint)]/10 text-[var(--accent-mint)]">
            {lang}
          </span>
          {artifact.contentSummary && (
            <span className="text-[10px] text-[var(--text-tertiary)] truncate">{artifact.contentSummary}</span>
          )}
        </div>
      </button>
    );
  }

  if (mode === "flashcard_deck") {
    return (
      <button
        key={artifact.id}
        onClick={() => onOpenPanel("artifact", artifact.id)}
        className="group flex w-full items-center gap-3 rounded-2xl border border-[var(--border-default)]/30 bg-[var(--bg-elevated)]/40 p-3 text-left transition-all hover:border-[var(--accent-coral)]/30 hover:bg-[var(--bg-elevated)]/70"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-coral)]/10 text-[var(--accent-coral)]">
          <BookOpen className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{artifact.title}</div>
          {artifact.cardCount !== undefined && (
            <div className="text-[10px] text-[var(--text-tertiary)]">{artifact.cardCount} cards</div>
          )}
        </div>
        <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--accent-coral)]/70 shrink-0">Deck</div>
      </button>
    );
  }

  if (mode === "quiz") {
    return (
      <button
        key={artifact.id}
        onClick={() => onOpenPanel("artifact", artifact.id)}
        className="group flex w-full items-center gap-3 rounded-2xl border border-[var(--border-default)]/30 bg-[var(--bg-elevated)]/40 p-3 text-left transition-all hover:border-[var(--accent-purple)]/30 hover:bg-[var(--bg-elevated)]/70"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-purple)]/10 text-[var(--accent-purple)]">
          <HelpCircle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{artifact.title}</div>
          <div className="flex items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
            {artifact.questionCount !== undefined && <span>{artifact.questionCount} questions</span>}
            {artifact.lastScore !== undefined && <span>Last: {artifact.lastScore}%</span>}
          </div>
        </div>
        <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--accent-purple)]/70 shrink-0">Quiz</div>
      </button>
    );
  }

  if (mode === "study_plan" || mode === "timetable") {
    return (
      <button
        key={artifact.id}
        onClick={() => onOpenPanel("artifact", artifact.id)}
        className="group flex w-full items-center gap-3 rounded-2xl border border-[var(--border-default)]/30 bg-[var(--bg-elevated)]/40 p-3 text-left transition-all hover:border-[var(--accent-orange)]/30 hover:bg-[var(--bg-elevated)]/70"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-orange)]/10 text-[var(--accent-orange)]">
          <CheckSquare className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{artifact.title}</div>
          {artifact.contentSummary && (
            <div className="text-[10px] text-[var(--text-tertiary)] truncate">{artifact.contentSummary}</div>
          )}
        </div>
        <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--accent-orange)]/70 shrink-0">
          {mode === "timetable" ? "Schedule" : "Plan"}
        </div>
      </button>
    );
  }

  if (mode === "whiteboard" || mode === "board") {
    return (
      <button
        key={artifact.id}
        onClick={() => onOpenPanel("artifact", artifact.id)}
        className="group relative flex w-full flex-col gap-1 overflow-hidden rounded-2xl border border-[var(--border-default)]/30 bg-[var(--bg-elevated)]/40 text-left transition-all hover:border-[var(--accent-cyan)]/20"
      >
        <div className="flex items-center justify-center h-14 bg-[var(--bg-secondary)]/60">
          <div className="flex gap-2">
            {[0,1,2].map((i) => (
              <div key={i} className={cn("rounded w-8 h-5 bg-white/10", i === 1 && "h-7 mt-[-4px]")} />
            ))}
          </div>
        </div>
        <div className="px-3 pb-2 pt-1.5 flex items-center gap-2">
          <Layout className="h-3 w-3 text-[var(--text-tertiary)]" />
          <span className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{artifact.title}</span>
          <span className="ml-auto text-[9px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Board</span>
        </div>
      </button>
    );
  }

  if (mode === "bookmark" || mode === "collection") {
    return (
      <button
        key={artifact.id}
        onClick={() => onOpenPanel("artifact", artifact.id)}
        className="group flex w-full items-center gap-3 rounded-2xl border border-[var(--border-default)]/30 bg-[var(--bg-elevated)]/40 p-3 text-left transition-all hover:bg-[var(--bg-elevated)]/70"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/5 text-[var(--text-tertiary)]">
          <Layers className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{artifact.title}</div>
        </div>
        <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] shrink-0">Ref</div>
      </button>
    );
  }

  // Export / document / note fallback — keep the existing document card style
  return (
    <button
      key={artifact.id}
      onClick={() => onOpenPanel("artifact", artifact.id)}
      className="group relative flex w-full flex-col gap-1 rounded-2xl border border-transparent bg-[var(--bg-elevated)]/40 p-4 text-left shadow-sm backdrop-blur-sm transition-all hover:bg-[var(--bg-elevated)]/60 hover:border-[var(--border-default)]/50"
    >
      <div className="flex items-center gap-2 mb-1">
        <Download className="h-3 w-3 text-[var(--text-tertiary)]" />
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
          {mode === "document" ? "Doc" : mode}
        </span>
      </div>
      <div className="font-display text-[15px] font-bold leading-tight text-[var(--text-primary)]">
        {artifact.title}
      </div>
      {artifact.contentSummary && (
        <div className="mt-1 text-[10px] text-[var(--text-tertiary)] line-clamp-2">{artifact.contentSummary}</div>
      )}
    </button>
  );
}

/**
 * CategoryFieldNode
 * Generic field for THREADS, DOCUMENTS, ARTIFACTS etc.
 * Implements "open composition" anti-card-soup.
 */
type CategoryFieldData = {
  label: string;
  type: "threads" | "documents" | "planner" | "artifacts";
  items: Array<ThreadSummary | NoteSummary | PlannerItemSummary | ArtifactSummary>;
  onOpenPanel: (type: PanelType, id: string) => void;
  accentColor?: string;
  band: ZoomBand;
  // W2: Touch tier and context menus
  focusedItemId?: string;
  onFocusItem?: (id: string) => void;
  onBlurItem?: () => void;
  onItemContextMenu?: (id: string, itemType: "thread" | "note" | "planner" | "artifact", x: number, y: number) => void;
  onGroupContextMenu?: (groupType: string, x: number, y: number) => void;
};

export const CategoryFieldNode = memo(function CategoryFieldNode({
  data,
}: NodeProps<Node<CategoryFieldData>>) {
  const {
    label, type, items, onOpenPanel, accentColor = "var(--accent-cyan)", band,
    focusedItemId, onFocusItem, onBlurItem, onItemContextMenu, onGroupContextMenu,
  } = data;
  const isOverview = band === "overview";
  const isDetail = band === "detail";
  const [expanded, setExpanded] = useState(false);

  const visibleItems = expanded ? items : items.slice(0, TOUCH_OVERFLOW_LIMIT);
  const hiddenCount = Math.max(0, items.length - TOUCH_OVERFLOW_LIMIT);

  return (
    <div
      className={cn("flex flex-col gap-3 min-w-[320px] transition-all duration-300", isOverview && "opacity-40 scale-95 origin-top-left")}
      onContextMenu={(e) => {
        if (onGroupContextMenu) {
          e.preventDefault();
          e.stopPropagation();
          onGroupContextMenu(type, e.clientX, e.clientY);
        }
      }}
    >
      {/* Category Header */}
      <div className="flex items-center gap-2 mb-1">
        <div className="w-1 h-3.5 rounded-full" style={{ background: accentColor }} />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          {label}
        </span>
        <span className="ml-auto text-[9px] text-[var(--text-tertiary)]">{items.length}</span>
      </div>

      {/* Content Items */}
      <div className="flex flex-col gap-2">
        {items.length === 0 ? (
          <div className="px-3 py-4 rounded-xl border border-dashed border-[var(--border-default)]/30 text-[11px] text-[var(--text-tertiary)] italic">
            No {label.toLowerCase()} yet.
          </div>
        ) : (
          <>
            {visibleItems.map((item) => {
              if (isOverview) {
                return <div key={item.id} className="h-10 w-full rounded-xl bg-white/[0.03] animate-pulse-slow" />;
              }
              if (type === "threads") {
                const thread = item as ThreadSummary;
                return (
                  <button
                    key={thread.id}
                    onClick={() => onOpenPanel("chat", thread.id)}
                    onContextMenu={(e) => {
                      if (onItemContextMenu) {
                        e.preventDefault();
                        e.stopPropagation();
                        onItemContextMenu(thread.id, "thread", e.clientX, e.clientY);
                      }
                    }}
                    className="group flex w-full items-center gap-3 rounded-2xl border border-transparent bg-white/[0.02] p-3 text-left transition-all hover:bg-white/[0.05] hover:border-[var(--border-default)]/40 hover:shadow-sm"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-[var(--text-secondary)]">
                      <MessageSquare className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                        {thread.title}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
                        <span className="flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />
                          {formatTimeAgo(thread.lastActivityAt)}
                        </span>
                        <span>•</span>
                        <span>{thread.messageCount} messages</span>
                      </div>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-0 -translate-x-2 transition-all group-hover:opacity-40 group-hover:translate-x-0" />
                  </button>
                );
              }

              if (type === "documents") {
                const note = item as NoteSummary;
                const isFocused = focusedItemId === note.id;
                if (isDetail && (isFocused || onFocusItem)) {
                  return (
                    <div
                      key={note.id}
                      onContextMenu={(e) => {
                        if (!isFocused && onItemContextMenu) {
                          e.preventDefault();
                          e.stopPropagation();
                          onItemContextMenu(note.id, "note", e.clientX, e.clientY);
                        }
                      }}
                    >
                      <NoteTouchEditor
                        note={note}
                        isFocused={isFocused}
                        onFocus={() => onFocusItem?.(note.id)}
                        onBlur={() => onBlurItem?.()}
                        onOpenPanel={onOpenPanel}
                      />
                    </div>
                  );
                }
                return (
                  <button
                    key={note.id}
                    onClick={() => onOpenPanel("artifact", note.id)}
                    onContextMenu={(e) => {
                      if (onItemContextMenu) {
                        e.preventDefault();
                        e.stopPropagation();
                        onItemContextMenu(note.id, "note", e.clientX, e.clientY);
                      }
                    }}
                    className="group relative flex w-full flex-col gap-1 rounded-2xl border border-transparent bg-[var(--bg-elevated)]/40 p-4 text-left shadow-sm backdrop-blur-sm transition-all hover:bg-[var(--bg-elevated)]/60 hover:border-[var(--border-default)]/50"
                  >
                    <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--accent-purple)]/60 mb-1">
                      {note.editorMode === "ai_enhanced" ? "Research Note" : "Draft"}
                    </div>
                    <div className="font-display text-[15px] font-bold leading-tight text-[var(--text-primary)]">
                      {note.title}
                    </div>
                    <div className="mt-2 h-px w-full bg-[var(--border-default)]/20" />
                    <div className="mt-2 text-[10px] text-[var(--text-tertiary)]">
                      Updated {formatTimeAgo(note.updatedAt)} ago
                    </div>
                  </button>
                );
              }

              if (type === "planner") {
                const p = item as PlannerItemSummary;
                return (
                  <button
                    key={p.id}
                    onClick={() => onOpenPanel("planner", p.id)}
                    onContextMenu={(e) => {
                      if (onItemContextMenu) {
                        e.preventDefault();
                        e.stopPropagation();
                        onItemContextMenu(p.id, "planner", e.clientX, e.clientY);
                      }
                    }}
                    className="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
                  >
                    <div
                      className={cn(
                        "h-5 w-1 shrink-0 rounded-full transition-transform group-hover:scale-y-110",
                        p.status === "done"
                          ? "bg-[var(--accent-mint)]"
                          : p.status === "in_progress"
                          ? "bg-[var(--accent-cyan)] shadow-[0_0_8px_rgba(14,142,232,0.3)]"
                          : "bg-white/15"
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
                        {p.title}
                      </div>
                      {p.dueAt && (
                        <div className="text-[10px] text-[var(--text-tertiary)]">
                          Due {new Date(p.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </div>
                      )}
                    </div>
                  </button>
                );
              }

              if (type === "artifacts") {
                const artifact = item as ArtifactSummary;
                const isCodeArtifact = artifact.renderMode === "code_project" || artifact.renderMode === "code_output";
                const isFocused = focusedItemId === artifact.id;
                if (isDetail && isCodeArtifact && (isFocused || onFocusItem)) {
                  return (
                    <div
                      key={artifact.id}
                      onContextMenu={(e) => {
                        if (!isFocused && onItemContextMenu) {
                          e.preventDefault();
                          e.stopPropagation();
                          onItemContextMenu(artifact.id, "artifact", e.clientX, e.clientY);
                        }
                      }}
                    >
                      <CodeTouchEditor
                        artifact={artifact}
                        isFocused={isFocused}
                        onFocus={() => onFocusItem?.(artifact.id)}
                        onBlur={() => onBlurItem?.()}
                        onOpenPanel={onOpenPanel}
                      />
                    </div>
                  );
                }
                return (
                  <div
                    key={artifact.id}
                    onContextMenu={(e) => {
                      if (onItemContextMenu) {
                        e.preventDefault();
                        e.stopPropagation();
                        onItemContextMenu(artifact.id, "artifact", e.clientX, e.clientY);
                      }
                    }}
                  >
                    <GlanceArtifactCard
                      artifact={artifact}
                      onOpenPanel={onOpenPanel}
                    />
                  </div>
                );
              }

              return null;
            })}

            {/* Overflow pill (+N more) */}
            {hiddenCount > 0 && !expanded && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--border-default)]/40 py-2 text-[11px] text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-default)]/70 hover:text-[var(--text-secondary)]"
                style={{ animation: "none" }}
              >
                <ChevronDown className="h-3 w-3" />
                +{hiddenCount} more
              </button>
            )}
            {expanded && hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--border-default)]/30 py-1.5 text-[10px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
              >
                Show less
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
});

/**
 * Legacy WorkspaceFieldNode (Internal Container)
 * Redefined to be a spatial coordinator rather than a card.
 */
export const WorkspaceFieldNode = memo(function WorkspaceFieldNode({
  data,
}: NodeProps<Node<InternalContentData>>) {
  const { threads, notes, plannerItems, onOpenPanel, workstreamTitle, workstreamEmoji } = data;
  return (
    <div className="flex flex-col gap-12 pointer-events-none">
      <div className="pointer-events-auto">
        <div className="flex items-center gap-4 py-2">
          <span className="text-4xl filter drop-shadow-sm select-none">
            {workstreamEmoji || "📚"}
          </span>
          <h2 className="font-display text-4xl font-bold tracking-tight text-[var(--text-primary)]">
            {workstreamTitle || "Untitled"}
          </h2>
        </div>
      </div>

      <div className="flex gap-10 pointer-events-auto">
        <div className="flex min-w-[280px] flex-col gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Threads
          </span>
          {threads.slice(0, 5).map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => onOpenPanel("chat", thread.id)}
              className="rounded-xl bg-white/[0.03] px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-white/[0.06]"
            >
              {thread.title}
            </button>
          ))}
        </div>
        <div className="flex min-w-[280px] flex-col gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Documents
          </span>
          {notes.slice(0, 5).map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => onOpenPanel("artifact", note.id)}
              className="rounded-xl bg-white/[0.03] px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-white/[0.06]"
            >
              {note.title}
            </button>
          ))}
        </div>
        <div className="flex min-w-[280px] flex-col gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Planner
          </span>
          {plannerItems.slice(0, 5).map((plannerItem) => (
            <button
              key={plannerItem.id}
              type="button"
              onClick={() => onOpenPanel("planner", plannerItem.id)}
              className="rounded-xl bg-white/[0.03] px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-white/[0.06]"
            >
              {plannerItem.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});


// Bucket artifact types into canonical display groups for glance lanes
function bucketArtifacts(artifacts: ArtifactSummary[]): {
  visual: ArtifactSummary[];
  code: ArtifactSummary[];
  interactive: ArtifactSummary[];
  boards: ArtifactSummary[];
  other: ArtifactSummary[];
} {
  const visual: ArtifactSummary[] = [];
  const code: ArtifactSummary[] = [];
  const interactive: ArtifactSummary[] = [];
  const boards: ArtifactSummary[] = [];
  const other: ArtifactSummary[] = [];

  for (const a of artifacts) {
    const mode = a.renderMode ?? a.type;
    if (mode === "visualization" || mode === "concept_map" || mode === "image" || mode === "diagram") {
      visual.push(a);
    } else if (mode === "code_project" || mode === "code_output") {
      code.push(a);
    } else if (mode === "flashcard_deck" || mode === "quiz" || mode === "study_plan" || mode === "timetable") {
      interactive.push(a);
    } else if (mode === "whiteboard" || mode === "board") {
      boards.push(a);
    } else {
      other.push(a);
    }
  }

  return { visual, code, interactive, boards, other };
}

export function buildWorkspaceNodes(
  data: InternalContentData,
  basePosition: { x: number; y: number },
): { nodes: Node[]; edges: Edge[] } {
  if (data.loading) {
    return { nodes: [], edges: [] };
  }

  const { visual, code, interactive, boards, other } = bucketArtifacts(data.artifacts);

  // Build lanes dynamically — only include non-empty artifact lanes.
  // Start at 1080 (planner is at 720, width ~360) to avoid overlapping the planner column.
  const artifactLanes: Array<{ id: string; label: string; items: ArtifactSummary[]; accentColor: string; xOffset: number }> = [];
  let colOffset = 1080;

  if (visual.length > 0) {
    artifactLanes.push({ id: "visual", label: "VISUALS", items: visual, accentColor: "var(--accent-cyan)", xOffset: colOffset });
    colOffset += 360;
  }
  if (code.length > 0) {
    artifactLanes.push({ id: "code", label: "CODE", items: code, accentColor: "var(--accent-mint)", xOffset: colOffset });
    colOffset += 360;
  }
  if (interactive.length > 0) {
    artifactLanes.push({ id: "interactive", label: "STUDY", items: interactive, accentColor: "var(--accent-coral)", xOffset: colOffset });
    colOffset += 360;
  }
  if (boards.length > 0) {
    artifactLanes.push({ id: "boards", label: "BOARDS", items: boards, accentColor: "var(--accent-purple)", xOffset: colOffset });
    colOffset += 360;
  }
  if (other.length > 0) {
    artifactLanes.push({ id: "other", label: "ARTIFACTS", items: other, accentColor: "var(--text-tertiary)", xOffset: colOffset });
    colOffset += 360;
  }

  const wsKey = data.workstreamTitle ?? "ws";

  const nodes: Node[] = [
    // Title Anchor
    {
      id: `ws-title-${wsKey}`,
      type: "workstreamTitle",
      position: { x: basePosition.x, y: basePosition.y },
      draggable: true,
      data: { title: data.workstreamTitle || "Untitled", emoji: data.workstreamEmoji, band: data.band },
    },
    // Threads Lane
    {
      id: `ws-lane-threads-${wsKey}`,
      type: "categoryField",
      position: { x: basePosition.x, y: basePosition.y + 100 },
      draggable: true,
      data: {
        label: "THREADS",
        type: "threads",
        items: data.threads,
        onOpenPanel: data.onOpenPanel,
        accentColor: "var(--accent-cyan)",
        band: data.band,
        focusedItemId: data.focusedItemId,
        onFocusItem: data.onFocusItem,
        onBlurItem: data.onBlurItem,
        onItemContextMenu: data.onItemContextMenu,
        onGroupContextMenu: data.onGroupContextMenu,
      },
    },
    // Documents Lane
    {
      id: `ws-lane-docs-${wsKey}`,
      type: "categoryField",
      position: { x: basePosition.x + 360, y: basePosition.y + 100 },
      draggable: true,
      data: {
        label: "DOCUMENTS",
        type: "documents",
        items: data.notes,
        onOpenPanel: data.onOpenPanel,
        accentColor: "var(--accent-purple)",
        band: data.band,
        focusedItemId: data.focusedItemId,
        onFocusItem: data.onFocusItem,
        onBlurItem: data.onBlurItem,
        onItemContextMenu: data.onItemContextMenu,
        onGroupContextMenu: data.onGroupContextMenu,
      },
    },
    // Planner Lane (always present even if empty)
    {
      id: `ws-lane-planner-${wsKey}`,
      type: "categoryField",
      position: { x: basePosition.x + 720, y: basePosition.y + 100 },
      draggable: true,
      data: {
        label: "PLANNER",
        type: "planner",
        items: data.plannerItems,
        onOpenPanel: data.onOpenPanel,
        accentColor: "var(--accent-orange)",
        band: data.band,
        focusedItemId: data.focusedItemId,
        onFocusItem: data.onFocusItem,
        onBlurItem: data.onBlurItem,
        onItemContextMenu: data.onItemContextMenu,
        onGroupContextMenu: data.onGroupContextMenu,
      },
    },
    // Dynamic artifact lanes (Visual, Code, Study, Boards) — appear only when non-empty
    ...artifactLanes.map((lane) => ({
      id: `ws-lane-${lane.id}-${wsKey}`,
      type: "categoryField" as const,
      position: { x: basePosition.x + lane.xOffset, y: basePosition.y + 100 },
      draggable: true,
      data: {
        label: lane.label,
        type: "artifacts" as const,
        items: lane.items,
        onOpenPanel: data.onOpenPanel,
        accentColor: lane.accentColor,
        band: data.band,
        focusedItemId: data.focusedItemId,
        onFocusItem: data.onFocusItem,
        onBlurItem: data.onBlurItem,
        onItemContextMenu: data.onItemContextMenu,
        onGroupContextMenu: data.onGroupContextMenu,
      },
    })),
  ];

  return { nodes, edges: [] };
}


/* ============================================================================
   WIDGETS & OTHER NODES
============================================================================ */

type WorkspaceWidgetNodeData = WorkspaceWidgetSummary & {
  onOpenPanel: (type: PanelType, id: string) => void;
};

const WIDGET_ICON_BY_TYPE = {
  thread: MessageSquare,
  planner: CalendarClock,
  visualization: Workflow,
  document: FileText,
} as const;

export const WorkspaceWidgetNode = memo(function WorkspaceWidgetNode({
  data,
}: NodeProps<Node<WorkspaceWidgetNodeData>>) {
  const IconComponent =
    WIDGET_ICON_BY_TYPE[data.itemType as keyof typeof WIDGET_ICON_BY_TYPE]
    ?? Sparkles;

  const isVisualization = data.itemType === "visualization" || data.renderMode === "artifact:visualization";

  return (
    <button
      type="button"
      onClick={() => data.onOpenPanel(data.panelType, data.panelId)}
      className={cn(
        "group flex h-full w-full flex-col text-left transition-all duration-300",
        isVisualization 
          ? "rounded-3xl bg-white/[0.03] border border-white/5 p-2 hover:bg-white/[0.05] hover:border-white/10"
          : "rounded-2xl border border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/60 p-4 shadow-sm backdrop-blur-md hover:bg-[var(--bg-elevated)]/80 hover:border-[var(--accent-cyan)]/30"
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/5 text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)] transition-colors">
            <IconComponent className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[12px] font-bold text-[var(--text-primary)] leading-tight">
              {data.title}
            </div>
            <div className="text-[9px] uppercase tracking-[0.15em] text-[var(--text-tertiary)] mt-0.5">
              {data.renderMode?.replace(/^artifact:/, "") ?? data.itemType}
            </div>
          </div>
        </div>
      </div>

      <div className={cn(
        "flex-1 overflow-hidden",
        isVisualization ? "rounded-2xl bg-black/20 border border-white/5 p-4 flex items-center justify-center" : ""
      )}>
        {isVisualization ? (
          <div className="text-center">
            <div className="h-12 w-12 rounded-full border-2 border-[var(--accent-cyan)]/20 border-t-[var(--accent-cyan)] animate-spin mx-auto mb-2 opacity-40" />
            <div className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest">Active Analysis</div>
          </div>
        ) : (
          <div className="line-clamp-4 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            {data.contentSummary || "Click to explore this component's data and insights."}
          </div>
        )}
      </div>

      {!isVisualization && (
        <div className="mt-4 pt-3 border-t border-[var(--border-default)]/10 flex items-center justify-between">
          <span className="text-[9px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Inspect</span>
          <ArrowRight className="h-3 w-3 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-all transform group-hover:translate-x-1" />
        </div>
      )}
    </button>
  );
});

export function buildWorkspaceWidgetNodes(
  data: InternalContentData,
  basePosition: { x: number; y: number },
): Node[] {
  if (data.loading || data.widgets.length === 0) return [];

  return data.widgets.map((widget) => ({
    id: `widget-${widget.id}`,
    type: "workspaceWidget",
    position: {
      x: basePosition.x + widget.x,
      y: basePosition.y + widget.y,
    },
    draggable: true,
    selectable: false,
    width: widget.width ?? 280,
    height: widget.height ?? 180,
    data: {
      ...widget,
      onOpenPanel: data.onOpenPanel,
    } satisfies WorkspaceWidgetNodeData,
  }));
}

/* ============================================================================
   SHARED NODES (Empty State, Focus Timer)
============================================================================ */

export type EmptyStateNodeData = {
  emoji: string;
  title: string;
  description: string;
  onNew?: () => void;
};

export const EmptyStateNode = memo(function EmptyStateNode({
  data,
}: NodeProps<Node<EmptyStateNodeData>>) {
  return (
    <div className="text-center py-8 px-6">
      <span className="text-4xl block mb-3">{data.emoji}</span>
      <h3 className="font-display text-lg text-[var(--text-primary)] mb-1.5">{data.title}</h3>
      <p className="text-sm text-[var(--text-secondary)] max-w-xs mx-auto mb-4">{data.description}</p>
      {data.onNew && (
        <button
          type="button"
          onClick={data.onNew}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-[var(--accent-cyan)] text-white hover:brightness-110 transition-all"
        >
          <Plus className="w-4 h-4" />
          Get started
        </button>
      )}
    </div>
  );
});

export type FocusTimerNodeData = {
  active: boolean;
  sessionMinutes: number;
  elapsed: number;
  sessionsCompleted: number;
  workstreamTitle?: string;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
};

export const FocusTimerNode = memo(function FocusTimerNode({
  data,
}: NodeProps<Node<FocusTimerNodeData>>) {
  const totalSeconds = data.sessionMinutes * 60;
  const remaining = Math.max(0, totalSeconds - data.elapsed);
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const progress = totalSeconds > 0 ? data.elapsed / totalSeconds : 0;
  const circumference = 2 * Math.PI * 38;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <div
      className="rounded-2xl border px-5 py-4 text-center backdrop-blur-xl"
      style={{
        width: 200,
        background: "color-mix(in oklab, var(--bg-elevated) 72%, transparent)",
        borderColor: data.active
          ? "color-mix(in oklab, var(--accent-cyan) 40%, var(--border-default))"
          : "var(--border-default)",
        boxShadow: data.active ? "0 0 20px -8px var(--accent-cyan)" : "0 10px 24px -10px rgba(0,0,0,0.1)",
        transition: "border-color 300ms, box-shadow 300ms",
      }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-3">
        Focus Timer
      </div>

      <div className="relative mx-auto mb-3" style={{ width: 84, height: 84 }}>
        <svg width="84" height="84" viewBox="0 0 84 84">
          <circle cx="42" cy="42" r="38" fill="none" stroke="var(--border-default)" strokeWidth="3" opacity={0.4} />
          <circle cx="42" cy="42" r="38" fill="none" stroke="var(--accent-cyan)" strokeWidth="3" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} transform="rotate(-90 42 42)" style={{ transition: "stroke-dashoffset 1s linear" }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-display text-lg font-bold text-[var(--text-primary)] tabular-nums">
            {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2">
        {data.active ? (
          <button type="button" onClick={data.onPause} className="rounded-lg px-3 py-1.5 text-xs font-medium bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">Pause</button>
        ) : (
          <button type="button" onClick={data.onStart} className="rounded-lg px-3 py-1.5 text-xs font-medium bg-[var(--accent-cyan)] text-white hover:brightness-110 transition-all">{data.elapsed > 0 ? "Resume" : "Start"}</button>
        )}
        {data.elapsed > 0 && (
          <button type="button" onClick={data.onReset} className="rounded-lg px-3 py-1.5 text-xs font-medium bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">Reset</button>
        )}
      </div>

      {data.sessionsCompleted > 0 && (
        <div className="mt-2 text-[10px] text-[var(--text-tertiary)]">
          {data.sessionsCompleted} session{data.sessionsCompleted !== 1 ? "s" : ""} today
        </div>
      )}
    </div>
  );
});
