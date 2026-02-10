"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  Brain,
  ChevronDown,
  Paperclip,
  Search,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ALL_MODES, getModeConfig } from "@/lib/modes";
import type { Agent } from "@/types";
import type { AutoPreference, ModelOption } from "@/hooks/use-chat-state";
import type { RouterMode, StudyMode } from "@/types";

type ChatComposerProps = {
  message: string;
  onMessageChange: (value: string) => void;
  fileList: File[];
  onFilesAdd: (files: File[]) => void;
  onRemoveFile: (file: File) => void;
  onSend: () => void;
  onStop?: () => void;
  sending: boolean;
  mode: StudyMode;
  onModeChange?: (mode: StudyMode) => void;
  agents: Agent[];
  selectedAgentId?: string;
  onSelectAgent: (agentId?: string) => void;
  models: ModelOption[];
  routerMode: RouterMode;
  manualModel: string;
  onSelectAuto: () => void;
  onSelectModel: (modelId: string) => void;
  autoEnhancePrompt: AutoPreference;
  autoThinking: AutoPreference;
  autoSearch: AutoPreference;
  onAutoEnhancePromptChange: (value: AutoPreference) => void;
  onAutoThinkingChange: (value: AutoPreference) => void;
  onAutoSearchChange: (value: AutoPreference) => void;
  lastAutoResult?: {
    promptEnhanced: boolean;
    searchEnabled: boolean;
    thinkingLevel: "low" | "medium" | "high";
  } | null;
};

function formatModelLabel(modelId: string) {
  const raw = modelId.split("/").pop() ?? modelId;
  const clean = raw.replace(/:free$/i, "").replace(/-\d{4}-\d{2}-\d{2}$/i, "");
  return clean
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((word) => {
      if (/^\d+(\.\d+)?$/.test(word)) return word;
      if (/^(gpt|o3|o4|r1|claude|gemini)$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function formatNumberCompact(value?: number) {
  if (!value || value <= 0) return "—";
  return Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

function nextPreference(value: AutoPreference): AutoPreference {
  if (value === "auto") return "on";
  if (value === "on") return "off";
  return "auto";
}

function preferenceLabel(value: AutoPreference) {
  if (value === "auto") return "Auto";
  if (value === "on") return "Yes";
  return "No";
}

function sortedByPopularity(models: ModelOption[]) {
  const POPULAR_MODELS = [
    "openrouter/auto",
    "anthropic/claude-sonnet-4-5",
    "openai/gpt-4.1-mini",
    "google/gemini-2.5-pro",
    "perplexity/sonar",
    "perplexity/sonar-pro",
    "deepseek/deepseek-r1-0528:free",
    "google/gemini-2.0-flash-exp:free",
  ];

  return [...models].sort((a, b) => {
    const aRank = POPULAR_MODELS.indexOf(a.modelId);
    const bRank = POPULAR_MODELS.indexOf(b.modelId);
    const aScore = aRank === -1 ? 999 : aRank;
    const bScore = bRank === -1 ? 999 : bRank;
    if (aScore !== bScore) return aScore - bScore;
    return a.name.localeCompare(b.name);
  });
}

function SettingPill({
  label,
  value,
  onChange,
  title,
  icon,
}: {
  label: string;
  value: AutoPreference;
  onChange: (value: AutoPreference) => void;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(nextPreference(value))}
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
    >
      {icon}
      <span>{label}: {preferenceLabel(value)}</span>
    </button>
  );
}

export function ChatComposer({
  message,
  onMessageChange,
  fileList,
  onFilesAdd,
  onRemoveFile,
  onSend,
  onStop,
  sending,
  mode,
  onModeChange,
  agents,
  selectedAgentId,
  onSelectAgent,
  models,
  routerMode,
  manualModel,
  onSelectAuto,
  onSelectModel,
  autoEnhancePrompt,
  autoThinking,
  autoSearch,
  onAutoEnhancePromptChange,
  onAutoThinkingChange,
  onAutoSearchChange,
  lastAutoResult,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [showModeSelector, setShowModeSelector] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showAgentSelector, setShowAgentSelector] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const modeConfig = getModeConfig(mode);
  const selectedModel = useMemo(
    () => models.find((item) => item.modelId === manualModel),
    [manualModel, models],
  );
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent._id === selectedAgentId),
    [agents, selectedAgentId],
  );
  const displayedModels = useMemo(() => {
    const clean = modelSearch.trim().toLowerCase();
    const sorted = sortedByPopularity(models);
    if (!clean) return sorted;
    return sorted.filter((model) =>
      `${model.name} ${model.modelId} ${model.provider}`.toLowerCase().includes(clean),
    );
  }, [modelSearch, models]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [message]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      onSend();
    }
  }

  function handleModeSelect(newMode: StudyMode) {
    if (onModeChange) {
      onModeChange(newMode);
    }
    setShowModeSelector(false);
  }

  return (
    <footer className="border-t border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-primary)_90%,transparent)] px-3 pb-[calc(0.9rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:px-6 lg:px-10">
      <div className="mx-auto w-full max-w-5xl">
        {fileList.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {fileList.map((file) => (
              <span
                key={`${file.name}-${file.size}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-medium shadow-sm"
              >
                <Paperclip className="h-3 w-3" />
                {file.name}
                <button
                  type="button"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full transition hover:bg-[var(--bg-hover)]"
                  onClick={() => onRemoveFile(file)}
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="relative rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-soft)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-default)] px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowModeSelector((prev) => !prev)}
                  title={modeConfig.description}
                  className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition"
                  style={{
                    backgroundColor: `${modeConfig.color}12`,
                    borderColor: `${modeConfig.color}44`,
                    color: modeConfig.color,
                  }}
                >
                  <span className="inline-flex h-4 w-4 rounded-full" style={{ backgroundColor: modeConfig.color }} />
                  <span>{modeConfig.label}</span>
                  <ChevronDown className="h-3 w-3" />
                </button>

                {showModeSelector && (
                  <div className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-soft)]">
                    {ALL_MODES.map((m) => {
                      const mc = getModeConfig(m.key);
                      const isActive = m.key === mode;
                      return (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => handleModeSelect(m.key)}
                          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition ${
                            isActive ? "bg-[var(--bg-secondary)]" : "hover:bg-[var(--bg-hover)]"
                          }`}
                        >
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: mc.color }} />
                          <div>
                            <p className="font-medium text-[var(--text-primary)]">{mc.label}</p>
                            <p className="text-[10px] text-[var(--text-secondary)]">{mc.description}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowModelSelector((prev) => !prev)}
                  title="Choose model manually or keep auto-routing"
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
                >
                  <Bot className="h-3.5 w-3.5" />
                  <span className="max-w-[180px] truncate">
                    {routerMode === "auto" || routerMode === "openrouter_auto"
                      ? "Auto model"
                      : formatModelLabel(selectedModel?.modelId ?? manualModel)}
                  </span>
                  <ChevronDown className="h-3 w-3" />
                </button>

                {showModelSelector && (
                  <div className="absolute bottom-full left-0 z-20 mb-2 w-[360px] rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-soft)]">
                    <div className="px-2 pb-1 pt-1">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--text-secondary)]" />
                        <input
                          value={modelSearch}
                          onChange={(event) => setModelSearch(event.target.value)}
                          placeholder="Search models"
                          className="h-8 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] pl-8 pr-2 text-xs"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectAuto();
                        setShowModelSelector(false);
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition hover:bg-[var(--bg-hover)]"
                    >
                      <span>Auto</span>
                    </button>
                    <div className="max-h-[290px] overflow-y-auto">
                      {displayedModels.map((model) => {
                        const displayName = model.name.replace(/:free/gi, "").trim() || formatModelLabel(model.modelId);
                        const supportsThinking = model.tags.some((tag) => /reason|think|r1|o3|o4|claude|gemini/i.test(tag));
                        const searchTag = model.tags.some((tag) => /search|sonar|perplexity/i.test(tag))
                          ? "Web-ready"
                          : "Orchestrated web";

                        return (
                          <button
                            key={model.modelId}
                            type="button"
                            onClick={() => {
                              onSelectModel(model.modelId);
                              setShowModelSelector(false);
                            }}
                            className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition hover:bg-[var(--bg-hover)]"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-[var(--text-primary)]">{displayName}</p>
                              <p className="truncate text-[10px] text-[var(--text-secondary)]">
                                {formatModelLabel(model.modelId)}
                              </p>
                              <p className="truncate text-[10px] text-[var(--text-secondary)]">{formatNumberCompact(model.contextLength)} context</p>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="rounded-full border border-[var(--border-default)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                                {supportsThinking ? "Thinking tokens" : "Standard"}
                              </span>
                              <span className="rounded-full border border-[var(--border-default)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                                {searchTag}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowAgentSelector((prev) => !prev)}
                  title="Attach an agent persona and resources to this chat"
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
                >
                  <span>{selectedAgent?.avatarEmoji ?? "🧠"}</span>
                  <span className="max-w-[140px] truncate">{selectedAgent?.name ?? "No agent"}</span>
                  <ChevronDown className="h-3 w-3" />
                </button>

                {showAgentSelector && (
                  <div className="absolute bottom-full left-0 z-20 mb-2 max-h-[260px] w-64 overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-soft)]">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectAgent(undefined);
                        setShowAgentSelector(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition hover:bg-[var(--bg-hover)]"
                    >
                      <span>🧠</span>
                      <span>No agent</span>
                    </button>
                    {agents.map((agent) => (
                      <button
                        key={agent._id}
                        type="button"
                        onClick={() => {
                          onSelectAgent(agent._id);
                          setShowAgentSelector(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition hover:bg-[var(--bg-hover)]"
                      >
                        <span>{agent.avatarEmoji}</span>
                        <span className="truncate">{agent.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <SettingPill
                label="Enhance"
                value={autoEnhancePrompt}
                onChange={onAutoEnhancePromptChange}
                title="Auto chooses when to refine prompts. Yes forces refinement. No disables."
                icon={<Sparkles className="h-3.5 w-3.5" />}
              />
              <SettingPill
                label="Thinking"
                value={autoThinking}
                onChange={onAutoThinkingChange}
                title="Auto adapts reasoning depth. Yes forces deeper reasoning. No keeps it lightweight."
                icon={<Brain className="h-3.5 w-3.5" />}
              />
              <SettingPill
                label="Search"
                value={autoSearch}
                onChange={onAutoSearchChange}
                title="Auto enables web research for time-sensitive prompts. Yes always enables. No disables."
                icon={<Search className="h-3.5 w-3.5" />}
              />

              {lastAutoResult?.promptEnhanced && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--accent-cyan)_40%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_14%,transparent)] px-2 py-1 text-[11px] text-[var(--accent-cyan)]">
                  <Sparkles className="h-3 w-3" />
                  Enhanced
                </span>
              )}

              <label className="flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]">
                <Paperclip className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Attach</span>
                <input
                  type="file"
                  className="hidden"
                  multiple
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    if (files.length > 0) {
                      onFilesAdd(files);
                    }
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
          </div>

          <div className="flex items-end gap-2 px-3 py-2.5">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(event) => onMessageChange(event.target.value)}
              placeholder="Ask anything. For best results, include your context and goal."
              className="max-h-[220px] min-h-[70px] flex-1 resize-none bg-transparent px-2 py-1 text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-none"
              onKeyDown={handleKeyDown}
            />

            {sending && onStop ? (
              <Button
                onClick={onStop}
                variant="secondary"
                size="icon"
                className="h-10 w-10 rounded-full"
                aria-label="Stop generation"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={onSend}
                disabled={sending || !message.trim()}
                size="icon"
                className="h-10 w-10 rounded-full"
                aria-label="Send message"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
