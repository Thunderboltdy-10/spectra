"use client";

import { useState, useRef, useCallback, useEffect, KeyboardEvent } from "react";
import { StickyNote, ChevronDown } from "lucide-react";
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

/**
 * Quick Notes hub item u2014 left edge.
 * Bullet-point style, direct inline editing, dismiss downward when done.
 * Feels like a quick capture scratchpad, not a card system.
 */
export function QuickNotesHub({ className, forceExpanded }: { className?: string; forceExpanded?: boolean }) {
  const [locked, setLocked] = useState(false);
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setNotes(loadNotes());
    setHydrated(true);
  }, []);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (hydrated) saveNotes(notes);
  }, [notes, hydrated]);

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
    }
  }, [editingId]);

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

  const dismissNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const completeNote = useCallback((id: string) => {
    // Mark as completed and move to bottom, then remove after brief delay
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, completed: true } : n)),
    );
    setTimeout(() => {
      setNotes((prev) => prev.filter((n) => n.id !== id));
    }, 600);
  }, []);

  const startEdit = useCallback((note: QuickNote) => {
    setEditingId(note.id);
    setEditDraft(note.text);
  }, []);

  const commitEdit = useCallback(() => {
    if (!editingId) return;
    const trimmed = editDraft.trim();
    if (trimmed) {
      setNotes((prev) =>
        prev.map((n) => (n.id === editingId ? { ...n, text: trimmed } : n)),
      );
    }
    setEditingId(null);
    setEditDraft("");
  }, [editingId, editDraft]);

  const handleEditKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
    if (e.key === "Escape") { setEditingId(null); setEditDraft(""); }
  }, [commitEdit]);

  const activeNotes = notes.filter((n) => !n.completed);

  const collapsed = (
    <button
      type="button"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-[14px] border w-[36px] min-h-[100px] py-3",
        "border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/95 backdrop-blur-xl",
        "shadow-[0_10px_24px_-16px_rgba(8,22,40,0.14)] transition-all duration-200",
        "hover:bg-[var(--bg-hover)] cursor-pointer",
        className,
      )}
    >
      <StickyNote className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
      <span className="text-[10px] font-semibold text-[var(--text-secondary)]" style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}>
        Notes
      </span>
      {activeNotes.length > 0 && (
        <span className="flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[var(--warning,#f59f0a)] px-1 text-[8px] font-bold text-white">
          {activeNotes.length}
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
      forceExpanded={forceExpanded}
      onToggleLock={() => setLocked((l) => !l)}
      className="!top-auto !translate-y-0 !bottom-[25vh]"
      expandedClassName="left-4 bottom-[18vh]"
    >
      <div className="flex h-[min(60vh,520px)] w-[360px] flex-col overflow-hidden rounded-[28px]">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          <StickyNote className="h-4 w-4 text-[var(--warning,#f59f0a)]" />
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">
            Quick Notes
          </span>
          {activeNotes.length > 0 && (
            <span className="text-[10px] font-medium text-[var(--text-tertiary)]">
              {activeNotes.length}
            </span>
          )}
        </div>

        {/* Input u2014 bullet-point style */}
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2">
            <span className="text-[var(--warning,#f59f0a)]/70 text-[16px] font-bold leading-none">•</span>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim()) {
                  e.preventDefault();
                  addNote();
                }
              }}
              placeholder="Type a note and press Enter2026"
              className="min-w-0 flex-1 bg-transparent text-[13px] leading-relaxed text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]/40"
            />
          </div>
          <div className="mt-1 ml-5 h-px bg-[var(--border-default)]/15" />
        </div>

        {/* Notes list u2014 bullet points, inline editable */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {notes.length === 0 ? (
            <div className="flex h-24 flex-col items-center justify-center text-center">
              <span className="text-[11px] text-[var(--text-tertiary)]/50">
                Type above to capture a quick note.
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-0">
              {notes.map((note, noteIdx) => (
                <div key={note.id}>
                  {noteIdx > 0 && <div className="h-px bg-[var(--border-default)]/10 mx-2 my-0.5" />}
                  <div
                    className={cn(
                      "group/note flex items-start gap-2 rounded-lg px-1 py-1.5 transition-all duration-200",
                      note.completed && "opacity-40 translate-x-2",
                    )}
                  >
                  {/* Bullet / dismiss action */}
                  <button
                    type="button"
                    onClick={() => completeNote(note.id)}
                    className="mt-[2px] shrink-0 text-[16px] font-bold text-[var(--text-tertiary)]/40 transition-colors hover:text-[var(--success)] leading-none"
                    title="Done u2014 dismiss downward"
                  >
                    •
                  </button>

                  {/* Content u2014 inline editable */}
                  {editingId === note.id ? (
                    <input
                      ref={editRef}
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={handleEditKeyDown}
                      onBlur={commitEdit}
                      className="min-w-0 flex-1 bg-transparent text-[13px] leading-relaxed text-[var(--text-primary)] outline-none border-b border-[var(--accent-cyan)]/30"
                    />
                  ) : (
                    <span
                      className={cn(
                        "flex-1 text-[13px] leading-relaxed cursor-text select-text",
                        note.completed
                          ? "text-[var(--text-tertiary)] line-through"
                          : "text-[var(--text-primary)]",
                      )}
                      onClick={() => !note.completed && startEdit(note)}
                    >
                      {note.text}
                    </span>
                  )}

                  {/* Dismiss chevron */}
                  {!note.completed && (
                    <button
                      type="button"
                      onClick={() => dismissNote(note.id)}
                      className="mt-0.5 shrink-0 text-[var(--text-tertiary)]/0 transition-colors group-hover/note:text-[var(--text-tertiary)]/30 hover:!text-[var(--text-tertiary)]/60"
                      title="Dismiss"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </HubSurface>
  );
}
