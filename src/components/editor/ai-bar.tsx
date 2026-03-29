"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import { Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";

interface DiffPreview {
  ops: Array<{ type: "replace" | "insert" | "delete"; from: number; to: number; content?: string; reason?: string }>;
  summary: string;
  threadChatId?: string;
  assistantMessageId?: string;
}

type EditorSnapshot = {
  json: JSONContent;
  text: string;
};

type PendingAiLifecycle = {
  artifactId: string;
  versionId: string;
  threadChatId?: string;
  assistantMessageId?: string;
  summary: string;
  status: "applied" | "discarded";
  remainingMs: number;
};

interface AiBarProps {
  editor: Editor;
  onApplyEdits: (ops: DiffPreview["ops"]) => EditorSnapshot | null;
  onReplaceDocument: (content: JSONContent) => EditorSnapshot | null;
  noteId?: string;
  artifactId?: string;
}

export function AiBar({ editor, onApplyEdits, onReplaceDocument, noteId, artifactId }: AiBarProps) {
  const { aiBarPrompt, setAiBarPrompt, aiBarBusy, setAiBarBusy } = useEditorStore();
  const [pendingEdit, setPendingEdit] = useState<PendingAiLifecycle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRetryCount, setConfirmRetryCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const ignoreNextEditorUpdateRef = useRef(0);
  const versionRef = useRef<PendingAiLifecycle | null>(null);

  useEffect(() => {
    versionRef.current = pendingEdit;
  }, [pendingEdit]);

  const confirmPendingEdit = useCallback(async () => {
    const current = versionRef.current;
    if (!current || current.status !== "applied") return true;
    const response = await fetch("/api/artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "confirmAiEdit",
        artifactId: current.artifactId,
        versionId: current.versionId,
      }),
    }).catch(() => null);
    if (!response?.ok) {
      setConfirmRetryCount((count) => {
        const next = count + 1;
        if (next >= 3) {
          setError("Confirmation failed. Changes are still applied locally. Retry manually if needed.");
          setPendingEdit((pending) => (
            pending && pending.versionId === current.versionId && pending.status === "applied"
              ? { ...pending, remainingMs: -1 }
              : pending
          ));
          return next;
        }
        setError("Failed to confirm AI edit. Retrying shortly.");
        return next;
      });
      setPendingEdit((pending) => (
        pending && pending.versionId === current.versionId && pending.status === "applied" && pending.remainingMs >= 0
          ? { ...pending, remainingMs: 1000 }
          : pending
      ));
      return false;
    }
    versionRef.current = null;
    setPendingEdit(null);
    setConfirmRetryCount(0);
    setError(null);
    return true;
  }, []);

  useEffect(() => {
    if (!pendingEdit || pendingEdit.status !== "applied") return;
    const timeout = setTimeout(() => {
      if (pendingEdit.remainingMs < 0) {
        return;
      }
      if (pendingEdit.remainingMs <= 1000) {
        void confirmPendingEdit();
        return;
      }
      setPendingEdit((current) => {
        if (!current || current.status !== "applied") return current;
        return {
          ...current,
          remainingMs: Math.max(0, current.remainingMs - 1000),
        };
      });
    }, Math.min(1000, pendingEdit.remainingMs));
    return () => clearTimeout(timeout);
  }, [confirmPendingEdit, pendingEdit]);

  useEffect(() => {
    const onUpdate = () => {
      if (ignoreNextEditorUpdateRef.current > 0) {
        ignoreNextEditorUpdateRef.current -= 1;
        return;
      }
      const current = versionRef.current;
      if (current?.status === "applied") {
        void confirmPendingEdit();
      }
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [confirmPendingEdit, editor]);

  const handleSubmit = useCallback(async () => {
    if (!aiBarPrompt.trim() || aiBarBusy) return;

    if (versionRef.current?.status === "applied") {
      const confirmed = await confirmPendingEdit();
      if (!confirmed) return;
    }

    setAiBarBusy(true);
    setError(null);

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const previousSnapshot: EditorSnapshot = {
      json: editor.getJSON(),
      text: editor.getText(),
    };
    let editAppliedLocally = false;

    try {
      const document = previousSnapshot.json;
      const text = previousSnapshot.text;

      const res = await fetch("/api/editor/ai-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: aiBarPrompt.trim(),
          document,
          documentText: text,
          noteId,
          artifactId,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "AI edit failed");
      }

      const result = (await res.json()) as DiffPreview;
      ignoreNextEditorUpdateRef.current += 1;
      const snapshot = onApplyEdits(result.ops);
      if (!snapshot) {
        throw new Error("Failed to apply AI edit");
      }
      editAppliedLocally = true;
      let targetArtifactId = artifactId;
      if (!targetArtifactId && noteId) {
        const migrateRes = await fetch("/api/artifacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "getOrMigrateFromNote",
            noteId,
          }),
        });
        if (!migrateRes.ok) {
          throw new Error(await migrateRes.text() || "Failed to prepare artifact for AI edit");
        }
        const migrated = (await migrateRes.json()) as { artifactId?: string };
        targetArtifactId = migrated.artifactId;
      }
      if (targetArtifactId) {
        const persistRes = await fetch("/api/artifacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "applyAiEdit",
            artifactId: targetArtifactId,
            content: snapshot.json,
            contentPlaintext: snapshot.text,
            instruction: aiBarPrompt.trim(),
            operations: result.ops,
            summary: result.summary,
            sourceChatId: result.threadChatId,
            sourceMessageId: result.assistantMessageId,
            lastAiEditId: result.assistantMessageId,
            pendingDiffs: result.ops,
          }),
        });
        if (!persistRes.ok) {
          throw new Error(await persistRes.text() || "Failed to persist AI edit");
        }
        const persisted = (await persistRes.json()) as { versionId?: string };
        if (persisted.versionId) {
      setPendingEdit({
            artifactId: targetArtifactId,
            versionId: persisted.versionId,
            threadChatId: result.threadChatId,
            assistantMessageId: result.assistantMessageId,
            summary: result.summary,
            status: "applied",
            remainingMs: 30_000,
          });
          setConfirmRetryCount(0);
        }
      }
      setAiBarPrompt("");
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message || "Something went wrong");
        if (editAppliedLocally) {
          ignoreNextEditorUpdateRef.current += 1;
          onReplaceDocument(previousSnapshot.json);
        }
      }
    } finally {
      setAiBarBusy(false);
    }
  }, [aiBarPrompt, aiBarBusy, artifactId, confirmPendingEdit, editor, noteId, onApplyEdits, onReplaceDocument, setAiBarBusy, setAiBarPrompt]);

  const handleDiscard = useCallback(async () => {
    if (!pendingEdit || pendingEdit.status !== "applied") return;
    const response = await fetch("/api/artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "discardAiEdit",
        artifactId: pendingEdit.artifactId,
        versionId: pendingEdit.versionId,
      }),
    });
    if (!response.ok) {
      setError(await response.text() || "Failed to discard AI edit");
      return;
    }
    const data = (await response.json()) as { content?: JSONContent };
    if (data.content) {
      ignoreNextEditorUpdateRef.current += 1;
      onReplaceDocument(data.content);
    }
    setPendingEdit({
      ...pendingEdit,
      status: "discarded",
      remainingMs: 0,
    });
  }, [onReplaceDocument, pendingEdit]);

  const handleReapply = useCallback(async () => {
    if (!pendingEdit) return;
    const response = await fetch("/api/artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reapplyAiEdit",
        artifactId: pendingEdit.artifactId,
        versionId: pendingEdit.versionId,
      }),
    });
    if (!response.ok) {
      setError(await response.text() || "Failed to re-apply AI edit");
      return;
    }
    const data = (await response.json()) as { content?: JSONContent };
    if (data.content) {
      ignoreNextEditorUpdateRef.current += 1;
      onReplaceDocument(data.content);
    }
    setPendingEdit({
      ...pendingEdit,
      status: "applied",
      remainingMs: 30_000,
    });
  }, [onReplaceDocument, pendingEdit]);

  const dismissError = useCallback(() => {
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
            onClick={dismissError}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {pendingEdit && (
        <div className="px-3 pb-2 flex items-center justify-between gap-2">
          <p className="text-xs text-[var(--text-secondary)] flex-1">
            <span className="text-[var(--accent-cyan)] font-medium">AI edit:</span>{" "}
            {pendingEdit.summary || "Document updated."}
            {pendingEdit.status === "applied"
              ? pendingEdit.remainingMs > 0
                ? ` Auto-confirming in ${Math.max(0, Math.ceil(pendingEdit.remainingMs / 1000))}s`
                : " Ready to confirm."
              : " Discarded."}
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            {pendingEdit.status === "applied" ? (
              <>
                <button
                  type="button"
                  onClick={() => void confirmPendingEdit()}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  {pendingEdit.remainingMs < 0 ? "Retry" : "Keep"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDiscard()}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <X className="w-3 h-3" />
                  Discard
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void handleReapply()}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-[var(--accent-mint)] text-white hover:brightness-110 transition-all"
              >
                <RotateCcw className="w-3 h-3" />
                Re-apply
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
