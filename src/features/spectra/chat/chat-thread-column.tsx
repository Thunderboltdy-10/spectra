"use client";

import { forwardRef } from "react";
import { Icon } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import type { SpectraThread } from "../data/api";
import { ThreadsBrowser, type ThreadsBrowserHandle } from "../threads/threads-view";
import { THREAD_COLUMN_WIDTH } from "./use-thread-column";

/*
 * Every thread beside the conversation (SHELL.md, "The chat page"): a new one
 * is the first, always-visible button; below it the search that reads meaning
 * as well as words, and the threads grouped by what is moving and when.
 */

export const ChatThreadColumn = forwardRef<
  ThreadsBrowserHandle,
  {
    selectedId: string | null;
    onChoose: (thread: SpectraThread) => void;
    onNewThread: () => void;
    onHide: () => void;
  }
>(function ChatThreadColumn({ selectedId, onChoose, onNewThread, onHide }, ref) {
  return (
    <aside aria-label="Threads" style={{ width: THREAD_COLUMN_WIDTH }} className="chat-thread-column flex shrink-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 pl-5 pr-3">
        <h2 className="min-w-0 flex-1 font-display text-heading font-medium leading-none text-[var(--text-primary)]">Threads</h2>
        <IconButton icon="sidebar" label="Hide threads" onClick={onHide} />
      </div>
      <div className="shrink-0 px-3 pb-3">
        <button type="button" onClick={onNewThread} aria-keyshortcuts="Control+Shift+N" className="chat-new-thread">
          <Icon name="add" size={16} />
          <span className="flex-1 text-left">New thread</span>
          <kbd>Ctrl Shift N</kbd>
        </button>
      </div>
      <ThreadsBrowser ref={ref} selectedId={selectedId} onChoose={(thread) => onChoose(thread)} className="min-h-0 flex-1" listClassName="pb-28" />
    </aside>
  );
});
