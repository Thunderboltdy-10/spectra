"use client";

import { create } from "zustand";

export type EditorMode = "agentic" | "notion" | "simple";

type DiffOperation = {
  type: "replace" | "insert" | "delete";
  from: number;
  to: number;
  content?: unknown;
  reason?: string;
};

type EditorStoreState = {
  activeArtifactId?: string;
  activeNoteId?: string;
  editorMode: EditorMode;
  pendingDiffs: DiffOperation[];
  aiBarPrompt: string;
  aiBarAutoAccept: boolean;
  aiBarBusy: boolean;
  isVersionHistoryOpen: boolean;
  selectedVersionId?: string;
  setActiveArtifactId: (artifactId?: string) => void;
  setActiveNoteId: (noteId?: string) => void;
  setEditorMode: (mode: EditorMode) => void;
  setPendingDiffs: (diffs: DiffOperation[]) => void;
  clearPendingDiffs: () => void;
  setAiBarPrompt: (prompt: string) => void;
  setAiBarAutoAccept: (enabled: boolean) => void;
  setAiBarBusy: (busy: boolean) => void;
  openVersionHistory: (versionId?: string) => void;
  closeVersionHistory: () => void;
  reset: () => void;
};

export const useEditorStore = create<EditorStoreState>((set) => ({
  activeArtifactId: undefined,
  activeNoteId: undefined,
  editorMode: "notion",
  pendingDiffs: [],
  aiBarPrompt: "",
  aiBarAutoAccept: true,
  aiBarBusy: false,
  isVersionHistoryOpen: false,
  selectedVersionId: undefined,
  setActiveArtifactId: (activeArtifactId) => set({ activeArtifactId }),
  setActiveNoteId: (activeNoteId) => set({ activeNoteId }),
  setEditorMode: (editorMode) => set({ editorMode }),
  setPendingDiffs: (pendingDiffs) => set({ pendingDiffs }),
  clearPendingDiffs: () => set({ pendingDiffs: [] }),
  setAiBarPrompt: (aiBarPrompt) => set({ aiBarPrompt }),
  setAiBarAutoAccept: (aiBarAutoAccept) => set({ aiBarAutoAccept }),
  setAiBarBusy: (aiBarBusy) => set({ aiBarBusy }),
  openVersionHistory: (selectedVersionId) => set({ isVersionHistoryOpen: true, selectedVersionId }),
  closeVersionHistory: () => set({ isVersionHistoryOpen: false, selectedVersionId: undefined }),
  reset: () =>
    set({
      activeArtifactId: undefined,
      activeNoteId: undefined,
      editorMode: "notion",
      pendingDiffs: [],
      aiBarPrompt: "",
      aiBarAutoAccept: true,
      aiBarBusy: false,
      isVersionHistoryOpen: false,
      selectedVersionId: undefined,
    }),
}));
