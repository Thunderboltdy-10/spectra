"use client";

import { useMemo } from "react";
import { toast } from "sonner";
import { ChatComposer } from "@/components/chat/chat-composer";
import { CodeCanvas } from "@/components/chat/code-canvas";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatMessages } from "@/components/chat/chat-messages";
import { ChatSettingsDrawer } from "@/components/chat/chat-settings-drawer";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { ChatWelcome } from "@/components/chat/chat-welcome";
import { useChatState } from "@/hooks/use-chat-state";
import type { StudyMode } from "@/types";
import { downloadTextFile, exportConversationMarkdown } from "@/lib/export/markdown-export";
import { exportElementToPrintPdf } from "@/lib/export/pdf-export";
import { parseSlashCommand, normalizeModeArg, SLASH_COMMANDS } from "@/lib/slash-commands";
import { useCanvasState } from "@/hooks/use-canvas-state";

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

export function ChatLayout() {
  const chat = useChatState();
  const canvas = useCanvasState();

  const lastModelUsed = useMemo(() => {
    const lastAssistant = [...chat.messages].reverse().find((item) => item.role === "assistant");
    return lastAssistant?.modelUsed ?? chat.lastAutoResult?.modelUsed;
  }, [chat.lastAutoResult?.modelUsed, chat.messages]);
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
    onOpenSettings: () => chat.setSettingsOpen(true),
    onPinChat: handlePinChat,
    pinnedChatIds: chat.pinnedChatIds,
    role: chat.role,
    userSpending: chat.userSpending,
    userMemorySummary: chat.userMemorySummary,
    collapsed: !chat.sidebarOpen,
    onToggleCollapse: () => chat.setSidebarOpen((prev) => !prev),
    orgName: chat.orgName,
    orgLogoUrl: chat.orgLogoUrl,
  };

  return (
    <div className="flex h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <aside
        className={`hidden transition-all duration-300 md:block ${
          chat.sidebarOpen ? "w-[320px]" : "w-[76px]"
        }`}
      >
        <ChatSidebar {...sidebarProps} />
      </aside>

      {chat.mobileSidebarOpen && (
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

      <main className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          title={chat.selectedChat?.title ?? "New chat"}
          agentLabel={chat.selectedAgent ? `${chat.selectedAgent.avatarEmoji} ${chat.selectedAgent.name}` : undefined}
          lastModelUsed={lastModelUsed}
          sending={chat.sending}
          onStop={chat.stopGeneration}
          onToggleMobileSidebar={() => chat.setMobileSidebarOpen(true)}
          onOpenSettings={() => chat.setSettingsOpen(true)}
          onNewChat={() => chat.startNewChat(chat.selectedAgentId)}
          onExportMarkdown={() => {
            const markdown = exportConversationMarkdown({
              title: chat.selectedChat?.title ?? "Conversation",
              messages: chat.messages,
            });
            downloadTextFile("conversation.md", markdown);
          }}
          onExportPdf={() => {
            const node = document.querySelector("main");
            if (node instanceof HTMLElement) {
              exportElementToPrintPdf(node, chat.selectedChat?.title ?? "Conversation");
            }
          }}
        />

        <ChatMessages
          messages={chat.messages}
          draftResponse={chat.draftResponse}
          draftThinking={chat.draftThinking}
          sending={chat.sending}
          streamError={chat.streamError}
          onRetry={() => void chat.retryLastMessage()}
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
          onAssistantFeedback={(positive, modelId) => {
            void chat.recordAssistantFeedback(modelId, positive);
          }}
          regenModels={regenModels}
          mode={chat.mode}
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
              welcomeMessage={chat.orgWelcomeMessage}
            />
          }
        />

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
              return [...prev, ...deduped];
            })}
          onRemoveFile={(file) => chat.setFileList((prev) => prev.filter((item) => item !== file))}
          onSend={() => void chat.sendMessage()}
          onStop={chat.stopGeneration}
          sending={chat.sending}
          mode={chat.mode}
          onModeChange={handleModeChange}
          agents={chat.agents}
          selectedAgentId={chat.selectedAgentId}
          onSelectAgent={(agentId) => {
            chat.setSelectedAgentId(agentId);
          }}
          models={chat.models}
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

      <ChatSettingsDrawer
        open={chat.settingsOpen}
        onClose={() => chat.setSettingsOpen(false)}
        models={chat.models}
        mode={chat.mode}
        thinkingLevel={chat.thinkingLevel}
        routerMode={chat.routerMode}
        manualModel={chat.manualModel}
        usePersonalResources={chat.usePersonalResources}
        personalResources={chat.personalResources}
        userSpending={chat.userSpending}
        autoEnhancePrompt={chat.autoEnhancePrompt}
        autoThinking={chat.autoThinking}
        autoSearch={chat.autoSearch}
        onModeChange={handleModeChange}
        onThinkingChange={(thinkingLevel) => {
          chat.setThinkingLevel(thinkingLevel);
          void chat.updateExistingChatSettings({ thinkingLevel }).catch((error: unknown) =>
            toast.error(error instanceof Error ? error.message : "Failed to update thinking level"));
        }}
        onRouterChange={(routerMode) => {
          chat.setRouterMode(routerMode);
          void chat.updateExistingChatSettings({ routerMode, manualModel: routerMode === "manual" ? chat.manualModel : undefined })
            .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Failed to update routing"));
        }}
        onManualModelChange={(manualModel) => {
          chat.setManualModel(manualModel);
          void chat.updateExistingChatSettings({ manualModel }).catch((error: unknown) =>
            toast.error(error instanceof Error ? error.message : "Failed to save model"));
        }}
        onTogglePersonalResources={(usePersonalResources) => {
          chat.setUsePersonalResources(usePersonalResources);
          void chat.updateExistingChatSettings({ usePersonalResources }).catch((error: unknown) =>
            toast.error(error instanceof Error ? error.message : "Failed to save setting"));
        }}
        onAutoEnhancePromptChange={chat.setAutoEnhancePrompt}
        onAutoThinkingChange={chat.setAutoThinking}
        onAutoSearchChange={chat.setAutoSearch}
        onDeleteResource={(resourceId) => {
          void chat.deletePersonalResource(resourceId).catch((error: unknown) =>
            toast.error(error instanceof Error ? error.message : "Failed to delete file"),
          );
        }}
      />
    </div>
  );
}
