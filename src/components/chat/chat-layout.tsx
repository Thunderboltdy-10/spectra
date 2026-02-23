"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { CircleHelp } from "lucide-react";
import { toast } from "sonner";
import { ChatComposer } from "@/components/chat/chat-composer";
import { CodeCanvas } from "@/components/chat/code-canvas";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatMessages } from "@/components/chat/chat-messages";
import { QuickActions } from "@/components/chat/quick-actions";
import { UnifiedPanel } from "@/components/chat/unified-panel";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { ChatWelcome } from "@/components/chat/chat-welcome";
import { KeyboardShortcutsRegistrar } from "@/components/keyboard-shortcuts";
import type { GuidedTourStep } from "@/components/ui/guided-tour";
import { Button } from "@/components/ui/button";
import { useChatState } from "@/hooks/use-chat-state";
import { usePanel } from "@/context/panel-context";
import type { StudyMode } from "@/types";
import {
  downloadTextFile,
  exportConversationMarkdown,
  exportConversationPlainText,
} from "@/lib/export/markdown-export";
import { exportElementToPrintPdf } from "@/lib/export/pdf-export";
import { parseSlashCommand, normalizeModeArg, SLASH_COMMANDS } from "@/lib/slash-commands";
import { useCanvasState } from "@/hooks/use-canvas-state";
import { FILE_LIMITS } from "@/lib/file-limits";

const GuidedTour = dynamic(
  () => import("@/components/ui/guided-tour").then((module) => module.GuidedTour),
  { ssr: false },
);

function SidebarSkeleton() {
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="h-10 w-32 animate-pulse rounded-xl bg-[var(--bg-secondary)]" />
      <div className="h-10 w-full animate-pulse rounded-xl bg-[var(--bg-secondary)]" />
      <div className="h-16 w-full animate-pulse rounded-xl bg-[var(--bg-secondary)]" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-12 w-full animate-pulse rounded-xl bg-[var(--bg-secondary)]" />
      ))}
    </div>
  );
}

const TOUR_COMPLETED_KEY = "ai-school-guided-tour-v1";
const QUICK_ACTION_MODE_CYCLE: StudyMode[] = [
  "tutor",
  "quiz",
  "flashcard",
  "research",
  "explain",
  "general",
  "exam",
  "draft_coach",
  "marker",
  "image",
];

function nextQuickActionMode(current: StudyMode): StudyMode {
  const index = QUICK_ACTION_MODE_CYCLE.indexOf(current);
  if (index < 0) return QUICK_ACTION_MODE_CYCLE[0];
  return QUICK_ACTION_MODE_CYCLE[(index + 1) % QUICK_ACTION_MODE_CYCLE.length];
}

const TOUR_STEPS: GuidedTourStep[] = [
  {
    selector: '[data-tour="sidebar"]',
    title: "Sidebar",
    description: "Navigate pages, find recent chats, and jump back into prior sessions quickly.",
    position: "right",
  },
  {
    selector: '[data-tour="mode-selector"]',
    title: "Mode selector",
    description: "Choose how you study: Tutor, Quiz, Flashcards, Research, and more.",
    position: "top",
  },
  {
    selector: '[data-tour="model-selector"]',
    title: "Model selector",
    description: "Keep auto-routing on or manually choose a model for this conversation.",
    position: "top",
  },
  {
    selector: '[data-tour="settings-trigger"]',
    title: "Settings panel",
    description: "Open session settings for reasoning depth, search behavior, and resources.",
    position: "bottom",
  },
  {
    selector: '[data-tour="composer"]',
    title: "Composer",
    description: "Type your prompt here, attach files, and send when ready.",
    position: "top",
  },
];

export function ChatLayout() {
  const chat = useChatState();
  const canvas = useCanvasState();
  const panel = usePanel();
  const [tourOpen, setTourOpen] = useState(false);
  const [isZenMode, setIsZenMode] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const completed = window.localStorage.getItem(TOUR_COMPLETED_KEY);
        if (completed !== "1") {
          setTourOpen(true);
        }
      } catch {
        setTourOpen(true);
      }
    }, 450);

    return () => window.clearTimeout(timer);
  }, []);

  function markTourSeen() {
    try {
      window.localStorage.setItem(TOUR_COMPLETED_KEY, "1");
    } catch {
      // Ignore storage failures.
    }
  }

  useEffect(() => {
    document.body.classList.toggle("zen-mode", isZenMode);
    return () => {
      document.body.classList.remove("zen-mode");
    };
  }, [isZenMode]);

  useEffect(() => {
    if (!isZenMode) return;
    chat.setMobileSidebarOpen(false);
    panel.closePanel();
    setTourOpen(false);
  }, [chat, isZenMode, panel]);

  const lastModelUsed = useMemo(() => {
    const lastAssistant = [...chat.messages].reverse().find((item) => item.role === "assistant");
    return lastAssistant?.modelUsed ?? chat.lastAutoResult?.modelUsed;
  }, [chat.lastAutoResult?.modelUsed, chat.messages]);
  const latestRouteTrace = useMemo(() => {
    const lastAssistant = [...chat.messages].reverse().find((item) => item.role === "assistant" && item.routeTrace);
    return lastAssistant?.routeTrace;
  }, [chat.messages]);
  const regenModels = useMemo(
    () =>
      chat.models.slice(0, 5).map((model) => ({
        modelId: model.modelId,
        name: model.name,
      })),
    [chat.models],
  );

  function handleModeChange(mode: StudyMode) {
    chat.setMode(mode);
    toast.success(`Mode changed to ${mode}`);
    void chat.updateExistingChatSettings({ mode }).catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Failed to update mode"),
    );
  }

  function handleRegenerateLastResponse() {
    void chat.regenerateLastResponse();
  }

  function handleRegenerateWithModel(modelId: string) {
    void chat.regenerateWithModel(modelId);
  }

  function handleCycleMode() {
    const nextMode = nextQuickActionMode(chat.mode);
    handleModeChange(nextMode);
  }

  function handleToggleSearchQuickAction() {
    const nextAutoSearch = chat.autoSearch === "off" ? "on" : "off";
    chat.setAutoSearch(nextAutoSearch);
    toast.success(`Web search ${nextAutoSearch === "off" ? "off" : "on"}`);
  }

  function handlePinChat(chatId: string) {
    chat.pinChat(chatId);
  }

  async function handleSlashCommand(raw: string) {
    const parsed = parseSlashCommand(raw);
    if (!parsed) return false;

    if (parsed.id === "search") {
      const arg = parsed.args[0]?.toLowerCase();
      if (arg === "on") chat.setAutoSearch("on");
      else if (arg === "off") chat.setAutoSearch("off");
      else chat.setAutoSearch("auto");
      chat.setMessage("");
      toast.success(`Search set to ${arg ?? "auto"}`);
      return true;
    }

    if (parsed.id === "mode") {
      const arg = parsed.args[0] ?? "";
      const normalized = normalizeModeArg(arg);
      if (!normalized) {
        toast.error("Invalid mode");
        return true;
      }
      handleModeChange(normalized);
      chat.setMessage("");
      return true;
    }

    if (parsed.id === "model") {
      const modelId = parsed.args.join(" ").trim();
      if (!modelId) {
        toast.error("Provide a model id");
        return true;
      }
      chat.setManualModel(modelId);
      chat.setRouterMode("manual");
      void chat.updateExistingChatSettings({ routerMode: "manual", manualModel: modelId }).catch(() => {});
      chat.setMessage("");
      return true;
    }

    if (parsed.id === "clear") {
      chat.startNewChat(chat.selectedAgentId);
      chat.setMessage("");
      return true;
    }

    if (parsed.id === "help") {
      toast.message(SLASH_COMMANDS.map((item) => item.usage).join(" • "));
      return true;
    }

    if (parsed.id === "export") {
      const format = parsed.args[0]?.toLowerCase() ?? "markdown";
      if (format === "pdf") {
        const node = document.querySelector("main");
        if (node instanceof HTMLElement) {
          exportElementToPrintPdf(node, chat.selectedChat?.title ?? "Conversation");
        }
      } else if (format === "text" || format === "txt" || format === "plain") {
        const plainText = exportConversationPlainText({
          title: chat.selectedChat?.title ?? "Conversation",
          messages: chat.messages,
        });
        downloadTextFile("conversation.txt", plainText);
      } else {
        const markdown = exportConversationMarkdown({
          title: chat.selectedChat?.title ?? "Conversation",
          messages: chat.messages,
        });
        downloadTextFile("conversation.md", markdown);
      }
      chat.setMessage("");
      return true;
    }

    return false;
  }

  if (chat.loading) {
    return (
      <div className="grid h-screen grid-cols-[320px_1fr] bg-[var(--bg-primary)]">
        <aside className="hidden md:block">
          <SidebarSkeleton />
        </aside>
        <div className="flex flex-col items-center justify-center">
          <div className="text-center">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-secondary)]">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-default)] border-t-[var(--accent-cyan)]" />
            </div>
            <p className="text-[var(--text-secondary)]">Loading your AI workspace...</p>
          </div>
        </div>
      </div>
    );
  }

  const sidebarProps = {
    chats: chat.filteredChats,
    selectedChatId: chat.selectedChatId,
    search: chat.search,
    onSearchChange: chat.setSearch,
    onSelectChat: (chatId: string) => {
      chat.setSelectedChatId(chatId);
      chat.setMobileSidebarOpen(false);
    },
    onNewChat: () => chat.startNewChat(chat.selectedAgentId),
    onDeleteChat: (chatId: string) => void chat.handleDeleteChat(chatId),
    onRenameChat: (chatId: string, title: string) => void chat.renameChat(chatId, title),
    onOpenSettings: () => panel.openPanel("settings"),
    onPinChat: handlePinChat,
    pinnedChatIds: chat.pinnedChatIds,
    role: chat.role,
    isSuperAdmin: chat.isSuperAdmin,
    userSpending: chat.userSpending,
    userMemorySummary: chat.userMemorySummary,
    collapsed: !chat.sidebarOpen,
    onToggleCollapse: () => chat.setSidebarOpen((prev) => !prev),
    orgName: chat.orgName,
    orgLogoUrl: chat.orgLogoUrl,
    activeStreamIds: chat.activeStreamIds,
    hasDraft: chat.hasDraft,
  };

  return (
    <div className={`flex h-screen min-w-0 overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] ${isZenMode ? "zen-layout" : ""}`}>
      <KeyboardShortcutsRegistrar
        onToggleZen={() => setIsZenMode((prev) => !prev)}
        onEscape={() => {
          if (isZenMode) setIsZenMode(false);
        }}
      />

      {!isZenMode ? (
        <aside
        data-tour="sidebar"
        className={`hidden transition-all duration-300 md:block ${
          chat.sidebarOpen ? "w-[320px]" : "w-[76px]"
        }`}
      >
        <ChatSidebar {...sidebarProps} />
        </aside>
      ) : null}

      {!isZenMode && chat.mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/45 backdrop-blur-sm"
            onClick={() => chat.setMobileSidebarOpen(false)}
            aria-label="Close sidebar"
          />
          <aside className="absolute inset-y-0 left-0 w-[88vw] max-w-[340px] border-r border-[var(--border-default)] bg-[var(--bg-sidebar)] shadow-[var(--shadow-soft)]">
            <ChatSidebar
              {...sidebarProps}
              collapsed={false}
              onToggleCollapse={() => chat.setMobileSidebarOpen(false)}
            />
          </aside>
        </div>
      )}

      <main className={`flex min-w-0 flex-1 flex-col overflow-hidden ${isZenMode ? "mx-auto w-full max-w-5xl zen-main" : ""}`}>
        <ChatHeader
          title={chat.selectedChat?.title ?? "New chat"}
          chatId={chat.selectedChatId || undefined}
          agentLabel={chat.selectedAgent ? `${chat.selectedAgent.avatarEmoji} ${chat.selectedAgent.name}` : undefined}
          lastModelUsed={lastModelUsed}
          sending={chat.sending}
          messageCount={chat.messages.length}
          compacting={chat.compactingConversation}
          isZenMode={isZenMode}
          onStop={chat.stopGeneration}
          onCompact={() => void chat.compactConversation()}
          onToggleZen={() => setIsZenMode((prev) => !prev)}
          onToggleMobileSidebar={() => chat.setMobileSidebarOpen(true)}
          onOpenSettings={() => panel.openPanel("settings")}
          onNewChat={() => chat.startNewChat(chat.selectedAgentId)}
          onExport={(format) => {
            if (format === "pdf") {
              const node = document.querySelector("main");
              if (node instanceof HTMLElement) {
                exportElementToPrintPdf(node, chat.selectedChat?.title ?? "Conversation");
              }
              return;
            }
            if (format === "text") {
              const plainText = exportConversationPlainText({
                title: chat.selectedChat?.title ?? "Conversation",
                messages: chat.messages,
              });
              downloadTextFile("conversation.txt", plainText);
              return;
            }
            const markdown = exportConversationMarkdown({
              title: chat.selectedChat?.title ?? "Conversation",
              messages: chat.messages,
            });
            downloadTextFile("conversation.md", markdown);
          }}
        />

        <ChatMessages
          messages={chat.messages}
          draftResponse={chat.draftResponse}
          draftThinking={chat.draftThinking}
          hasRealThinking={chat.hasRealThinking}
          sending={chat.sending}
          streamError={chat.streamError}
          chatId={chat.selectedChatId}
          onRetry={() => void chat.retryLastMessage()}
          onSubmitQuizAnswers={(payload) => {
            void chat.submitQuizAnswers(payload);
          }}
          onSaveFlashcardDeck={(payload) => {
            void chat.saveFlashcardDeck(payload);
          }}
          onRateFlashcardCard={(payload) => {
            void chat.rateFlashcardCard({
              cardHash: payload.cardHash,
              quality: payload.quality,
            });
          }}
          onFollowUp={(followUpMessage) => {
            void chat.sendMessage(followUpMessage, {
              chatIdOverride: chat.selectedChatId || undefined,
              skipLocalUser: false,
              retryAttempt: 0,
            });
          }}
          onModeChange={(newMode) => {
            handleModeChange(newMode as StudyMode);
          }}
          onRegenerate={handleRegenerateLastResponse}
          onRegenerateWithModel={handleRegenerateWithModel}
          onEditMessage={async (messageId, newContent) => {
            try {
              await chat.editAndResend(messageId, newContent);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Failed to edit message");
            }
          }}
          onBranchMessage={async (messageId) => {
            try {
              await chat.branchFromMessage(messageId);
              toast.success("Branch created");
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Failed to create branch");
            }
          }}
          onToggleBookmarkMessage={async (messageId) => {
            await chat.toggleBookmark(messageId);
          }}
          bookmarkedMessageIds={chat.bookmarkedMessageIds}
          bookmarkingMessageId={chat.bookmarkingMessageId}
          onAssistantFeedback={(positive, modelId) => {
            void chat.recordAssistantFeedback(modelId, positive);
          }}
          regenModels={regenModels}
          mode={chat.mode}
          thinkingLevel={chat.thinkingLevel}
          lastModelUsed={lastModelUsed}
          lastAutoResult={chat.lastAutoResult}
          activeCollaborators={chat.activeCollaborators}
          collaboratorPhase={chat.collaboratorPhase}
          onOpenCanvas={(payload) => {
            canvas.openCanvas({
              code: payload.code,
              language: payload.language,
              label: "From chat response",
            });
          }}
          emptyState={
            <ChatWelcome
              agents={chat.agents}
              onSelectAgent={(agentId) => chat.startNewChat(agentId)}
              onSelectMode={handleModeChange}
              onResumeChat={(chatId) => chat.setSelectedChatId(chatId)}
              onUsePrompt={(prompt, mode) => {
                if (mode) {
                  handleModeChange(mode);
                }
                chat.setMessage(prompt);
              }}
              activeMode={chat.mode}
              recentChats={chat.chats}
              welcomeMessage={chat.orgWelcomeMessage}
            />
          }
        />

        {!isZenMode ? (
          <QuickActions
            mode={chat.mode}
            nextMode={nextQuickActionMode(chat.mode)}
            autoSearch={chat.autoSearch}
            compacting={chat.compactingConversation}
            compactDisabled={!chat.selectedChatId || chat.sending}
            onCycleMode={handleCycleMode}
            onToggleSearch={handleToggleSearchQuickAction}
            onCompact={() => void chat.compactConversation()}
            onNewChat={() => chat.startNewChat(chat.selectedAgentId)}
            onToggleZen={() => setIsZenMode((prev) => !prev)}
          />
        ) : null}

        <ChatComposer
          message={chat.message}
          onMessageChange={chat.setMessage}
          fileList={chat.fileList}
          fileUploadState={chat.fileUploadState}
          onFilesAdd={(files) =>
            chat.setFileList((prev) => {
              const seen = new Set(prev.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
              const deduped = files.filter((file) => {
                const key = `${file.name}:${file.size}:${file.lastModified}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              if (deduped.length === 0) return prev;

              const available = Math.max(0, FILE_LIMITS.maxConversationAttachments - prev.length);
              if (available <= 0) {
                toast.error(
                  `Attachment limit reached (${FILE_LIMITS.maxConversationAttachments} files per conversation).`,
                );
                return prev;
              }
              if (deduped.length > available) {
                toast.warning(
                  `Only ${available} file${available === 1 ? "" : "s"} added. Limit is ${FILE_LIMITS.maxConversationAttachments} files per conversation.`,
                );
              }
              return [...prev, ...deduped.slice(0, available)];
            })}
          onRemoveFile={(file) => chat.setFileList((prev) => prev.filter((item) => item !== file))}
          onSend={() => void chat.sendMessage()}
          onStop={chat.stopGeneration}
          sending={chat.sending}
          mode={chat.mode}
          onModeChange={handleModeChange}
          agents={chat.agents}
          selectedAgentId={chat.selectedAgentId}
          agentSuggestion={chat.agentSuggestion}
          onApplyAgentSuggestion={() => {
            if (!chat.agentSuggestion) return;
            chat.setSelectedAgentId(chat.agentSuggestion.id);
            chat.setAgentSuggestion(null);
            toast.success(`Using suggested agent: ${chat.agentSuggestion.name}`);
          }}
          onSelectAgent={(agentId) => {
            chat.setSelectedAgentId(agentId);
            chat.setAgentSuggestion(null);
          }}
          models={chat.models}
          userSpending={chat.userSpending}
          routerMode={chat.routerMode}
          manualModel={chat.manualModel}
          onSelectAuto={() => {
            chat.setRouterMode("auto");
            void chat.updateExistingChatSettings({ routerMode: "auto" }).catch((error: unknown) =>
              toast.error(error instanceof Error ? error.message : "Failed to update routing"),
            );
          }}
          onSelectModel={(modelId) => {
            chat.setManualModel(modelId);
            chat.setRouterMode("manual");
            void chat.updateExistingChatSettings({ routerMode: "manual", manualModel: modelId })
              .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Failed to update model"));
          }}
          imageModel={chat.imageModel}
          onSelectImageModel={chat.setImageModel}
          autoEnhancePrompt={chat.autoEnhancePrompt}
          autoThinking={chat.autoThinking}
          autoSearch={chat.autoSearch}
          onAutoEnhancePromptChange={chat.setAutoEnhancePrompt}
          onAutoThinkingChange={chat.setAutoThinking}
          onAutoSearchChange={chat.setAutoSearch}
          onSlashCommand={handleSlashCommand}
          lastAutoResult={chat.lastAutoResult}
        />
      </main>

      <CodeCanvas
        open={canvas.isOpen}
        code={canvas.code}
        language={canvas.language}
        previewDoc={canvas.previewDoc}
        versions={canvas.versions}
        activeVersionId={canvas.currentVersion?.id}
        onClose={canvas.closeCanvas}
        onCodeChange={canvas.setCode}
        onLanguageChange={canvas.setLanguage}
        onRun={canvas.runPreview}
        onSaveVersion={canvas.saveVersion}
        onRestoreVersion={canvas.restoreVersion}
        onAskAiModify={(instruction) => {
          const artifactPrompt = [
            "Modify this artifact according to the instruction.",
            `Instruction: ${instruction}`,
            `Language: ${canvas.language}`,
            "Return the complete updated code in one fenced block.",
            "",
            "Current code:",
            "```",
            canvas.code,
            "```",
          ].join("\n");
          void chat.sendMessage(artifactPrompt, {
            chatIdOverride: chat.selectedChatId || undefined,
            skipLocalUser: false,
            retryAttempt: 0,
          });
        }}
      />

      {!isZenMode ? (
      <UnifiedPanel
        settingsProps={{
          models: chat.models,
          mode: chat.mode,
          thinkingLevel: chat.thinkingLevel,
          routerMode: chat.routerMode,
          manualModel: chat.manualModel,
          usePersonalResources: chat.usePersonalResources,
          personalResources: chat.personalResources,
          userSpending: chat.userSpending,
          autoEnhancePrompt: chat.autoEnhancePrompt,
          autoThinking: chat.autoThinking,
          autoSearch: chat.autoSearch,
          onModeChange: handleModeChange,
          onThinkingChange: (thinkingLevel) => {
            chat.setThinkingLevel(thinkingLevel);
            void chat.updateExistingChatSettings({ thinkingLevel }).catch((error: unknown) =>
              toast.error(error instanceof Error ? error.message : "Failed to update thinking level"));
          },
          onRouterChange: (routerMode) => {
            chat.setRouterMode(routerMode);
            void chat.updateExistingChatSettings({ routerMode, manualModel: routerMode === "manual" ? chat.manualModel : undefined })
              .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Failed to update routing"));
          },
          onManualModelChange: (manualModel) => {
            chat.setManualModel(manualModel);
            void chat.updateExistingChatSettings({ manualModel }).catch((error: unknown) =>
              toast.error(error instanceof Error ? error.message : "Failed to save model"));
          },
          onTogglePersonalResources: (usePersonalResources) => {
            chat.setUsePersonalResources(usePersonalResources);
            void chat.updateExistingChatSettings({ usePersonalResources }).catch((error: unknown) =>
              toast.error(error instanceof Error ? error.message : "Failed to save setting"));
          },
          onAutoEnhancePromptChange: chat.setAutoEnhancePrompt,
          onAutoThinkingChange: chat.setAutoThinking,
          onAutoSearchChange: chat.setAutoSearch,
          onDeleteResource: (resourceId) => {
            void chat.deletePersonalResource(resourceId).catch((error: unknown) =>
              toast.error(error instanceof Error ? error.message : "Failed to delete file"),
            );
          },
        }}
        orchestrationProps={{
          sending: chat.sending,
          collaboratorPhase: chat.collaboratorPhase,
          activeCollaborators: chat.activeCollaborators,
          routeTrace: latestRouteTrace,
          lastModelUsed,
          searchEnabled: chat.lastAutoResult?.searchEnabled,
        }}
      />
      ) : null}

      {!isZenMode ? (
      <Button
        type="button"
        variant="secondary"
        className="fixed bottom-5 right-5 z-30 h-9 rounded-full px-3"
        onClick={() => setTourOpen(true)}
      >
        <CircleHelp className="mr-1.5 h-4 w-4" />
        Tour
      </Button>
      ) : null}

      <GuidedTour
        open={tourOpen && !isZenMode}
        steps={TOUR_STEPS}
        onClose={() => {
          markTourSeen();
          setTourOpen(false);
        }}
        onComplete={markTourSeen}
      />
    </div>
  );
}
