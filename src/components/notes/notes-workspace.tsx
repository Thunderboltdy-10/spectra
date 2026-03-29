"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Plus, StickyNote } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { TiptapEditor } from "@/components/editor/tiptap-editor";
import { useNotesData } from "@/hooks/use-notes-data";
import { useEditorStore, normalizeEditorMode } from "@/stores/editor-store";
import { cn } from "@/lib/utils";

const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export function NotesWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  const noteId = params.get("note") ?? undefined;
  const returnWs = params.get("ws") ?? undefined;
  const fromWorkspace = params.get("from") === "workspace";
  const { editorMode, setEditorMode } = useEditorStore();
  const {
    notes,
    activeNote,
    loading,
    createNote,
    updateNote,
    fetchNote,
  } = useNotesData({ noteId });

  useEffect(() => {
    if (activeNote?.editorMode) {
      setEditorMode(normalizeEditorMode(activeNote.editorMode));
    }
  }, [activeNote?.editorMode, setEditorMode]);

  useEffect(() => {
    if (noteId) return;
    if (notes[0]?._id) {
      const next = new URLSearchParams(params.toString());
      next.set("note", notes[0]._id);
      router.replace(`/notes?${next.toString()}`, { scroll: false });
    }
  }, [noteId, notes, params, router]);

  const handleSelectNote = useCallback((nextNoteId: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("note", nextNoteId);
    router.push(`/notes?${next.toString()}`);
  }, [params, router]);

  const handleCreateNote = useCallback(async () => {
    const createdId = await createNote({
      title: "Untitled note",
      content: EMPTY_DOC,
      contentPlaintext: "",
      editorMode: "standard",
      workstreamId: returnWs,
    });
    const next = new URLSearchParams(params.toString());
    next.set("note", createdId);
    router.push(`/notes?${next.toString()}`);
  }, [createNote, params, returnWs, router]);

  const noteList = useMemo(() => notes.slice().sort((left, right) => right.updatedAt - left.updatedAt), [notes]);

  return (
    <AppShell fullBleed noScroll contentClassName="!p-0">
      <div className="flex h-full min-h-0">
        <aside className="flex w-[320px] shrink-0 flex-col border-r border-[var(--border-default)] bg-[var(--bg-elevated)]">
          <div className="border-b border-[var(--border-default)] px-5 py-4">
            {fromWorkspace && (
              <button
                type="button"
                onClick={() => router.push(returnWs ? `/workspace?focus=${encodeURIComponent(returnWs)}&panel=note&note=${encodeURIComponent(noteId ?? "")}` : "/workspace")}
                className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to workspace
              </button>
            )}
            <div className="mt-3 flex items-center justify-between">
              <div>
                <h1 className="font-display text-2xl text-[var(--text-primary)]">
                  Notes
                </h1>
                <p className="text-sm text-[var(--text-secondary)]">
                  {noteList.length} {noteList.length === 1 ? "document" : "documents"}
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
              <div className="px-3 py-6 text-sm text-[var(--text-secondary)]">Loading notes...</div>
            ) : noteList.length > 0 ? (
              <div className="space-y-2">
                {noteList.map((note) => (
                  <button
                    key={note._id}
                    type="button"
                    onClick={() => handleSelectNote(note._id)}
                    className={cn(
                      "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                      activeNote?._id === note._id
                        ? "border-[var(--accent-cyan)] bg-[var(--accent-cyan)]/8"
                        : "border-[var(--border-default)] bg-[var(--bg-primary)] hover:bg-[var(--bg-hover)]",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <StickyNote className="h-4 w-4 text-[var(--accent-cyan)]" />
                      <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                        {note.title}
                      </div>
                    </div>
                    <div className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                      {(note.contentPlaintext || "Start writing...").slice(0, 120)}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-[24px] border border-dashed border-[var(--border-default)] bg-[var(--bg-primary)] px-5 py-8 text-center">
                <div className="text-3xl">📝</div>
                <div className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
                  No notes yet
                </div>
                <div className="mt-2 text-xs text-[var(--text-secondary)]">
                  Create the first note here or from a focused workstream.
                </div>
              </div>
            )}
          </div>
        </aside>

        <main className="flex min-h-0 flex-1 flex-col bg-[var(--bg-primary)]">
          <div className="border-b border-[var(--border-default)] bg-[var(--bg-elevated)] px-5 py-4">
            <h2 className="truncate font-display text-lg text-[var(--text-primary)]">
              {activeNote?.title || "Choose a note"}
            </h2>
          </div>

          <div className="min-h-0 flex-1">
            {activeNote ? (
              <TiptapEditor
                noteId={activeNote._id}
                content={activeNote.content}
                onSave={(content, text) =>
                  void updateNote(activeNote._id, {
                    title: text.trim().split("\n")[0] || activeNote.title || "Untitled note",
                    content,
                    contentPlaintext: text,
                    editorMode,
                  })
                }
                onChange={() => {
                  if (activeNote?._id) {
                    void fetchNote(activeNote._id);
                  }
                }}
                className="h-full"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
                Select or create a note.
              </div>
            )}
          </div>
        </main>
      </div>
    </AppShell>
  );
}
