"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { stripGeneratedDocumentMarkers } from "@/lib/document-generator";

export type WorkspaceDocument = {
  _id: string;
  workstreamId?: string;
  artifactId?: string;
  type?: string;
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

function sanitizeDocumentRecord(document: WorkspaceDocument): WorkspaceDocument {
  const title = stripGeneratedDocumentMarkers(document.title || "").trim() || "Untitled";
  const contentPlaintext = document.contentPlaintext
    ? stripGeneratedDocumentMarkers(document.contentPlaintext)
    : document.contentPlaintext;
  return {
    ...document,
    title,
    contentPlaintext,
  };
}

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
      qs.set("type", "document");
      qs.set("limit", String(limit));

      const response = await fetch(`/api/artifacts?${qs.toString()}`, {
        signal: ac.signal,
      });
      if (!response.ok) throw new Error("Failed to load documents");
      const data = (await response.json()) as { artifacts: WorkspaceDocument[] };
      setDocuments((data.artifacts ?? []).map(sanitizeDocumentRecord));
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
      const response = await fetch(`/api/artifacts?action=get&id=${encodeURIComponent(nextArtifactId)}`);
      if (!response.ok) throw new Error("Failed to load document");
      const data = (await response.json()) as { artifact: WorkspaceDocument };
      const sanitizedArtifact = sanitizeDocumentRecord(data.artifact);
      setActiveDocument(sanitizedArtifact);
      setDocuments((current) => {
        const existingIndex = current.findIndex((document) => document._id === sanitizedArtifact._id);
        if (existingIndex === -1) {
          return [sanitizedArtifact, ...current];
        }
        const next = current.slice();
        next[existingIndex] = { ...next[existingIndex], ...sanitizedArtifact };
        return next;
      });
      setError(null);
      return sanitizedArtifact;
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
      const artifactPayload = {
        action: "create",
        type: "document",
        ...input,
      };
      const response = await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(artifactPayload),
      });
      if (!response.ok) throw new Error("Failed to create document");
      const data = (await response.json()) as { artifactId: string };
      await listDocuments();
      if (data.artifactId) {
        await fetchDocument(data.artifactId);
      }
      return data.artifactId;
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
      const artifactPayload = {
        action: "update",
        artifactId: nextArtifactId,
        ...input,
      };
      const response = await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(artifactPayload),
      });
      if (!response.ok) throw new Error("Failed to update document");
      const updatedAt = Date.now();
      setDocuments((current) => current.map((document) => (
        document._id === nextArtifactId
          ? sanitizeDocumentRecord({
              ...document,
              ...input,
              _id: document._id,
              updatedAt,
            } as WorkspaceDocument)
          : document
      )));
      setActiveDocument((current) => {
        if (!current || current._id !== nextArtifactId) return current;
        return sanitizeDocumentRecord({
          ...current,
          ...input,
          _id: current._id,
          updatedAt,
        } as WorkspaceDocument);
      });
      return sanitizeDocumentRecord({
        ...(activeDocument?._id === nextArtifactId ? activeDocument : null),
        ...input,
        _id: nextArtifactId,
        updatedAt,
      } as WorkspaceDocument);
    },
    [activeDocument],
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
