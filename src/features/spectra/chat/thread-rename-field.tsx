"use client";

import { useState } from "react";
import { IconButton } from "@/components/ui/icon-button";

/** The open thread's name, edited in place under the page header. */
export function ThreadRenameField({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: string;
  saving: boolean;
  onSave: (title: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const title = draft.trim();
  return (
    <div className="chat-rename absolute left-6 top-14 z-modal flex w-[min(440px,calc(100%-48px))] items-center gap-1.5 p-2">
      <input
        autoFocus
        value={draft}
        maxLength={64}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        aria-label="Thread name"
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
          if (event.key === "Enter" && title) onSave(title);
        }}
        className="h-9 min-w-0 flex-1 bg-transparent px-2 font-display text-title text-[var(--text-primary)] outline-none"
      />
      <IconButton icon="check" label="Save name" disabled={!title || saving} onClick={() => onSave(title)} />
      <IconButton icon="close" label="Cancel" onClick={onCancel} />
    </div>
  );
}
