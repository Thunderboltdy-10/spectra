"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { ChatComposer } from "@/components/chat/chat-composer";
import { CodeCanvas } from "@/components/chat/code-canvas";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatMessages } from "@/components/chat/chat-messages";
import { UnifiedPanel } from "@/components/chat/unified-panel";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { ChatWelcome } from "@/components/chat/chat-welcome";
import { KeyboardShortcutsRegistrar } from "@/components/keyboard-shortcuts";
import type { GuidedTourStep } from "@/components/ui/guided-tour";
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
import { isModeAvailable } from "@/lib/modes";
import { GlobalUtilityDock } from "@/components/global-utility-dock";

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
const FIRST_PROMPT_KEY = "ai-school-initial-prompt-v2";
const FIRST_PROMPT_TEXT = "Help me build a focused 7-day study plan for my current subjects with 30-minute daily sessions.";
const LIVE_PROGRESS_DEFAULT_KEY = "ai-school-live-progress-default";

const TOUR_STEPS: GuidedTourStep[] = [
  {
    selector: '[data-tour="sidebar-pages"]',
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
    selector: '[data-tour="agent-selector"]',
    title: "Agent selector",
    description: "Attach a specialist agent for subject-specific prompting, files, and style.",
    position: "top",
  },
  {
    selector: '[data-tour="auto-controls"]',
    title: "Auto controls",
    description: "Tune automation for prompt enhancement, reasoning depth, and web search behavior.",
    position: "top",
  },
  {
    selector: '[data-tour="settings-trigger"]',
    title: "Settings panel",
    description: "Open session settings for reasoning depth, search behavior, and resources.",
    position: "bottom",
  },
  {
    selector: '[data-tour="utility-feedback"]',
    title: "Feedback button",
    description: "Report bugs or ideas with context and optional screenshot in one place.",
    position: "left",
  },
  {
    selector: '[data-tour="utility-timer"]',
    title: "Focus timer",
    description: "Start focused sessions and adjust timer duration whenever needed.",
    position: "left",
  },
  {
    selector: '[data-tour="utility-tour"]',
    title: "Persistent tours",
    description: "Reopen guided tours anytime from this control.",
    position: "left",
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
  const { activeView: panelActiveView, openPanel, closePanel, togglePanel } = usePanel();
  const [tourOpen, setTourOpen] = useState(false);
  const [activityCutoffTs, setActivityCutoffTs] = useState<number | null>(null);
  const [liveProgressAutoOpen, setLiveProgressAutoOpen] = useState(true);
  const openedOrchestrationForStreamRef = useRef(false);
  const orchestrationDismissedForStreamRef = useRef(false);
  const previousPanelViewRef = useRef<string | null>(null);

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

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LIVE_PROGRESS_DEFAULT_KEY);
      if (stored === "0") {
        setLiveProgressAutoOpen(false);
      } else {
        setLiveProgressAutoOpen(true);
      }
    } catch {
      setLiveProgressAutoOpen(true);
    }
  }, []);

  useEffect(() => {
    const onPreferenceChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled?: boolean }>).detail;
      if (typeof detail?.enabled !== "boolean") return;
      setLiveProgressAutoOpen(detail.enabled);
    };
    window.addEventListener("ai-school:live-progress-default-changed", onPreferenceChanged);
    return () => window.removeEventListener("ai-school:live-progress-default-changed", onPreferenceChanged);
  }, []);

  useEffect(() => {
    const onOpenTour = () => setTourOpen(true);
    window.addEventListener("ai-school:open-tour", onOpenTour);
    return () => window.removeEventListener("ai-school:open-tour", onOpenTour);
  }, []);

  const handleModeChange = useCallback((nextMode: StudyMode) => {
    if (!isModeAvailable(nextMode)) {
      toast.info("This mode is coming soon.");
      return;
    }
    chat.setMode(nextMode);
    void chat.updateExistingChatSettings({ mode: nextMode }).catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Failed to update mode"),
    );
  }, [chat]);

  useEffect(() => {
    const onSwitchMode = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: string }>).detail;
      if (!detail?.mode) return;
      handleModeChange(detail.mode as StudyMode);
    };
    const onOpenOrchestration = () => openPanel("orchestration");
    window.addEventListener("ai-school:switch-mode", onSwitchMode);
    window.addEventListener("ai-school:open-orchestration", onOpenOrchestration);
    return () => {
      window.removeEventListener("ai-school:switch-mode", onSwitchMode);
      window.removeEventListener("ai-school:open-orchestration", onOpenOrchestration);
    };
  }, [handleModeChange, openPanel]);

  function markTourSeen() {
    try {
      window.localStorage.setItem(TOUR_COMPLETED_KEY, "1");
    } catch {
      // Ignore storage failures.
    }
  }

  const [modelTransitioning, setModelTransitioning] = useState(false);
  const prevSelectedChatRef = useRef(chat.selectedChatId);

  useEffect(() => {
    if (prevSelectedChatRef.current !== chat.selectedChatId) {
      setModelTransitioning(true);
      const timer = window.setTimeout(() => setModelTransitioning(false), 600);
      prevSelectedChatRef.current = chat.selectedChatId;
      return () => window.clearTimeout(timer);
    }
  }, [chat.selectedChatId]);

  const lastModelUsed = useMemo(() => {
    if (modelTransitioning) return undefined;
    const lastAssistant = [...chat.messages].reverse().find((item) => item.role === "assistant");
    return lastAssistant?.modelUsed ?? chat.lastAutoResult?.modelUsed;
  }, [chat.lastAutoResult?.modelUsed, chat.messages, modelTransitioning]);
  const lastResponseAt = useMemo(() => {
    const lastAssistant = [...chat.messages].reverse().find((item) => item.role === "assistant");
    return lastAssistant?.createdAt;
  }, [chat.messages]);
  const latestRouteTrace = useMemo(() => {
    const lastAssistant = [...chat.messages].reverse().find((item) => item.role === "assistant" && item.routeTrace);
    return lastAssistant?.routeTrace;
  }, [chat.messages]);
  const canOpenOrchestration = chat.sending || Boolean(latestRouteTrace) || chat.activeCollaborators.length > 0;

  useEffect(() => {
    setActivityCutoffTs(Date.now() - 30 * 24 * 60 * 60 * 1000);
  }, []);

  const recentChatCount = useMemo(() => {
    if (activityCutoffTs === null) return chat.chats.length;
    return chat.chats.filter((item) => item.updatedAt >= activityCutoffTs).length;
  }, [activityCutoffTs, chat.chats]);
  const isFirstSession = !chat.selectedChatId && chat.chats.length === 0 && chat.messages.length === 0;

  useEffect(() => {
    if (!isFirstSession || chat.message.trim().length > 0 || chat.sending) return;
    try {
      if (window.localStorage.getItem(FIRST_PROMPT_KEY) === "1") return;
      window.localStorage.setItem(FIRST_PROMPT_KEY, "1");
    } catch {
      // Ignore storage issues.
    }
    chat.setMode("tutor");
    chat.setMessage(FIRST_PROMPT_TEXT);
  }, [chat, isFirstSession]);

  useEffect(() => {
    const previous = previousPanelViewRef.current;
    if (
      previous === "orchestration" &&
      panelActiveView !== "orchestration" &&
      chat.sending
    ) {
      orchestrationDismissedForStreamRef.current = true;
    }
    if (panelActiveView === "orchestration") {
      orchestrationDismissedForStreamRef.current = false;
    }
    previousPanelViewRef.current = panelActiveView;
  }, [chat.sending, panelActiveView]);

  useEffect(() => {
    const onPanelClosed = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: string }>).detail;
      if (detail?.view === "orchestration" && chat.sending) {
        orchestrationDismissedForStreamRef.current = true;
      }
    };
    window.addEventListener("ai-school:panel-closed", onPanelClosed);
    return () => window.removeEventListener("ai-school:panel-closed", onPanelClosed);
  }, [chat.sending]);
  const regenModels = useMemo(
    () =>
      chat.models.slice(0, 5).map((model) => ({
        modelId: model.modelId,
        name: model.name,
      })),
    [chat.models],
  );

  useEffect(() => {
    const meaningfulOrchestration =
      chat.activeCollaborators.length > 0
      || chat.collaboratorPhase !== "idle"
      || chat.streamPhase === "searching"
      || chat.streamPhase === "compacting"
      || chat.streamPhase === "synthesizing";
    const shouldAutoOpen = chat.sending && liveProgressAutoOpen && meaningfulOrchestration;

    if (
      shouldAutoOpen &&
      panelActiveView !== "orchestration" &&
      !orchestrationDismissedForStreamRef.current
    ) {
      openPanel("orchestration");
      openedOrchestrationForStreamRef.current = true;
      return;
    }

    if (!chat.sending) {
      openedOrchestrationForStreamRef.current = false;
      orchestrationDismissedForStreamRef.current = false;
    }
  }, [
    chat.activeCollaborators.length,
    chat.collaboratorPhase,
    chat.streamPhase,
    chat.sending,
    liveProgressAutoOpen,
    openPanel,
    panelActiveView,
  ]);

  function handleRegenerateLastResponse() {
    void chat.regenerateLastResponse();
  }

  function handleRegenerateWithModel(modelId: string) {
    void chat.regenerateWithModel(modelId);
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
        const node = document.querySelector("[data-conversation-export]") ?? document.querySelector("main");
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
      <div className="grid h-screen grid-cols-[clamp(260px,24vw,360px)_1fr] bg-[var(--bg-primary)]">
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
      closePanel();
    },
    onNewChat: () => chat.startNewChat(chat.selectedAgentId),
    onDeleteChat: (chatId: string) => void chat.handleDeleteChat(chatId),
    onRenameChat: (chatId: string, title: string) => void chat.renameChat(chatId, title),
    onOpenSettings: () => togglePanel("settings"),
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
    <div className="flex h-screen min-w-0 overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <KeyboardShortcutsRegistrar
        onEscape={() => {
          if (chat.mobileSidebarOpen) {
            chat.setMobileSidebarOpen(false);
          } else {
            closePanel();
          }
        }}
      />

      <aside
        data-tour="sidebar"
        className={`hidden md:block transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          chat.sidebarOpen && !canvas.isOpen ? "w-[clamp(220px,18vw,280px)]" : "w-[64px]"
        }`}
      >
        <ChatSidebar {...sidebarProps} collapsed={!chat.sidebarOpen || canvas.isOpen} />
      </aside>

      {chat.mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
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

      <main
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
        data-chat-scroll-root
      >
        <ChatHeader
          title={chat.selectedChat?.title ?? "New chat"}
          agentLabel={chat.selectedAgent ? `${chat.selectedAgent.avatarEmoji} ${chat.selectedAgent.name}` : undefined}
          lastResponseAt={lastResponseAt}
          sending={chat.sending}
          messageCount={chat.messages.length}
          compacting={chat.compactingConversation}
          streamPhase={chat.sending ? (
            chat.streamPhase === "compacting" ? "Compacting context" :
            chat.streamPhase === "routing" ? "Selecting model" :
            chat.streamPhase === "searching" ? "Checking sources" :
            chat.streamPhase === "thinking" ? "Reasoning" :
            chat.streamPhase === "synthesizing" ? "Formatting result" :
            chat.streamPhase === "generating" ? "Generating response" :
            chat.collaboratorPhase === "synthesizing" ? "Formatting result" :
            chat.lastAutoResult?.searchEnabled ? "Using search" :
            chat.activeCollaborators.length > 0 ? "Running specialists" :
            "Generating response"
          ) : undefined}
          onStop={chat.stopGeneration}
          onCompact={() => void chat.compactConversation()}
          onCompactWithDepth={(keepLatestMessages) => void chat.compactConversation(keepLatestMessages)}
          onToggleMobileSidebar={() => chat.setMobileSidebarOpen(true)}
          onOpenSettings={() => togglePanel("settings")}
          onOpenOrchestration={() => togglePanel("orchestration")}
          onNewChat={() => chat.startNewChat(chat.selectedAgentId)}
          showOrchestrationButton={canOpenOrchestration}
          orchestrationActive={panelActiveView === "orchestration"}
          settingsActive={panelActiveView === "settings"}
          onExport={(format) => {
            if (format === "pdf") {
              const node = document.querySelector("[data-conversation-export]") ?? document.querySelector("main");
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

        <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <ChatMessages
          messages={chat.messages}
          draftResponse={chat.draftResponse}
          draftThinking={chat.draftThinking}
          hasRealThinking={chat.hasRealThinking}
          sending={chat.sending}
          streamPhase={chat.streamPhase}
          streamError={chat.streamError}
          searchStatusBanner={chat.searchStatusBanner}
          proactiveBanner={chat.proactiveBanner}
          chatId={chat.selectedChatId}
          onRetry={() => void chat.retryLastMessage()}
          onApplyProactiveBanner={() => {
            void chat.applyProactiveBanner();
          }}
          onDismissProactiveBanner={() => {
            chat.dismissProactiveBanner();
          }}
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
          onEditFlashcardCard={(payload) => {
            return chat.editFlashcardCard({
              cardHash: payload.cardHash,
              front: payload.front,
              back: payload.back,
            });
          }}
          onFollowUp={(followUpMessage, modeOverride) => {
            void chat.sendMessage(followUpMessage, {
              chatIdOverride: chat.selectedChatId || undefined,
              skipLocalUser: false,
              retryAttempt: 0,
              modeOverride,
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
          onAssistantFeedback={(messageId, positive, modelId) => {
            void chat.recordAssistantFeedback({
              messageId,
              chatId: chat.selectedChatId,
              modelId,
              positive,
            });
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
            isFirstSession
              ? (
                <section className="mx-auto w-full max-w-3xl rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 text-left shadow-[var(--shadow-soft)]">
                  <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Starter Prompt Ready</p>
                  <p className="mt-2 text-sm text-[var(--text-primary)]">{FIRST_PROMPT_TEXT}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!chat.message.trim()) {
                          chat.setMessage(FIRST_PROMPT_TEXT);
                        }
                      }}
                      className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
                    >
                      Use starter prompt
                    </button>
                    <button
                      type="button"
                      onClick={() => chat.setMessage("")}
                      className="rounded-full border border-[var(--border-default)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
                    >
                      Start blank
                    </button>
                  </div>
                </section>
              )
              : (
                <ChatWelcome
                  agents={chat.agents}
                  onSelectAgent={(agentId) => chat.startNewChat(agentId)}
                  onSelectMode={handleModeChange}
                  onResumeChat={(chatId) => chat.setSelectedChatId(chatId)}
                  activeMode={chat.mode}
                  recentChats={chat.chats}
                  orgName={chat.orgName}
                />
              )
          }
        />

        <ChatComposer
          sidebarExpanded={chat.sidebarOpen}
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
          autoCompaction={chat.autoCompaction}
          onAutoEnhancePromptChange={chat.setAutoEnhancePrompt}
          onAutoThinkingChange={chat.setAutoThinking}
          onAutoSearchChange={chat.setAutoSearch}
          onAutoCompactionChange={chat.setAutoCompaction}
          onSlashCommand={handleSlashCommand}
          lastAutoResult={chat.lastAutoResult}
          messageCount={chat.messages.length}
        />
        </div>
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

      <UnifiedPanel
          settingsProps={{
            models: chat.models,
            routerMode: chat.routerMode,
            manualModel: chat.manualModel,
            activeModelUsed: lastModelUsed,
            showCostDetails: chat.isSuperAdmin,
            usePersonalResources: chat.usePersonalResources,
          autoSaveConversationFilesToLibrary: chat.autoSaveConversationFilesToLibrary,
          personalResources: chat.personalResources,
          userSpending: chat.userSpending,
          recentChatCount,
          liveProgressAutoOpen,
          autoEnhancePrompt: chat.autoEnhancePrompt,
          autoThinking: chat.autoThinking,
          autoSearch: chat.autoSearch,
          autoCompaction: chat.autoCompaction,
          onLiveProgressAutoOpenChange: (enabled) => {
            setLiveProgressAutoOpen(enabled);
            try {
              window.localStorage.setItem(LIVE_PROGRESS_DEFAULT_KEY, enabled ? "1" : "0");
            } catch {
              // Ignore storage failures.
            }
            window.dispatchEvent(new CustomEvent("ai-school:live-progress-default-changed", { detail: { enabled } }));
          },
          onTogglePersonalResources: (usePersonalResources) => {
            chat.setUsePersonalResources(usePersonalResources);
            void chat.updateExistingChatSettings({ usePersonalResources }).catch((error: unknown) =>
              toast.error(error instanceof Error ? error.message : "Failed to save setting"));
          },
          onAutoSaveConversationFilesToLibraryChange: (enabled) => {
            chat.setAutoSaveConversationFilesToLibrary(enabled);
          },
          onAutoEnhancePromptChange: chat.setAutoEnhancePrompt,
          onAutoThinkingChange: chat.setAutoThinking,
          onAutoSearchChange: chat.setAutoSearch,
          onAutoCompactionChange: chat.setAutoCompaction,
          onDeleteResource: (resourceId) => {
            void chat.deletePersonalResource(resourceId).catch((error: unknown) =>
              toast.error(error instanceof Error ? error.message : "Failed to delete file"),
            );
          },
          onUploadPersonalFiles: (files) => {
            void chat.uploadPersonalResources(files).catch((error: unknown) =>
              toast.error(error instanceof Error ? error.message : "Failed to upload file"),
            );
          },
        }}
        orchestrationProps={{
          sending: chat.sending,
          collaboratorPhase: chat.collaboratorPhase,
          activeCollaborators: chat.activeCollaborators,
          streamPhase: chat.streamPhase,
          livePhasePlan: chat.livePhasePlan,
          routeTrace: latestRouteTrace,
          lastModelUsed,
          searchEnabled: chat.lastAutoResult?.searchEnabled,
        }}
      />


      <GlobalUtilityDock placement="floating" />

      <GuidedTour
        open={tourOpen}
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
