"use client";

/**
 * right-push-panel.tsx
 *
 * Universal right push-panel for viewing threads, notes/documents, artifacts, and route trace.
 * Pushes the canvas left. Adaptive width by content type.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import {
  ArrowUpRight,
  FileText,
  MessageSquare,
  Route,
  Send,
  Square,
  StickyNote,
  X,
} from "lucide-react";
import type { PanelType } from "@/stores/workspace-store";
import { useChatPanel } from "@/hooks/use-chat-panel";
import { useArtifactData } from "@/hooks/use-artifact-data";
import { cn } from "@/lib/utils";

// Dynamic import TiptapEditor (SSR-safe)
const TiptapEditor = dynamic(
  () => import("@/components/editor/tiptap-editor").then((m) => m.TiptapEditor),
  { ssr: false, loading: () => <EditorLoader /> },
);

function EditorLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-5 h-5 rounded-full border-2 border-[var(--border-default)] border-t-[var(--accent-cyan)] animate-spin" />
    </div>
  );
}

type RightPushPanelProps = {
  type: PanelType;
  id: string;
  workstreamId?: string;
  onClose: () => void;
  onExpand?: (type: PanelType, id: string) => void;
};

const PANEL_WIDTHS: Record<PanelType, number> = {
  chat: 380,
  note: 520,
  artifact: 480,
  "route-trace": 400,
};

const PANEL_ICONS: Record<PanelType, React.ReactNode> = {
  chat: <MessageSquare className="w-4 h-4" />,
  note: <StickyNote className="w-4 h-4" />,
  artifact: <FileText className="w-4 h-4" />,
  "route-trace": <Route className="w-4 h-4" />,
};

const PANEL_LABELS: Record<PanelType, string> = {
  chat: "Thread",
  note: "Document",
  artifact: "Artifact",
  "route-trace": "Route Trace",
};

export function RightPushPanel({
  type,
  id,
  workstreamId,
  onClose,
  onExpand,
}: RightPushPanelProps) {
  const width = PANEL_WIDTHS[type];
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <motion.div
      ref={panelRef}
      initial={{ width: 0, opacity: 0 }}
      animate={{ width, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{
        width: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
        opacity: { duration: 0.2 },
      }}
      className="relative h-full overflow-hidden border-l border-[var(--border-default)] bg-[var(--bg-primary)] shrink-0"
    >
      <div className="flex flex-col h-full" style={{ width }}>
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 h-12 shrink-0 shadow-[0_1px_0_var(--border-default)]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[var(--text-tertiary)]">
              {PANEL_ICONS[type]}
            </span>
            <span className="text-sm font-medium text-[var(--text-primary)] truncate">
              {PANEL_LABELS[type]}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {onExpand && type !== "route-trace" && (
              <button
                type="button"
                onClick={() => onExpand(type, id)}
                title="Open full view"
                className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <ArrowUpRight className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              title="Close panel"
              className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Panel content — fills remaining space */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <PanelContent type={type} id={id} workstreamId={workstreamId} />
        </div>
      </div>
    </motion.div>
  );
}

function PanelContent({
  type,
  id,
  workstreamId,
}: {
  type: PanelType;
  id: string;
  workstreamId?: string;
}) {
  switch (type) {
    case "chat":
      return <ChatPanelContent threadId={id} workstreamId={workstreamId} />;
    case "note":
      return <NotePanelContent noteId={id} workstreamId={workstreamId} />;
    case "artifact":
      return <ArtifactPanelContent artifactId={id} />;
    case "route-trace":
      return <RouteTracePanelContent />;
    default:
      return null;
  }
}

/* ─── Chat Panel Content ─────────────────────────────────────── */

function ChatPanelContent({
  threadId,
  workstreamId,
}: {
  threadId: string;
  workstreamId?: string;
}) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    messages,
    streaming,
    streamPhase,
    sendMessage,
    stopGeneration,
    hydrateChat,
  } = useChatPanel({
    workstreamId,
    threadType: "conversation",
    initialChatId: threadId !== "new" ? threadId : null,
    mode: "tutor",
    thinkingLevel: "low",
    routerMode: "auto",
  });

  // Hydrate existing thread
  useEffect(() => {
    if (threadId && threadId !== "new") {
      void hydrateChat(threadId);
    }
  }, [threadId, hydrateChat]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    setInput("");
    await sendMessage(trimmed);
    inputRef.current?.focus();
  }, [input, streaming, sendMessage]);

  return (
    <div className="flex flex-col h-full">
      {/* Messages area with bottom gradient mask */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 [mask-image:linear-gradient(to_bottom,black_90%,transparent)]">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <MessageSquare className="w-8 h-8 text-[var(--text-tertiary)] mb-3" />
            <p className="text-sm text-[var(--text-secondary)]">
              Start a conversation
            </p>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              Ask anything about this workstream
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex flex-col gap-1",
              msg.role === "user" ? "items-end" : "items-start",
            )}
          >
            {/* Phase indicator above assistant messages */}
            {msg.role === "assistant" && msg.phase && msg.streaming && (
              <span className="text-[10px] text-[var(--accent-cyan)] px-2 mb-0.5 animate-pulse">
                {msg.phase}
              </span>
            )}

            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                msg.role === "user"
                  ? "bg-[var(--accent-cyan)] text-white rounded-br-md"
                  : "bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-bl-md",
              )}
            >
              {msg.content || (msg.streaming && (
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-tertiary)] animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-tertiary)] animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-tertiary)] animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
              ))}
            </div>

            {/* Thinking block */}
            {msg.thinking && (
              <details className="max-w-[85%] text-[11px] text-[var(--text-tertiary)]">
                <summary className="cursor-pointer hover:text-[var(--text-secondary)] transition-colors">
                  Thinking...
                </summary>
                <div className="mt-1 px-2 py-1.5 rounded-lg bg-[var(--bg-secondary)] whitespace-pre-wrap text-[10px] max-h-32 overflow-y-auto">
                  {msg.thinking}
                </div>
              </details>
            )}

            {/* Model used */}
            {msg.role === "assistant" && !msg.streaming && msg.modelUsed && (
              <span className="text-[9px] text-[var(--text-tertiary)] px-2">
                {msg.modelUsed}
              </span>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div className="shrink-0 p-3">
        {streaming && streamPhase && (
          <div className="flex items-center gap-2 px-3 py-1.5 mb-2 text-[10px] text-[var(--accent-cyan)]">
            <div className="w-3 h-3 rounded-full border border-[var(--accent-cyan)] border-t-transparent animate-spin" />
            {streamPhase}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-default)] focus-within:border-[var(--accent-cyan)]/40 transition-colors"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a follow-up..."
            className="flex-1 bg-transparent border-none outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
            disabled={streaming}
          />
          {streaming ? (
            <button
              type="button"
              onClick={stopGeneration}
              className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-[var(--accent-coral)]/15 text-[var(--accent-coral)] hover:bg-[var(--accent-coral)]/25 transition-colors"
            >
              <Square className="w-3 h-3" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className={cn(
                "shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors",
                input.trim()
                  ? "bg-[var(--accent-cyan)] text-white"
                  : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]",
              )}
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

/* ─── Note/Document Panel Content ─────────────────────────────── */

function NotePanelContent({
  noteId,
  workstreamId,
}: {
  noteId: string;
  workstreamId?: string;
}) {
  const {
    activeDocument,
    loading,
    createDocument,
    updateDocument,
    fetchDocument,
  } = useArtifactData({ artifactId: noteId !== "new" ? noteId : undefined });

  const [createdId, setCreatedId] = useState<string | null>(null);

  // Create new document if "new"
  useEffect(() => {
    if (noteId !== "new" || createdId) return;
    void createDocument({
      title: "Untitled",
      content: { type: "doc", content: [{ type: "paragraph" }] },
      contentPlaintext: "",
      editorMode: "standard",
      workstreamId,
    }).then((id: string) => {
      setCreatedId(id);
      void fetchDocument(id);
    });
  }, [noteId, createdId, createDocument, workstreamId, fetchDocument]);

  if (loading && !activeDocument) {
    return <EditorLoader />;
  }

  if (!activeDocument) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--text-secondary)]">
        Document not found
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Title */}
      <div className="px-6 pt-4 pb-2 shrink-0">
        <input
          type="text"
          value={activeDocument.title}
          onChange={(e) => {
            void updateDocument(activeDocument._id, { title: e.target.value });
          }}
          className="w-full bg-transparent text-lg font-display font-semibold text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          placeholder="Untitled"
        />
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        <TiptapEditor
          noteId={activeDocument._id}
          content={activeDocument.content as import("@tiptap/core").JSONContent | null}
          compact
          onSave={(content, text) =>
            void updateDocument(activeDocument._id, {
              title: text.trim().split("\n")[0] || activeDocument.title || "Untitled",
              content,
              contentPlaintext: text,
            })
          }
          className="h-full"
        />
      </div>
    </div>
  );
}

/* ─── Artifact Panel Content ─────────────────────────────────── */

function ArtifactPanelContent({ artifactId }: { artifactId: string }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center">
          <FileText className="w-8 h-8 text-[var(--text-tertiary)] mx-auto mb-3" />
          <p className="text-sm text-[var(--text-secondary)]">
            Artifact viewer
          </p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            {artifactId}
          </p>
        </div>
      </div>

      {/* AI interaction input bar */}
      <div className="shrink-0 p-3 border-t border-[var(--border-default)]">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-default)]">
          <input
            type="text"
            placeholder="Ask AI about this artifact..."
            className="flex-1 bg-transparent border-none outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
          />
          <button
            type="button"
            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Route Trace Panel Content ───────────────────────────────── */

function RouteTracePanelContent() {
  return (
    <div className="flex items-center justify-center h-full p-6">
      <div className="text-center">
        <Route className="w-8 h-8 text-[var(--text-tertiary)] mx-auto mb-3" />
        <p className="text-sm text-[var(--text-secondary)]">
          Route trace panel
        </p>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Score breakdowns and selection analysis will appear here during routing.
        </p>
      </div>
    </div>
  );
}
