"use client";

import { create } from "zustand";

type ChatPanelStoreState = {
  isOpen: boolean;
  activeWorkstreamId?: string;
  activeThreadId?: string;
  draftMessage: string;
  openPanel: (workstreamId?: string, threadId?: string) => void;
  closePanel: () => void;
  setActiveWorkstreamId: (workstreamId?: string) => void;
  setActiveThreadId: (threadId?: string) => void;
  setDraftMessage: (draftMessage: string) => void;
  reset: () => void;
};

export const useChatPanelStore = create<ChatPanelStoreState>((set) => ({
  isOpen: false,
  activeWorkstreamId: undefined,
  activeThreadId: undefined,
  draftMessage: "",
  openPanel: (activeWorkstreamId, activeThreadId) =>
    set({
      isOpen: true,
      activeWorkstreamId,
      activeThreadId,
    }),
  closePanel: () => set({ isOpen: false }),
  setActiveWorkstreamId: (activeWorkstreamId) => set({ activeWorkstreamId }),
  setActiveThreadId: (activeThreadId) => set({ activeThreadId }),
  setDraftMessage: (draftMessage) => set({ draftMessage }),
  reset: () =>
    set({
      isOpen: false,
      activeWorkstreamId: undefined,
      activeThreadId: undefined,
      draftMessage: "",
    }),
}));
