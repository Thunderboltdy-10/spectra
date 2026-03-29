"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type WorkspaceDocument = {
  _id: string;
  workstreamId?: string;
  artifactId?: string;
  title: string;
  content: object | null;
  contentPlaintext?: string;
  editorMode: string;
  sourceType?: "user_manual" | "ai_generated" | "managebac_sync";
  managebacItemId?: string;
  sourceDeleted?: boolean;
  sourceUpdatedAt?: number;
  syncConflictSummary?: string;
  lastAiEditId?: string;
  pendingDiffs?: unknown;
  createdAt: number;
  updatedAt: number;
};

type UseArtifactDataParams = {
  workstreamId?: string;
  artifactId?: string;
  limit?: number;
};

export function useArtifactData(params: UseArtifactDataParams = {}) {
  const { workstreamId, artifactId, limit = 100 } = params;
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [activeDocument, setActiveDocument] = useState<WorkspaceDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const listDocuments = useCallback(async () => {
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
      if (!response.ok) throw new Error("Failed to load documents");
      const data = (await response.json()) as { notes: WorkspaceDocument[] };
      setDocuments(data.notes ?? []);
      setError(null);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Failed to load documents");
      }
    } finally {
      setLoading(false);
    }
  }, [limit, workstreamId]);

  const fetchDocument = useCallback(async (nextArtifactId: string) => {
    setLoadingDocument(true);
    try {
      const response = await fetch(`/api/notes?action=get&id=${encodeURIComponent(nextArtifactId)}`);
      if (!response.ok) throw new Error("Failed to load document");
      const data = (await response.json()) as { note: WorkspaceDocument };
      setActiveDocument(data.note);
      setError(null);
      return data.note;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load document");
      return null;
    } finally {
      setLoadingDocument(false);
    }
  }, []);

  useEffect(() => {
    void listDocuments();
    return () => abortRef.current?.abort();
  }, [listDocuments]);

  useEffect(() => {
    if (!artifactId) {
      setActiveDocument(null);
      return;
    }

    const found = documents.find((document) => document._id === artifactId);
    if (found?.content) {
      setActiveDocument(found);
      return;
    }

    void fetchDocument(artifactId);
  }, [artifactId, documents, fetchDocument]);

  const createDocument = useCallback(
    async (input: {
      title: string;
      content?: object;
      contentPlaintext?: string;
      editorMode?: WorkspaceDocument["editorMode"];
      workstreamId?: string;
      sourceType?: WorkspaceDocument["sourceType"];
      managebacItemId?: string;
      sourceDeleted?: boolean;
      sourceUpdatedAt?: number;
      syncConflictSummary?: string;
    }) => {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          ...input,
        }),
      });
      if (!response.ok) throw new Error("Failed to create document");
      const data = (await response.json()) as { noteId: string };
      await listDocuments();
      if (data.noteId) {
        await fetchDocument(data.noteId);
      }
      return data.noteId;
    },
    [fetchDocument, listDocuments],
  );

  const updateDocument = useCallback(
    async (
      nextArtifactId: string,
      input: Partial<
        Pick<
          WorkspaceDocument,
          | "title"
          | "content"
          | "contentPlaintext"
          | "editorMode"
          | "workstreamId"
          | "artifactId"
          | "sourceType"
          | "managebacItemId"
          | "sourceDeleted"
          | "sourceUpdatedAt"
          | "syncConflictSummary"
          | "lastAiEditId"
          | "pendingDiffs"
        >
      >,
    ) => {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          noteId: nextArtifactId,
          ...input,
        }),
      });
      if (!response.ok) throw new Error("Failed to update document");
      const data = (await response.json()) as { noteId?: string };
      await listDocuments();
      return fetchDocument(data.noteId ?? nextArtifactId);
    },
    [fetchDocument, listDocuments],
  );

  return {
    documents,
    activeDocument,
    loading,
    loadingDocument,
    error,
    refresh: listDocuments,
    listDocuments,
    fetchDocument,
    createDocument,
    updateDocument,
  };
}
