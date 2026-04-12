"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { StickyNote, Plus, Check, Trash2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { HubSurface } from "@/components/workspace/hub-surface";

type QuickNote = {
  id: string;
  text: string;
  createdAt: number;
  completed: boolean;
};

const STORAGE_KEY = "spectra:quick-notes";

function loadNotes(): QuickNote[] {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return [];
    return JSON.parse(raw) as QuickNote[];
  } catch {
    return [];
  }
}

function saveNotes(notes: QuickNote[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch {}
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

/**
 * Quick Notes hub item — left edge, ~3/4 down.
 * A real note-taking surface for quick capture, not a placeholder.
 */
export function QuickNotesHub({ className }: { className?: string }) {
  const [locked, setLocked] = useState(false);
  const [notes, setNotes] = useState<QuickNote[]>(loadNotes);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Persist notes
  useEffect(() => {
    saveNotes(notes);
  }, [notes]);

  const addNote = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const note: QuickNote = {
      id: `qn-${Date.now()}`,
      text: trimmed,
      createdAt: Date.now(),
      completed: false,
    };
    setNotes((prev) => [note, ...prev]);
    setDraft("");
    inputRef.current?.focus();
  }, [draft]);

  const toggleNote = useCallback((id: string) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, completed: !n.completed } : n)),
    );
  }, []);

  const deleteNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const activeCount = notes.filter((n) => !n.completed).length;

  const collapsed = (
    <button
      type="button"
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-r-[20px] border border-l-0 py-3.5 pl-1.5 pr-2.5",
        "border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/95 backdrop-blur-xl",
        "shadow-[0_8px_22px_-16px_rgba(8,22,40,0.14)] transition-all duration-200",
        "hover:bg-[var(--bg-hover)] cursor-pointer",
        className,
      )}
    >
      <StickyNote className="h-4.5 w-4.5 text-[var(--text-secondary)]" />
      <span
        className="text-[10px] font-semibold text-[var(--text-secondary)]"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        Notes
      </span>
      {activeCount > 0 && (
        <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--warning,#f59f0a)] px-1 text-[9px] font-bold text-white">
          {activeCount}
        </span>
      )}
    </button>
  );

  return (
    <HubSurface
      id="quick-notes-hub"
      edge="left"
      collapsed={collapsed}
      locked={locked}
      onToggleLock={() => setLocked((l) => !l)}
      className="!top-auto !translate-y-0 !bottom-[25vh]"
      expandedClassName="left-0 bottom-0"
    >
      <div className="flex h-[min(56vh,480px)] w-[280px] flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <StickyNote className="h-4 w-4 text-[var(--warning,#f59f0a)]" />
            <span className="text-[13px] font-semibold text-[var(--text-primary)]">
              Quick Notes
            </span>
            {activeCount > 0 && (
              <span className="text-[10px] font-medium text-[var(--text-tertiary)]">
                {activeCount}
              </span>
            )}
          </div>
        </div>

        {/* Input area */}
        <div className="px-3 pb-2">
          <div className="flex items-start gap-2 rounded-2xl border border-[var(--border-default)]/30 bg-[var(--bg-secondary)]/40 px-3 py-2.5">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  addNote();
                }
              }}
              placeholder="Jot something downu2026"
              rows={2}
              className="min-w-0 flex-1 resize-none bg-transparent text-[12px] leading-relaxed text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]/50"
            />
            <button
              type="button"
              onClick={addNote}
              disabled={!draft.trim()}
              className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-all duration-150",
                draft.trim()
                  ? "bg-[var(--warning,#f59f0a)] text-white shadow-[0_2px_8px_-3px_rgba(245,159,10,0.40)]"
                  : "bg-transparent text-[var(--text-tertiary)]/30",
              )}
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Notes list */}
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {notes.length === 0 ? (
            <div className="flex h-24 flex-col items-center justify-center text-center">
              <StickyNote className="mb-2 h-5 w-5 text-[var(--text-tertiary)]/20" />
              <span className="text-[11px] text-[var(--text-tertiary)]/60">
                No notes yet. Start typing above.
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {notes.map((note) => (
                <div
                  key={note.id}
                  className="group/note flex items-start gap-2 rounded-xl px-2.5 py-2 transition-colors duration-150 hover:bg-[var(--bg-hover)]"
                >
                  <button
                    type="button"
                    onClick={() => toggleNote(note.id)}
                    className="mt-0.5 shrink-0"
                  >
                    {note.completed ? (
                      <Check className="h-3.5 w-3.5 text-[var(--success)]" />
                    ) : (
                      <div className="h-3.5 w-3.5 rounded-[5px] border-[1.5px] border-[var(--text-tertiary)]/30 transition-colors group-hover/note:border-[var(--warning,#f59f0a)]/50" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-[12px] leading-relaxed whitespace-pre-wrap break-words",
                        note.completed
                          ? "text-[var(--text-tertiary)] line-through"
                          : "text-[var(--text-primary)]",
                      )}
                    >
                      {note.text}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1 text-[9px] text-[var(--text-tertiary)]/40">
                      <Clock className="h-2 w-2" />
                      {formatTimeAgo(note.createdAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteNote(note.id)}
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)]/0 transition-colors group-hover/note:text-[var(--text-tertiary)]/40 hover:!text-[var(--danger)]"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </HubSurface>
  );
}
