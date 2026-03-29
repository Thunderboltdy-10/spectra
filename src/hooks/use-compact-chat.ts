"use client";

import { useChatPanel } from "@/hooks/use-chat-panel";
import type { PanelChatMessage } from "@/lib/chat/message-state";

export type CompactMessage = PanelChatMessage;

export function useCompactChat(workstreamId?: string) {
  return useChatPanel({
    workstreamId,
    threadType: "conversation",
    mode: "tutor",
    thinkingLevel: "low",
    routerMode: "auto",
    usePersonalResources: true,
  });
}
