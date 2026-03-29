"use client";

/**
 * right-push-panel.tsx
 *
 * Universal right push-panel for viewing threads, notes/documents, artifacts, and route trace.
 * Pushes the canvas left. Adaptive width by content type.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowUpRight,
  CalendarClock,
  FileText,
  MessageSquare,
  Route,
  Send,
  Square,
  StickyNote,
} from "lucide-react";
import type { PanelType } from "@/stores/workspace-store";
import { useChatPanel } from "@/hooks/use-chat-panel";
import { useArtifactData } from "@/hooks/use-artifact-data";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { ArtifactAiSurface } from "@/components/artifacts/artifact-ai-surface";
import { stripGeneratedDocumentMarkers } from "@/lib/document-generator";
import { RightSidePanel } from "@/components/shared/right-side-panel";

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
  planner: 420,
  "route-trace": 400,
};

const PANEL_ICONS: Record<PanelType, React.ReactNode> = {
  chat: <MessageSquare className="w-4 h-4" />,
  note: <StickyNote className="w-4 h-4" />,
  artifact: <FileText className="w-4 h-4" />,
  planner: <CalendarClock className="w-4 h-4" />,
  "route-trace": <Route className="w-4 h-4" />,
};

const PANEL_LABELS: Record<PanelType, string> = {
  chat: "Thread",
  note: "Artifact",
  artifact: "Artifact",
  planner: "Planner Item",
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
    <div ref={panelRef}>
      <RightSidePanel
        width={width}
        title={PANEL_LABELS[type]}
        icon={PANEL_ICONS[type]}
        onClose={onClose}
        actions={onExpand && type !== "route-trace" ? (
          <button
            type="button"
            onClick={() => onExpand(type, id)}
            title="Open full view"
            className="rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <ArrowUpRight className="h-4 w-4" />
          </button>
        ) : null}
      >
        <PanelContent type={type} id={id} workstreamId={workstreamId} />
      </RightSidePanel>
    </div>
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
      return <ArtifactPanelContent artifactId={id} workstreamId={workstreamId} />;
    case "planner":
      return <PlannerPanelContent plannerItemId={id} />;
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
  const { openChatQuery, clearOpenChatQuery } = useWorkspaceStore();

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

  useEffect(() => {
    if (threadId !== "new" || !openChatQuery || streaming || messages.length > 0) return;
    clearOpenChatQuery();
    void sendMessage(openChatQuery);
  }, [clearOpenChatQuery, messages.length, openChatQuery, sendMessage, streaming, threadId]);

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
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
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
      <div className="flex-1 min-h-0">
        <TiptapEditor
          artifactId={activeDocument._id}
          content={activeDocument.content as import("@tiptap/core").JSONContent | null}
          compact
          showAiBar
          showDocumentMeta
          documentTitle={stripGeneratedDocumentMarkers(activeDocument.title || "").trim() || "Untitled"}
          createdAt={activeDocument.createdAt}
          updatedAt={activeDocument.updatedAt}
          onSave={(content, text) =>
            void updateDocument(activeDocument._id, {
              title: stripGeneratedDocumentMarkers(text.trim().split("\n")[0] || "Untitled").trim() || "Untitled",
              content,
              contentPlaintext: stripGeneratedDocumentMarkers(text),
            })
          }
          className="h-full"
        />
      </div>
    </div>
  );
}

/* ─── Artifact Panel Content ─────────────────────────────────── */

function ArtifactPanelContent({
  artifactId,
  workstreamId,
}: {
  artifactId: string;
  workstreamId?: string;
}) {
  const [artifact, setArtifact] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const loadArtifact = useCallback(async () => {
    const effectiveId = artifactId === "new" ? createdId : artifactId;
    if (!effectiveId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/artifacts?action=get&id=${encodeURIComponent(effectiveId)}`);
      if (!response.ok) throw new Error("Failed to load artifact");
      const data = (await response.json()) as { artifact: Record<string, unknown> };
      setArtifact(data.artifact ?? null);
    } finally {
      setLoading(false);
    }
  }, [artifactId, createdId]);

  useEffect(() => {
    if (artifactId !== "new" || createdId) return;
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch("/api/artifacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            type: "document",
            title: "Untitled",
            content: { type: "doc", content: [{ type: "paragraph" }] },
            contentPlaintext: "",
            editorMode: "standard",
            workstreamId,
          }),
        });
        if (!response.ok) throw new Error("Failed to create artifact");
        const data = (await response.json()) as { artifactId?: string };
        if (data.artifactId) {
          setCreatedId(data.artifactId);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [artifactId, createdId, workstreamId]);

  useEffect(() => {
    void loadArtifact();
  }, [loadArtifact]);

  if (loading) {
    return <EditorLoader />;
  }

  if (!artifact) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--text-secondary)]">
        Artifact not found
      </div>
    );
  }

  const artifactType = String(artifact.type ?? "artifact");
  const isDocument = artifactType === "document";

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isDocument ? (
          <TiptapEditor
            artifactId={artifactId === "new" ? (createdId ?? artifactId) : artifactId}
            content={(artifact.content as import("@tiptap/core").JSONContent | null) ?? null}
            compact
            showAiBar
            showDocumentMeta
            documentTitle={stripGeneratedDocumentMarkers(String(artifact.title ?? "Untitled")).trim() || "Untitled"}
            createdAt={Number(artifact.createdAt ?? Date.now())}
            updatedAt={Number(artifact.updatedAt ?? Date.now())}
            onSave={(content, text) =>
              void fetch("/api/artifacts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "update",
                  artifactId: artifactId === "new" ? createdId : artifactId,
                  title: stripGeneratedDocumentMarkers(text.trim().split("\n")[0] || "Untitled").trim() || "Untitled",
                  content,
                  contentPlaintext: stripGeneratedDocumentMarkers(text),
                }),
              }).then((response) => {
                if (!response.ok) {
                  throw new Error("Failed to update artifact");
                }
                setArtifact((current) => {
                  if (!current) return current;
                  const sanitizedTitle = stripGeneratedDocumentMarkers(text.trim().split("\n")[0] || "Untitled").trim() || "Untitled";
                  return {
                    ...current,
                    title: sanitizedTitle,
                    content,
                    contentPlaintext: stripGeneratedDocumentMarkers(text),
                    updatedAt: Date.now(),
                  };
                });
              })
            }
            className="h-full"
          />
        ) : (
          <div className="px-5 py-5 space-y-4">
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                {artifactType}
              </p>
              <h2 className="font-display text-xl text-[var(--text-primary)]">
                {String(artifact.title ?? "Untitled")}
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Updated {new Date(Number(artifact.updatedAt ?? Date.now())).toLocaleString()}
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
              <pre className="whitespace-pre-wrap break-words text-xs leading-6 text-[var(--text-secondary)]">
                {JSON.stringify(artifact.content ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>

      {!isDocument && (
        <ArtifactAiSurface
          artifactId={artifactId}
          context="workspace-panel"
          workstreamId={typeof artifact.workstreamId === "string" ? artifact.workstreamId : undefined}
        />
      )}
    </div>
  );
}

function PlannerPanelContent({ plannerItemId }: { plannerItemId: string }) {
  const [plannerItem, setPlannerItem] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const response = await fetch(`/api/planner?action=get&id=${encodeURIComponent(plannerItemId)}`);
        if (!response.ok) throw new Error("Failed to load planner item");
        const data = (await response.json()) as { plannerItem?: Record<string, unknown> };
        if (!cancelled) {
          setPlannerItem(data.plannerItem ?? null);
        }
      } catch {
        if (!cancelled) {
          setPlannerItem(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [plannerItemId]);

  if (loading) return <EditorLoader />;

  if (!plannerItem) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--text-secondary)]">
        Planner item not found
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full px-5 py-5">
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          {String(plannerItem.type ?? "planner")}
        </p>
        <h2 className="font-display text-xl text-[var(--text-primary)]">
          {String(plannerItem.title ?? "Untitled")}
        </h2>
        <p className="text-xs text-[var(--text-secondary)]">
          {typeof plannerItem.dueAt === "number"
            ? `Due ${new Date(plannerItem.dueAt).toLocaleString()}`
            : "No due date"}
        </p>
      </div>

      <div className="mt-5 grid gap-3">
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Status</div>
          <div className="mt-1 text-sm text-[var(--text-primary)]">
            {String(plannerItem.status ?? "pending")}
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Priority</div>
          <div className="mt-1 text-sm text-[var(--text-primary)]">
            {String(plannerItem.priority ?? "medium")}
          </div>
        </div>
        {typeof plannerItem.description === "string" && plannerItem.description.length > 0 && (
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Description</div>
            <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">
              {String(plannerItem.description)}
            </div>
          </div>
        )}
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
