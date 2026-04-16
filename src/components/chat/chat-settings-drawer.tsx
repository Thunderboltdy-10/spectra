"use client";

import { useEffect, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCompactSheet } from "@/hooks/use-compact-sheet";
import { useRightPanelDock } from "@/hooks/use-right-panel-dock";
import { rightPanelSurfaceClassName } from "@/components/ui/right-panel-surface";
import { SettingsView } from "@/components/chat/unified-panel";
import type { AutoPreference, ModelOption, PersonalResource, UserSpending } from "@/hooks/use-chat-state";

type ChatSettingsDrawerProps = {
  open: boolean;
  onClose: () => void;
  models: ModelOption[];
  routerMode?: "auto" | "manual";
  manualModel?: string;
  activeModelUsed?: string;
  showCostDetails?: boolean;
  usePersonalResources: boolean;
  autoSaveConversationFilesToLibrary?: boolean;
  personalResources: PersonalResource[];
  userSpending: UserSpending | null;
  recentChatCount?: number;
  liveProgressAutoOpen?: boolean;
  autoEnhancePrompt: AutoPreference;
  autoThinking: AutoPreference;
  autoSearch: AutoPreference;
  autoCompaction: AutoPreference;
  onTogglePersonalResources: (enabled: boolean) => void;
  onAutoSaveConversationFilesToLibraryChange?: (enabled: boolean) => void;
  onLiveProgressAutoOpenChange?: (enabled: boolean) => void;
  onAutoEnhancePromptChange: (value: AutoPreference) => void;
  onAutoThinkingChange: (value: AutoPreference) => void;
  onAutoSearchChange: (value: AutoPreference) => void;
  onAutoCompactionChange: (value: AutoPreference) => void;
  onDeleteResource: (resourceId: string) => void;
  onUploadPersonalFiles?: (files: File[]) => void;
};

export function ChatSettingsDrawer({
  open,
  onClose,
  models,
  routerMode = "auto",
  manualModel = "",
  activeModelUsed,
  showCostDetails = false,
  usePersonalResources,
  autoSaveConversationFilesToLibrary = false,
  personalResources,
  userSpending,
  recentChatCount = 0,
  liveProgressAutoOpen = true,
  autoEnhancePrompt,
  autoThinking,
  autoSearch,
  autoCompaction,
  onTogglePersonalResources,
  onAutoSaveConversationFilesToLibraryChange,
  onLiveProgressAutoOpenChange,
  onAutoEnhancePromptChange,
  onAutoThinkingChange,
  onAutoSearchChange,
  onAutoCompactionChange,
  onDeleteResource,
  onUploadPersonalFiles,
}: ChatSettingsDrawerProps) {
  const compact = useCompactSheet(1024);
  const { docked, panelWidth } = useRightPanelDock({
    id: "chat-settings-drawer",
    open,
    compact,
    maxWidthPx: 448,
  });
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCollapsed(false);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={`fixed z-40 ${docked ? "inset-y-0 right-0 pointer-events-none" : "inset-0"}`}
      style={docked ? { width: `${panelWidth}px` } : undefined}
    >
      {!docked ? (
        <button
          type="button"
          className="absolute inset-0 bg-transparent transition"
          aria-label="Close settings"
          onClick={onClose}
        />
      ) : null}

      <aside
        className={`right-panel-shell ${rightPanelSurfaceClassName()} pointer-events-auto absolute flex flex-col shadow-[var(--shadow-soft)] ${
          docked ? "right-panel-shell--docked" : "right-panel-shell--sheet"
        } ${
          compact
            ? "bottom-3 left-3 right-3 max-h-[78vh] rounded-2xl border"
            : "inset-y-0 right-0 w-full max-w-md border-l"
        }`}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between px-4 pt-4 sm:px-5 sm:pt-5">
          <h2 className="font-display text-xl">Chat settings</h2>
          <div className="flex items-center gap-1.5">
            {compact ? (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => setCollapsed((prev) => !prev)}
                aria-label={collapsed ? "Expand settings" : "Collapse settings"}
              >
                <ChevronDown className={`h-4 w-4 transition ${collapsed ? "-rotate-90" : "rotate-0"}`} />
              </Button>
            ) : null}
            <Button type="button" variant="secondary" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {!collapsed ? (
          <div className={`right-panel-content ${compact ? "max-h-[calc(78vh-4rem)]" : "max-h-[calc(100vh-6rem)]"} overflow-y-auto px-4 pb-4 sm:px-5 sm:pb-5`}>
            <SettingsView
              models={models}
              routerMode={routerMode}
              manualModel={manualModel}
              activeModelUsed={activeModelUsed}
              showCostDetails={showCostDetails}
              usePersonalResources={usePersonalResources}
              autoSaveConversationFilesToLibrary={autoSaveConversationFilesToLibrary}
              personalResources={personalResources}
              userSpending={userSpending}
              recentChatCount={recentChatCount}
              liveProgressAutoOpen={liveProgressAutoOpen}
              autoEnhancePrompt={autoEnhancePrompt}
              autoThinking={autoThinking}
              autoSearch={autoSearch}
              autoCompaction={autoCompaction}
              onTogglePersonalResources={onTogglePersonalResources}
              onAutoSaveConversationFilesToLibraryChange={onAutoSaveConversationFilesToLibraryChange ?? (() => {})}
              onLiveProgressAutoOpenChange={onLiveProgressAutoOpenChange ?? (() => {})}
              onAutoEnhancePromptChange={onAutoEnhancePromptChange}
              onAutoThinkingChange={onAutoThinkingChange}
              onAutoSearchChange={onAutoSearchChange}
              onAutoCompactionChange={onAutoCompactionChange}
              onDeleteResource={onDeleteResource}
              onUploadPersonalFiles={onUploadPersonalFiles ?? (() => {})}
            />
          </div>
        ) : null}
      </aside>
    </div>
  );
}
