"use client";

/**
 * right-push-panel.tsx
 *
 * Universal right push-panel for viewing threads, notes/documents, artifacts, and route trace.
 * Pushes the canvas left. Adaptive width by content type.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  CalendarClock,
  FileText,
  MessageSquare,
  Route,
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
import { notifyWorkspaceContentMutated } from "@/lib/workspace/events";
import { WorkspaceCommandBar } from "@/components/workspace/workspace-command-bar";
import type { Workstream } from "@/hooks/use-workspace-data";

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
  workstreams: Workstream[];
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
  workstreams,
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
    <div ref={panelRef} className="h-full flex flex-col pointer-events-auto">
      <div className="flex-1 min-h-0">
        <RightSidePanel
          width={width}
          title={PANEL_LABELS[type]}
          icon={PANEL_ICONS[type]}
          onClose={onClose}
          panelType={type}
          contentKey={`${type}-${id}`}
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
          className="h-full"
        >
          <PanelContent key={`${type}-${id}`} type={type} id={id} workstreamId={workstreamId} />
        </RightSidePanel>
      </div>

      {/* Command Bar Footer Transfer (Flying) */}
      <div className="absolute bottom-10 left-0 right-0 flex justify-center pointer-events-none z-50">
        <div className="pointer-events-auto w-full max-w-[90%] flex justify-center">
          <WorkspaceCommandBar
            workstreams={workstreams}
            primaryWorkstreamId={workstreamId}
            onOpenWorkstreamChat={(wsId, query) => {
               window.dispatchEvent(new CustomEvent("ai-school:panel-chat-query", { detail: { wsId, query } }));
            }}
            layoutId="workspace-command-bar"
            hidden={false}
          />
        </div>
      </div>
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    streaming,
    sendMessage,
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

  // Listen for panel chat query from command bar
  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ query?: string }>;
      const query = customEvent.detail?.query;
      if (query) {
        void sendMessage(query);
      }
    };
    window.addEventListener("ai-school:panel-chat-query", handler);
    return () => window.removeEventListener("ai-school:panel-chat-query", handler);
  }, [sendMessage]);

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
                  ? "bg-[var(--bg-user-bubble)] border border-[var(--border-default)] shadow-sm text-[var(--text-primary)] rounded-br-md"
                  : "bg-[var(--bg-primary)] border border-[var(--border-default)] shadow-sm text-[var(--text-primary)] rounded-bl-md",
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
                <div className="mt-1 px-2 py-1.5 rounded-lg bg-[var(--bg-primary)] border-[var(--border-default)] shadow-sm whitespace-pre-wrap text-[10px] max-h-32 overflow-y-auto">
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

      {/* Internal Composer removed — now uses Command Bar in footer */}
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
  const router = useRouter();
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
      notifyWorkspaceContentMutated({
        workstreamId,
        refreshHub: true,
        refreshWorkstreams: true,
      });
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
          workstreamId={activeDocument.workstreamId ?? workstreamId}
          content={activeDocument.content as import("@tiptap/core").JSONContent | null}
          compact
          showDocumentMeta
          documentTitle={stripGeneratedDocumentMarkers(activeDocument.title || "").trim() || "Untitled"}
          createdAt={activeDocument.createdAt}
          updatedAt={activeDocument.updatedAt}
          onVersionHistoryOpen={() => {
            router.push(`/notes?id=${encodeURIComponent(activeDocument._id)}&versionHistory=1`);
          }}
          onVersionRestore={() => {
            void fetchDocument(activeDocument._id);
            notifyWorkspaceContentMutated({
              workstreamId: activeDocument.workstreamId ?? workstreamId,
              refreshHub: true,
            });
          }}
          onSave={(content, text) =>
            void updateDocument(activeDocument._id, {
              title: stripGeneratedDocumentMarkers(text.trim().split("\n")[0] || "Untitled").trim() || "Untitled",
              content,
              contentPlaintext: stripGeneratedDocumentMarkers(text),
            }).then(() => {
              notifyWorkspaceContentMutated({
                workstreamId,
                refreshHub: true,
              });
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
  const router = useRouter();
  const [artifact, setArtifact] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const loadArtifact = useCallback(async () => {
    const effectiveId = artifactId === "new" ? createdId : artifactId;
    if (!effectiveId) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/artifacts?action=get&id=${encodeURIComponent(effectiveId)}`);
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to load artifact");
      }
      const data = (await response.json()) as { artifact: Record<string, unknown> };
      if (!data.artifact) throw new Error("Artifact not found");
      setArtifact(data.artifact);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load artifact";
      console.error("Artifact load error:", err);
      setError(message);
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
          notifyWorkspaceContentMutated({
            workstreamId,
            refreshHub: true,
            refreshWorkstreams: true,
          });
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to create artifact");
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

  if (error || !artifact) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-[var(--accent-coral)]/10 flex items-center justify-center mb-3">
          <FileText className="w-6 h-6 text-[var(--accent-coral)]" />
        </div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          {error || "Artifact not found"}
        </p>
        <button
          onClick={() => void loadArtifact()}
          className="mt-4 px-4 py-2 rounded-lg bg-[var(--bg-secondary)] text-xs font-medium hover:bg-[var(--bg-hover)] transition-colors"
        >
          Retry
        </button>
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
            workstreamId={typeof artifact.workstreamId === "string" ? artifact.workstreamId : workstreamId}
            content={(artifact.content as import("@tiptap/core").JSONContent | null) ?? null}
            compact
            showDocumentMeta
            documentTitle={stripGeneratedDocumentMarkers(String(artifact.title ?? "Untitled")).trim() || "Untitled"}
            createdAt={Number(artifact.createdAt ?? Date.now())}
            updatedAt={Number(artifact.updatedAt ?? Date.now())}
            onVersionHistoryOpen={() => {
              const effectiveId = artifactId === "new" ? createdId : artifactId;
              if (!effectiveId) return;
              router.push(`/notes?id=${encodeURIComponent(effectiveId)}&versionHistory=1`);
            }}
            onVersionRestore={({ artifact: restoredArtifact }) => {
              if (!restoredArtifact) return;
              setArtifact((current) => {
                if (!current) return current;
                return {
                  ...current,
                  title: restoredArtifact.title ?? current.title,
                  content: restoredArtifact.content ?? current.content,
                  contentPlaintext: restoredArtifact.contentPlaintext ?? current.contentPlaintext,
                  updatedAt: restoredArtifact.updatedAt ?? current.updatedAt,
                };
              });
              notifyWorkspaceContentMutated({
                workstreamId: typeof artifact.workstreamId === "string" ? artifact.workstreamId : workstreamId,
                refreshHub: true,
              });
            }}
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
                notifyWorkspaceContentMutated({
                  workstreamId: typeof artifact.workstreamId === "string" ? artifact.workstreamId : workstreamId,
                  refreshHub: true,
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

            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-sm px-4 py-3">
              <pre className="whitespace-pre-wrap break-words text-xs leading-6 text-[var(--text-secondary)]">
                {JSON.stringify(artifact.content ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>

      {!isDocument ? (
        <ArtifactAiSurface
          artifactId={artifactId === "new" ? (createdId ?? artifactId) : artifactId}
          context="workspace-panel"
          workstreamId={typeof artifact.workstreamId === "string" ? artifact.workstreamId : workstreamId}
        />
      ) : null}
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
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-sm px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Status</div>
          <div className="mt-1 text-sm text-[var(--text-primary)]">
            {String(plannerItem.status ?? "pending")}
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-sm px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Priority</div>
          <div className="mt-1 text-sm text-[var(--text-primary)]">
            {String(plannerItem.priority ?? "medium")}
          </div>
        </div>
        {typeof plannerItem.description === "string" && plannerItem.description.length > 0 && (
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-sm px-4 py-3">
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
