"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export const UNTITLED_WORK_TITLE = "Untitled";

export type CloseIntent = "close" | "confirm";

export function persistableTitle(title: string): string {
  return title.trim() || UNTITLED_WORK_TITLE;
}

export function isBlankTitle(title: string): boolean {
  return !title.trim();
}

/**
 * Close is never a silent no-op (UX-1/UX-2). Clean work closes. Dirty work
 * asks. Queued live changes that have not reached the server are the same
 * as a dirty React draft: closing without a choice would hide the only door
 * to stay, retry, or discard. Saving with an empty name uses Untitled
 * instead of trapping the file.
 */
export function decideClose(
  dirty: boolean,
  queuedChangeCount = 0,
): CloseIntent {
  return dirty || queuedChangeCount > 0 ? "confirm" : "close";
}

/** Atomically admit one close action before React can paint `busy`. */
export function claimCloseAction(lock: { current: boolean }): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function UnsavedCloseDialog({
  open,
  title,
  busy = false,
  onSave,
  onDiscard,
  onKeepEditing,
}: {
  open: boolean;
  title: string;
  busy?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
}) {
  const unnamed = isBlankTitle(title);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onKeepEditing()}>
      <DialogContent
        className="max-w-[min(420px,calc(100vw-32px))] gap-0 p-5"
        hideCloseButton
      >
        <DialogTitle>
          {unnamed ? "Save this work before closing?" : "Save your edits?"}
        </DialogTitle>
        <DialogDescription className="mt-1.5">
          {unnamed
            ? "This work has no name yet. Save it as Untitled, or discard these edits."
            : "Closing without saving will discard the edits you have not saved."}
        </DialogDescription>
        <DialogFooter className="mt-5">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onDiscard}>
            Discard
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={onKeepEditing}
          >
            Keep editing
          </Button>
          <Button variant="primary" size="sm" disabled={busy} onClick={onSave}>
            {unnamed ? "Save as Untitled" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
