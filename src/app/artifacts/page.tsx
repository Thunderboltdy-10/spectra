"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PanelRightClose, PanelRightOpen, Plus, Search } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { TiptapEditor } from "@/components/editor/tiptap-editor";
import { CreateArtifactDialog, type ArtifactTemplate } from "@/components/artifacts/create-artifact-dialog";
import { ArtifactAiSurface } from "@/components/artifacts/artifact-ai-surface";
import { useNotesData } from "@/hooks/use-notes-data";
import { useEditorStore, normalizeEditorMode } from "@/stores/editor-store";
import { getArtifactMeta, type ArtifactType } from "@/lib/artifact-types";
import { cn } from "@/lib/utils";
import { stripGeneratedDocumentMarkers } from "@/lib/document-generator";
import { subscribeWorkspaceContentMutated } from "@/lib/workspace/events";

const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

import { Suspense } from "react";

function ArtifactsPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const noteId = params.get("id") ?? params.get("note") ?? undefined;
  const versionHistoryOpen = params.get("versionHistory") === "1" || params.get("versionHistory") === "true";
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  const { editorMode, setEditorMode, openVersionHistory } = useEditorStore();
  const {
    notes,
    activeNote,
    loading,
    createNote,
    fetchNote,
    updateNote,
    refresh,
  } = useNotesData({ noteId });

  useEffect(() => {
    if (activeNote?.editorMode) {
      const nextMode = normalizeEditorMode(activeNote.editorMode);
      if (editorMode !== nextMode) {
        setEditorMode(nextMode);
      }
    }
  }, [activeNote?.editorMode, editorMode, setEditorMode]);

  useEffect(() => {
    if (versionHistoryOpen && activeNote?._id) {
      openVersionHistory();
    }
  }, [activeNote?._id, openVersionHistory, versionHistoryOpen]);

  useEffect(() => {
    if (noteId) return;
    if (notes[0]?._id) {
      const next = new URLSearchParams(params.toString());
      next.delete("note");
      next.set("id", notes[0]._id);
      router.replace(`/artifacts?${next.toString()}`, { scroll: false });
    }
  }, [noteId, notes, params, router]);

  useEffect(() => {
    return subscribeWorkspaceContentMutated((detail) => {
      if (!activeNote?._id) return;
      if (detail.entity && detail.entity !== "artifact" && detail.entity !== "chat") return;
      if (detail.workstreamId && activeNote.workstreamId && detail.workstreamId !== activeNote.workstreamId) return;
      void fetchNote(activeNote._id);
      void refresh();
    });
  }, [activeNote?._id, activeNote?.workstreamId, fetchNote, refresh]);

  const handleSelectNote = useCallback((nextNoteId: string) => {
    const next = new URLSearchParams(params.toString());
    next.delete("note");
    next.set("id", nextNoteId);
    router.replace(`/artifacts?${next.toString()}`, { scroll: false });
  }, [params, router]);

  const handleCreateFromDialog = useCallback(async (type: ArtifactType, title: string, tags: string[], template?: ArtifactTemplate) => {
    const isDocType = type === "document" || type === "note";
    const content = template?.content ?? EMPTY_DOC;
    const createdId = await createNote({
      title,
      content,
      contentPlaintext: template?.contentPlaintext ?? "",
      editorMode: isDocType ? "standard" : undefined,
      type,
      tags,
    });
    const next = new URLSearchParams(params.toString());
    next.delete("note");
    next.set("id", createdId);
    router.replace(`/artifacts?${next.toString()}`, { scroll: false });
  }, [createNote, params, router]);

  const noteList = useMemo(() => {
    let filtered = notes.slice();
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((n) =>
        (n.title || "").toLowerCase().includes(q) ||
        (n.contentPlaintext || "").toLowerCase().includes(q),
      );
    }
    return filtered.sort((left, right) => right.updatedAt - left.updatedAt);
  }, [notes, searchQuery]);

  return (
    <AppShell fullBleed noScroll contentClassName="!p-0">
      <div className="flex h-full min-h-0">
        <aside className="flex w-[360px] shrink-0 flex-col border-r border-[var(--border-default)] bg-[var(--bg-elevated)]">
          <div className="border-b border-[var(--border-default)] px-5 py-5">
            <div className="mt-3 flex items-center justify-between">
              <div>
                <h1 className="font-display text-2xl text-[var(--text-primary)]">
                  Artifacts
                </h1>
                <p className="text-sm text-[var(--text-secondary)]">
                  {noteList.length} {noteList.length === 1 ? "artifact" : "artifacts"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateDialogOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-cyan)] px-3 py-2 text-sm font-semibold text-white hover:brightness-110 transition-all shadow-[0_2px_8px_-2px_rgba(14,142,232,0.25)]"
              >
                <Plus className="h-4 w-4" />
                New
              </button>
            </div>

            <div className="mt-3 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search artifacts..."
                className="w-full rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] pl-9 pr-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent-cyan)]/40 focus:outline-none transition-colors"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {loading ? (
              <div className="px-3 py-6 text-sm text-[var(--text-secondary)]">Loading artifacts...</div>
            ) : noteList.length > 0 ? (
              <div className="space-y-0.5">
                {noteList.map((note) => (
                  <button
                    key={note._id}
                    type="button"
                    onClick={() => handleSelectNote(note._id)}
                    className={cn(
                      "group relative w-full overflow-hidden rounded-xl px-3 py-2.5 text-left transition-all duration-150",
                      activeNote?._id === note._id
                        ? "bg-[linear-gradient(90deg,color-mix(in_oklab,var(--accent-cyan)_9%,var(--bg-primary)),transparent_72%)]"
                        : "hover:bg-[var(--bg-hover)]/65",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute inset-y-1.5 left-0 w-0.5 rounded-full transition-all duration-150",
                        activeNote?._id === note._id
                          ? "bg-[var(--accent-cyan)] opacity-100"
                          : "bg-transparent opacity-0 group-hover:opacity-60",
                      )}
                    />
                    <div className="flex items-start gap-2.5 pl-2">
                      {(() => {
                        const meta = getArtifactMeta(note.type || "document");
                        const Icon = meta.icon;
                        return (
                          <div
                            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors"
                            style={{
                              background: activeNote?._id === note._id
                                ? `color-mix(in oklab, ${meta.color} 16%, var(--bg-primary))`
                                : `color-mix(in oklab, ${meta.color} 8%, var(--bg-primary))`,
                              color: meta.color,
                            }}
                          >
                            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </div>
                        );
                      })()}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-semibold text-[var(--text-primary)]">
                          {stripGeneratedDocumentMarkers(note.title || "").trim() || "Untitled"}
                        </div>
                        <div className="mt-0.5 text-[10px] tracking-[0.01em] text-[var(--text-tertiary)]">
                          Updated {new Date(note.updatedAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-[24px] border border-dashed border-[var(--border-default)] bg-[var(--bg-primary)] px-5 py-8 text-center">
                <div className="text-3xl">📝</div>
                <div className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
                  No artifacts yet
                </div>
                <div className="mt-2 text-xs text-[var(--text-secondary)]">
                  Create your first artifact to get started.
                </div>
              </div>
            )}
          </div>
        </aside>

        <main id="artifact-main-area" className="relative flex min-h-0 flex-1 bg-[var(--bg-primary)]">
          <div className="min-h-0 min-w-0 flex-1">
            {activeNote ? (
              <TiptapEditor
                key={activeNote._id}
                artifactId={activeNote._id}
                workstreamId={activeNote.workstreamId}
                content={activeNote.content}
                showDocumentMeta
                documentTitle={activeNote.title}
                createdAt={activeNote.createdAt}
                updatedAt={activeNote.updatedAt}
                onVersionRestore={() => {
                  void fetchNote(activeNote._id);
                }}
                onSave={(content, text) =>
                  void updateNote(activeNote._id, {
                    title: stripGeneratedDocumentMarkers(text.trim().split("\n")[0] || "Untitled artifact").trim() || "Untitled artifact",
                    content,
                    contentPlaintext: stripGeneratedDocumentMarkers(text),
                    editorMode,
                  })
                }
                className="h-full"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
                Select or create an artifact.
              </div>
            )}
          </div>

          {activeNote ? (
            <aside
              className={cn(
                "min-h-0 shrink-0 border-l border-[var(--border-default)] bg-[var(--bg-elevated)]/80 backdrop-blur-xl transition-all duration-200",
                aiPanelOpen ? "w-[380px]" : "w-0 overflow-hidden border-l-0",
              )}
            >
              {
                <ArtifactAiSurface
                  key={`artifact-ai-${activeNote._id}`}
                  artifactId={activeNote._id}
                  workstreamId={activeNote.workstreamId}
                  context="full-page"
                />
              }
            </aside>
          ) : null}

          <button
            type="button"
            onClick={() => setAiPanelOpen((open) => !open)}
            className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)]/90 px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] shadow-sm backdrop-blur-md transition-colors hover:text-[var(--text-primary)]"
          >
            {aiPanelOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
            {aiPanelOpen ? "Hide AI panel" : "Show AI panel"}
          </button>
        </main>
      </div>

      <CreateArtifactDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCreate={(type, title, tags, template) => void handleCreateFromDialog(type, title, tags, template)}
      />
    </AppShell>
  );
}

export default function ArtifactsPage() {
  return (
    <Suspense>
      <ArtifactsPageInner />
    </Suspense>
  );
}
