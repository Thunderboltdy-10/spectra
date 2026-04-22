"use client";

/**
 * Artifact AI Interaction Surface
 *
 * Adapts to two contexts:
 * - "full-page": renders as right-panel conversational UI
 * - "workspace-panel": inline within artifact panel, response area expands above input bar
 *
 * For document artifacts, action-first editing is handled by the editor AI bar.
 * This surface is used for conversational follow-ups around non-document artifacts.
 *
 * Execution-native: shows inline execution timeline, version/edit awareness,
 * and diff-style confirm/discard flow.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Undo2,
  Check,
  Sparkles,
  FileEdit,
  Layers,
  Clock,
} from "lucide-react";
import type { Editor } from "@tiptap/core";
import { useChatPanel } from "@/hooks/use-chat-panel";
import { cn } from "@/lib/utils";
import { QuickChat } from "@/components/shared/quick-chat";
import { ExecutionTimeline } from "@/components/shared/execution-timeline";

interface ArtifactAiSurfaceProps {
  artifactId: string;
  editor?: Editor | null;
  context: "full-page" | "workspace-panel";
  onApplyEdits?: (ops: Array<{ type: string; from: number; to: number; content?: string }>) => void;
  onDiscard?: () => void;
  workstreamId?: string;
}

/** Edit version record */
type EditVersion = {
  editNumber: number;
  timestamp: number;
  summary: string;
  confirmed: boolean;
};

export function ArtifactAiSurface({
  artifactId,
  context,
  onApplyEdits,
  onDiscard,
  workstreamId,
}: ArtifactAiSurfaceProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Discard state
  const [discardTimer, setDiscardTimer] = useState<number | null>(null);
  const [editCount, setEditCount] = useState(0);
  const discardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Edit version history
  const [editHistory, setEditHistory] = useState<EditVersion[]>([]);

  const {
    messages,
    streaming,
    streamPhase,
    latestRouteTrace,
    error,
    sendMessage,
    stopGeneration,
  } = useChatPanel({
    workstreamId,
    artifactId,
    threadType: "artifact_edit",
    mode: "tutor",
    thinkingLevel: "low",
    routerMode: "auto",
  });
  const latestAssistantTrace = latestRouteTrace
    ?? [...messages].reverse().find((message) => message.role === "assistant" && message.routeTrace)?.routeTrace;

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle send
  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    setInput("");
    await sendMessage(trimmed);

    if (onApplyEdits) {
      const newCount = editCount + 1;
      setEditCount(newCount);
      setDiscardTimer(30);
      setEditHistory((prev) => [
        ...prev,
        {
          editNumber: newCount,
          timestamp: Date.now(),
          summary: trimmed.slice(0, 60),
          confirmed: false,
        },
      ]);
    }
  }, [input, onApplyEdits, streaming, sendMessage, editCount]);

  useEffect(() => {
    if (discardTimer === null) return undefined;
    if (discardTimerRef.current) clearInterval(discardTimerRef.current);
    discardTimerRef.current = setInterval(() => {
      setDiscardTimer((prev) => {
        if (prev === null || prev <= 1) {
          if (discardTimerRef.current) clearInterval(discardTimerRef.current);
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (discardTimerRef.current) clearInterval(discardTimerRef.current);
    };
  }, [discardTimer]);

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (discardTimerRef.current) clearInterval(discardTimerRef.current);
    };
  }, []);

  const handleDiscard = useCallback(() => {
    setDiscardTimer(null);
    if (discardTimerRef.current) clearInterval(discardTimerRef.current);
    onDiscard?.();
    // Mark last edit as discarded
    setEditHistory((prev) =>
      prev.length > 0
        ? prev.slice(0, -1)
        : prev
    );
    setEditCount((c) => Math.max(0, c - 1));
  }, [onDiscard]);

  const handleConfirm = useCallback(() => {
    setDiscardTimer(null);
    if (discardTimerRef.current) clearInterval(discardTimerRef.current);
    // Mark last edit as confirmed
    setEditHistory((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      updated[updated.length - 1] = { ...updated[updated.length - 1], confirmed: true };
      return updated;
    });
  }, []);

  if (context === "workspace-panel") {
    return (
      <div className="flex flex-col">
        {/* Expandable response area — grows upward when AI responds */}
        <AnimatePresence>
          {messages.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-t border-[var(--border-default)] overflow-hidden"
            >
              {/* Execution Timeline — inline, compact */}
              {latestAssistantTrace && (
                <div className="px-3 pt-2">
                  <ExecutionTimeline
                    routeTrace={latestAssistantTrace}
                    streaming={streaming}
                    compact
                  />
                </div>
              )}

              <div className="max-h-48 overflow-y-auto px-4 py-3 space-y-3">
                {error ? (
                  <div className="rounded-lg border border-[color-mix(in_oklab,var(--danger)_24%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_8%,var(--bg-secondary))] px-3 py-2 text-xs text-[var(--danger)]">
                    {error}
                  </div>
                ) : null}
                {messages.filter((m) => m.role === "assistant").slice(-2).map((msg) => (
                  <div key={msg.id} className="text-sm text-[var(--text-primary)] leading-relaxed">
                    {msg.streaming && !msg.content && (
                      <span className="text-[var(--accent-cyan)] text-xs animate-pulse">
                        {streamPhase || "Thinking..."}
                      </span>
                    )}
                    {msg.content}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Version / Edit bar — diff & version aware */}
        <AnimatePresence>
          {discardTimer !== null && onApplyEdits && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-t border-[var(--border-default)]"
            >
              {/* Version header */}
              <div className="flex items-center gap-2 px-3 py-1 bg-[color-mix(in_oklab,var(--accent-cyan)_4%,var(--bg-secondary))]">
                <FileEdit className="w-3 h-3 text-[var(--accent-cyan)]" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--accent-cyan)]">
                  Edit #{editCount}
                </span>
                <span className="text-[9px] text-[var(--text-tertiary)] tabular-nums">
                  <Clock className="w-2.5 h-2.5 inline mr-0.5" />
                  {discardTimer}s to review
                </span>
              </div>

              {/* Edit history strip */}
              {editHistory.length > 1 && (
                <div className="px-3 py-1 flex items-center gap-1 border-b border-[var(--border-default)]/40">
                  <Layers className="w-2.5 h-2.5 text-[var(--text-tertiary)]" />
                  {editHistory.map((ver) => (
                    <span
                      key={ver.editNumber}
                      className={cn(
                        "inline-flex items-center gap-0.5 rounded-sm border px-1 py-0.5 text-[8px] font-medium",
                        ver.confirmed
                          ? "border-[color-mix(in_oklab,var(--success)_30%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_8%,transparent)] text-[var(--success)]"
                          : "border-[color-mix(in_oklab,var(--accent-cyan)_30%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_8%,transparent)] text-[var(--accent-cyan)]"
                      )}
                    >
                      {ver.confirmed ? <Check className="w-2 h-2" /> : <FileEdit className="w-2 h-2" />}
                      #{ver.editNumber}
                    </span>
                  ))}
                </div>
              )}

              {/* Confirm / Discard actions */}
              <div className="flex items-center justify-between px-3 py-2 bg-[var(--bg-secondary)] text-xs">
                <span className="text-[var(--text-secondary)] flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  AI edit applied
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDiscard}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[var(--accent-coral)] hover:bg-[var(--accent-coral)]/10 transition-colors"
                  >
                    <Undo2 className="w-3 h-3" />
                    Revert
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[var(--success)] hover:bg-[color-mix(in_oklab,var(--success)_10%,transparent)] transition-colors"
                  >
                    <Check className="w-3 h-3" />
                    Keep
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input bar */}
        <div className="p-3">
          <QuickChat
            value={input}
            onChange={setInput}
            onSubmit={handleSend}
            onStop={stopGeneration}
            isStreaming={streaming}
            placeholder="Ask AI about this artifact..."
            leftContent={<Sparkles className="w-3.5 h-3.5 text-[var(--text-tertiary)] shrink-0" />}
          />
        </div>
      </div>
    );
  }

  // Full-page context — conversational layout
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {error ? (
          <div className="rounded-xl border border-[color-mix(in_oklab,var(--danger)_24%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_8%,var(--bg-secondary))] px-3 py-2 text-xs text-[var(--danger)]">
            {error}
          </div>
        ) : null}
        {/* Execution trace header */}
        {latestAssistantTrace && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-[var(--border-default)] px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                {latestAssistantTrace.routePlan?.executionPath ?? "direct_chat"}
              </span>
              {latestAssistantTrace.routePlan?.workspaceAction?.intent ? (
                <span className="rounded-full border border-[var(--border-default)] px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                  action {latestAssistantTrace.routePlan.workspaceAction.intent}
                </span>
              ) : null}
            </div>
            <ExecutionTimeline routeTrace={latestAssistantTrace} compact />
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <Sparkles className="w-6 h-6 text-[var(--text-tertiary)] mb-2" />
            <p className="text-sm text-[var(--text-secondary)]">
              Ask AI about this artifact
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex flex-col gap-1",
              msg.role === "user" ? "items-end" : "items-start",
            )}
          >
            <div
              className={cn(
                "max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                msg.role === "user"
                  ? "bg-[var(--accent-cyan)] text-white rounded-br-md"
                  : "bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-bl-md",
              )}
            >
              {msg.content || (msg.streaming && (
                <span className="text-[var(--accent-cyan)] text-xs animate-pulse">
                  {streamPhase || "Thinking..."}
                </span>
              ))}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Version / Edit bar — full-page context */}
      <AnimatePresence>
        {discardTimer !== null && onApplyEdits && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-[var(--border-default)]"
          >
            {/* Version header */}
            <div className="flex items-center gap-2 px-4 py-1.5 bg-[color-mix(in_oklab,var(--accent-cyan)_4%,var(--bg-secondary))]">
              <FileEdit className="w-3 h-3 text-[var(--accent-cyan)]" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--accent-cyan)]">
                Edit #{editCount}
              </span>
              <span className="text-[9px] text-[var(--text-tertiary)] tabular-nums">
                {discardTimer}s to review
              </span>
              {editHistory.length > 1 && (
                <div className="ml-auto flex items-center gap-1">
                  <Layers className="w-2.5 h-2.5 text-[var(--text-tertiary)]" />
                  {editHistory.map((ver) => (
                    <span
                      key={ver.editNumber}
                      className={cn(
                        "inline-flex items-center gap-0.5 rounded-sm border px-1 py-0.5 text-[8px] font-medium",
                        ver.confirmed
                          ? "border-[color-mix(in_oklab,var(--success)_30%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_8%,transparent)] text-[var(--success)]"
                          : "border-[color-mix(in_oklab,var(--accent-cyan)_30%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_8%,transparent)] text-[var(--accent-cyan)]"
                      )}
                    >
                      {ver.confirmed ? <Check className="w-2 h-2" /> : <FileEdit className="w-2 h-2" />}
                      #{ver.editNumber}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between px-4 py-2 bg-[var(--bg-secondary)] text-xs">
              <span className="text-[var(--text-secondary)]">
                AI made {editCount} {editCount === 1 ? "change" : "changes"}
              </span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={handleDiscard} className="text-[var(--accent-coral)] hover:underline">
                  Discard
                </button>
                <span className="text-[var(--text-tertiary)] tabular-nums">{discardTimer}s</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Composer */}
      <div className="shrink-0 p-3 pb-8">
        <QuickChat
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          onStop={stopGeneration}
          isStreaming={streaming}
          placeholder="Ask AI about this artifact..."
        />
      </div>
    </div>
  );
}
