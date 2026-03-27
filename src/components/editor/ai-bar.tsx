"use client";

import { useCallback, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Check, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";

interface DiffPreview {
  ops: Array<{ type: "replace" | "insert" | "delete"; from: number; to: number; content?: string; reason?: string }>;
  summary: string;
}

interface AiBarProps {
  editor: Editor;
  onApplyEdits: (ops: DiffPreview["ops"]) => void;
  noteId?: string;
  artifactId?: string;
}

export function AiBar({ editor, onApplyEdits, noteId, artifactId }: AiBarProps) {
  const { aiBarPrompt, setAiBarPrompt, aiBarAutoAccept, setAiBarAutoAccept, aiBarBusy, setAiBarBusy } = useEditorStore();
  const [diff, setDiff] = useState<DiffPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!aiBarPrompt.trim() || aiBarBusy) return;

    setAiBarBusy(true);
    setError(null);
    setDiff(null);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const document = editor.getJSON();
      const text = editor.getText();

      const res = await fetch("/api/editor/ai-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: aiBarPrompt.trim(),
          document,
          documentText: text,
          noteId,
          artifactId,
          autoAccept: aiBarAutoAccept,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "AI edit failed");
      }

      const result = (await res.json()) as DiffPreview;

      if (aiBarAutoAccept) {
        // Apply immediately
        onApplyEdits(result.ops);
        setAiBarPrompt("");
      } else {
        // Show diff preview for user to accept/reject
        setDiff(result);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message || "Something went wrong");
      }
    } finally {
      setAiBarBusy(false);
    }
  }, [aiBarPrompt, aiBarBusy, aiBarAutoAccept, editor, noteId, artifactId, onApplyEdits, setAiBarBusy, setAiBarPrompt]);

  const handleAccept = useCallback(() => {
    if (!diff) return;
    onApplyEdits(diff.ops);
    setDiff(null);
    setAiBarPrompt("");
  }, [diff, onApplyEdits, setAiBarPrompt]);

  const handleReject = useCallback(() => {
    setDiff(null);
    setError(null);
  }, []);

  return (
    <div className="shrink-0 border-b border-[var(--border-default)] bg-[var(--bg-elevated)]">
      {/* Main AI bar */}
      <div className="flex items-center gap-2 px-3 py-2">
        <Sparkles className="w-4 h-4 text-[var(--accent-cyan)] shrink-0" />

        <input
          ref={inputRef}
          type="text"
          value={aiBarPrompt}
          onChange={(e) => setAiBarPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSubmit();
            if (e.key === "Escape") setAiBarPrompt("");
          }}
          placeholder='AI: "Fix grammar", "Add a conclusion", "Make this more concise"...'
          disabled={aiBarBusy}
          className="flex-1 bg-transparent border-none outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] disabled:opacity-50"
        />

        {/* Auto-accept toggle */}
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] cursor-pointer shrink-0">
          <span>Auto-accept</span>
          <button
            type="button"
            role="switch"
            aria-checked={aiBarAutoAccept}
            onClick={() => setAiBarAutoAccept(!aiBarAutoAccept)}
            className={cn(
              "relative inline-flex h-4 w-7 rounded-full transition-colors focus:outline-none",
              aiBarAutoAccept ? "bg-[var(--accent-cyan)]" : "bg-[var(--bg-secondary)]",
            )}
          >
            <span
              className={cn(
                "inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition-transform",
                "absolute top-0.5",
                aiBarAutoAccept ? "translate-x-3.5" : "translate-x-0.5",
              )}
            />
          </button>
        </label>

        {aiBarBusy ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-[var(--text-secondary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] transition-colors shrink-0"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!aiBarPrompt.trim()}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all shrink-0",
              aiBarPrompt.trim()
                ? "bg-[var(--accent-cyan)] text-white hover:brightness-110"
                : "bg-[var(--bg-secondary)] text-[var(--text-tertiary)] cursor-not-allowed",
            )}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Apply
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 pb-2 flex items-center justify-between">
          <span className="text-xs text-[var(--error)]">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Diff preview */}
      {diff && !aiBarAutoAccept && (
        <div className="px-3 pb-2 flex items-center justify-between gap-2">
          <p className="text-xs text-[var(--text-secondary)] flex-1">
            <span className="text-[var(--accent-cyan)] font-medium">AI suggests:</span>{" "}
            {diff.summary}
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleReject}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <X className="w-3 h-3" />
              Reject
            </button>
            <button
              type="button"
              onClick={handleAccept}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-[var(--accent-mint)] text-white hover:brightness-110 transition-all"
            >
              <Check className="w-3 h-3" />
              Accept
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
