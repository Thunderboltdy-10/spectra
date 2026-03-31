"use client";

/**
 * Artifact AI Interaction Surface
 *
 * Adapts to two contexts:
 * - "full-page": renders as right-panel conversational UI
 * - "workspace-panel": inline within artifact panel, response area expands above input bar
 *
 * Action-first: AI edits auto-apply, user can discard within 30s.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Square,
  Undo2,
  Check,
  Sparkles,
} from "lucide-react";
import type { Editor } from "@tiptap/core";
import { useChatPanel } from "@/hooks/use-chat-panel";
import { cn } from "@/lib/utils";

interface ArtifactAiSurfaceProps {
  artifactId: string;
  editor?: Editor | null;
  context: "full-page" | "workspace-panel";
  onApplyEdits?: (ops: Array<{ type: string; from: number; to: number; content?: string }>) => void;
  onDiscard?: () => void;
  workstreamId?: string;
}

export function ArtifactAiSurface({
  artifactId,
  context,
  onApplyEdits,
  onDiscard,
  workstreamId,
}: ArtifactAiSurfaceProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Discard state
  const [discardTimer, setDiscardTimer] = useState<number | null>(null);
  const [editCount, setEditCount] = useState(0);
  const discardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    messages,
    streaming,
    streamPhase,
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
      setEditCount((c) => c + 1);
      setDiscardTimer(30);
    }
  }, [input, onApplyEdits, streaming, sendMessage]);

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
  }, [onDiscard]);

  const handleConfirm = useCallback(() => {
    setDiscardTimer(null);
    if (discardTimerRef.current) clearInterval(discardTimerRef.current);
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
              <div className="max-h-48 overflow-y-auto px-4 py-3 space-y-3">
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

        {/* Discard bar */}
        <AnimatePresence>
          {discardTimer !== null && onApplyEdits && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center justify-between px-4 py-2 bg-[var(--bg-secondary)] border-t border-[var(--border-default)] text-xs"
            >
              <span className="text-[var(--text-secondary)]">
                <Sparkles className="w-3 h-3 inline mr-1" />
                AI made {editCount} {editCount === 1 ? "change" : "changes"}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDiscard}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[var(--accent-coral)] hover:bg-[var(--accent-coral)]/10 transition-colors"
                >
                  <Undo2 className="w-3 h-3" />
                  Discard
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[var(--accent-mint)] hover:bg-[var(--accent-mint)]/10 transition-colors"
                >
                  <Check className="w-3 h-3" />
                  Confirm
                </button>
                <span className="text-[var(--text-tertiary)] tabular-nums w-6 text-right">
                  {discardTimer}s
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input bar */}
        <div className="p-3 border-t border-[var(--border-default)]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-default)] focus-within:border-[var(--accent-cyan)]/40 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-[var(--text-tertiary)] shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask AI to edit..."
              className="flex-1 bg-transparent border-none outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
              disabled={streaming}
            />
            {streaming ? (
              <button
                type="button"
                onClick={stopGeneration}
                className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-[var(--accent-coral)]/15 text-[var(--accent-coral)]"
              >
                <Square className="w-3 h-3" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className={cn(
                  "shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors",
                  input.trim()
                    ? "bg-[var(--accent-cyan)] text-white"
                    : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]",
                )}
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </form>
        </div>
      </div>
    );
  }

  // Full-page context — conversational layout
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
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

      {/* Discard bar */}
      <AnimatePresence>
        {discardTimer !== null && onApplyEdits && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex items-center justify-between px-4 py-2 bg-[var(--bg-secondary)] border-t border-[var(--border-default)] text-xs"
          >
            <span className="text-[var(--text-secondary)]">
              AI made {editCount} {editCount === 1 ? "change" : "changes"}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={handleDiscard} className="text-[var(--accent-coral)] hover:underline">
                Discard
              </button>
              <span className="text-[var(--text-tertiary)] tabular-nums">{discardTimer}s</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Composer */}
      <div className="shrink-0 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-default)] focus-within:border-[var(--accent-cyan)]/40 transition-colors"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask AI to edit this artifact..."
            className="flex-1 bg-transparent border-none outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
            disabled={streaming}
          />
          {streaming ? (
            <button type="button" onClick={stopGeneration} className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-[var(--accent-coral)]/15 text-[var(--accent-coral)]">
              <Square className="w-3 h-3" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className={cn(
                "shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors",
                input.trim() ? "bg-[var(--accent-cyan)] text-white" : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]",
              )}
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
