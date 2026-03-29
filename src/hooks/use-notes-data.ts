"use client";

import { useArtifactData, type WorkspaceDocument } from "@/hooks/use-artifact-data";

export type WorkspaceNote = WorkspaceDocument;

type UseNotesDataParams = {
  workstreamId?: string;
  noteId?: string;
  limit?: number;
};

export function useNotesData(params: UseNotesDataParams = {}) {
  const { workstreamId, noteId, limit } = params;
  const artifactData = useArtifactData({
    workstreamId,
    artifactId: noteId,
    limit,
  });

  return {
    notes: artifactData.documents,
    activeNote: artifactData.activeDocument,
    loading: artifactData.loading,
    loadingNote: artifactData.loadingDocument,
    error: artifactData.error,
    refresh: artifactData.refresh,
    fetchNote: artifactData.fetchDocument,
    createNote: artifactData.createDocument,
    updateNote: artifactData.updateDocument,
  };
}
