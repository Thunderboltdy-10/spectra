"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Plus, StickyNote } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { TiptapEditor } from "@/components/editor/tiptap-editor";
import { useNotesData } from "@/hooks/use-notes-data";
import { useEditorStore, normalizeEditorMode } from "@/stores/editor-store";
import { cn } from "@/lib/utils";
import { stripGeneratedDocumentMarkers } from "@/lib/document-generator";

const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export function NotesWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  const noteId = params.get("id") ?? params.get("note") ?? undefined;
  const versionHistoryOpen = params.get("versionHistory") === "1" || params.get("versionHistory") === "true";
  const returnWs = params.get("ws") ?? undefined;
  const fromWorkspace = params.get("from") === "workspace";
  const { editorMode, setEditorMode, openVersionHistory } = useEditorStore();
  const {
    notes,
    activeNote,
    loading,
    createNote,
    fetchNote,
    updateNote,
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

  const handleSelectNote = useCallback((nextNoteId: string) => {
    const next = new URLSearchParams(params.toString());
    next.delete("note");
    next.set("id", nextNoteId);
    router.replace(`/artifacts?${next.toString()}`, { scroll: false });
  }, [params, router]);

  const handleCreateNote = useCallback(async () => {
    const createdId = await createNote({
      title: "Untitled artifact",
      content: EMPTY_DOC,
      contentPlaintext: "",
      editorMode: "standard",
      workstreamId: returnWs,
    });
    const next = new URLSearchParams(params.toString());
    next.delete("note");
    next.set("id", createdId);
    router.replace(`/artifacts?${next.toString()}`, { scroll: false });
  }, [createNote, params, returnWs, router]);

  const noteList = useMemo(() => notes.slice().sort((left, right) => right.updatedAt - left.updatedAt), [notes]);

  return (
    <AppShell fullBleed noScroll contentClassName="!p-0">
      <div className="flex h-full min-h-0">
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-[var(--border-default)] bg-[var(--bg-elevated)]">
          <div className="border-b border-[var(--border-default)] px-5 py-5">
            {fromWorkspace && (
              <button
                type="button"
                onClick={() => router.push(returnWs ? `/workspace?focus=${encodeURIComponent(returnWs)}&panel=artifact&artifact=${encodeURIComponent(noteId ?? "")}` : "/workspace")}
                className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to workspace
              </button>
            )}
            <div className="mt-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                  Personal Library
                </div>
                <h1 className="font-display text-2xl text-[var(--text-primary)]">
                  Artifacts
                </h1>
                <p className="text-sm text-[var(--text-secondary)]">
                  {noteList.length} {noteList.length === 1 ? "artifact" : "artifacts"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleCreateNote()}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-cyan)] px-3 py-2 text-sm font-semibold text-white"
              >
                <Plus className="h-4 w-4" />
                New
              </button>
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
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--text-tertiary)] transition-colors group-hover:text-[var(--accent-cyan)]">
                        <StickyNote className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </div>
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
                  Create the first document artifact here or from a focused workstream.
                </div>
              </div>
            )}
          </div>
        </aside>

        <main className="flex min-h-0 flex-1 flex-col bg-[var(--bg-primary)]">
          <div className="min-h-0 flex-1">
            {activeNote ? (
              <TiptapEditor
                artifactId={activeNote._id}
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
        </main>
      </div>
    </AppShell>
  );
}
