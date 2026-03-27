"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type WorkspaceNote = {
  _id: string;
  workstreamId?: string;
  artifactId?: string;
  title: string;
  content: object | null;
  contentPlaintext?: string;
  editorMode: "agentic" | "notion" | "simple";
  lastAiEditId?: string;
  pendingDiffs?: unknown;
  createdAt: number;
  updatedAt: number;
};

type UseNotesDataParams = {
  workstreamId?: string;
  noteId?: string;
  limit?: number;
};

export function useNotesData(params: UseNotesDataParams = {}) {
  const { workstreamId, noteId, limit = 100 } = params;
  const [notes, setNotes] = useState<WorkspaceNote[]>([]);
  const [activeNote, setActiveNote] = useState<WorkspaceNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingNote, setLoadingNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchNotes = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const qs = new URLSearchParams();
      if (workstreamId) qs.set("workstreamId", workstreamId);
      qs.set("limit", String(limit));

      const response = await fetch(`/api/notes?${qs.toString()}`, {
        signal: ac.signal,
      });
      if (!response.ok) throw new Error("Failed to load notes");
      const data = (await response.json()) as { notes: WorkspaceNote[] };
      setNotes(data.notes ?? []);
      setError(null);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Failed to load notes");
      }
    } finally {
      setLoading(false);
    }
  }, [limit, workstreamId]);

  const fetchNote = useCallback(async (nextNoteId: string) => {
    setLoadingNote(true);
    try {
      const response = await fetch(`/api/notes?action=get&id=${encodeURIComponent(nextNoteId)}`);
      if (!response.ok) throw new Error("Failed to load note");
      const data = (await response.json()) as { note: WorkspaceNote };
      setActiveNote(data.note);
      setError(null);
      return data.note;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load note");
      return null;
    } finally {
      setLoadingNote(false);
    }
  }, []);

  useEffect(() => {
    void fetchNotes();
    return () => abortRef.current?.abort();
  }, [fetchNotes]);

  useEffect(() => {
    if (!noteId) {
      setActiveNote(null);
      return;
    }

    const found = notes.find((note) => note._id === noteId);
    if (found?.content) {
      setActiveNote(found);
      return;
    }

    void fetchNote(noteId);
  }, [fetchNote, noteId, notes]);

  const createNote = useCallback(
    async (input: {
      title: string;
      content?: object;
      contentPlaintext?: string;
      editorMode?: WorkspaceNote["editorMode"];
      workstreamId?: string;
    }) => {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          ...input,
        }),
      });
      if (!response.ok) throw new Error("Failed to create note");
      const data = (await response.json()) as { noteId: string };
      await fetchNotes();
      if (data.noteId) {
        await fetchNote(data.noteId);
      }
      return data.noteId;
    },
    [fetchNote, fetchNotes],
  );

  const updateNote = useCallback(
    async (
      nextNoteId: string,
      input: Partial<
        Pick<
          WorkspaceNote,
          "title" | "content" | "contentPlaintext" | "editorMode" | "workstreamId" | "artifactId" | "lastAiEditId" | "pendingDiffs"
        >
      >,
    ) => {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          noteId: nextNoteId,
          ...input,
        }),
      });
      if (!response.ok) throw new Error("Failed to update note");
      await fetchNotes();
      const refreshed = await fetchNote(nextNoteId);
      return refreshed;
    },
    [fetchNote, fetchNotes],
  );

  return {
    notes,
    activeNote,
    loading,
    loadingNote,
    error,
    refresh: fetchNotes,
    fetchNote,
    createNote,
    updateNote,
  };
}
