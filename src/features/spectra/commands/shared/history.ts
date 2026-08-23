import { Redo2, Undo2 } from "lucide-react";
import type { CommandBinding } from "../types";

/**
 * Undo and redo, written once.
 *
 * Every studio had the same two buttons with a different label, a different
 * icon, and a different opinion about whether they were essential. History is
 * the most-reached-for pair in any editor, so it is defined here and mounted
 * identically in Document, Sheets and Presentation: same ids, same order, same
 * shortcuts, same shed behaviour. A type supplies only the two functions and
 * whether each is currently possible.
 */
export type HistoryAdapter = {
  undo: () => void;
  redo: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /** What the next undo would reverse, e.g. "Bold". Shown as the hint. */
  undoLabel?: string;
  redoLabel?: string;
};

export function historyBindings(adapter: HistoryAdapter): CommandBinding[] {
  return [
    {
      id: "history.undo",
      label: "Undo",
      icon: Undo2,
      priority: "essential",
      general: true,
      requires: "edit",
      shortcut: "Mod+Z",
      disabled: adapter.canUndo === false,
      hint: adapter.canUndo === false
        ? "Nothing to undo yet"
        : adapter.undoLabel
          ? `Undo ${adapter.undoLabel}`
          : "Step back through your edits",
      undo: "yjs",
      onSelect: () => adapter.undo(),
    },
    {
      id: "history.redo",
      label: "Redo",
      icon: Redo2,
      priority: "essential",
      general: true,
      requires: "edit",
      shortcut: "Mod+Shift+Z",
      disabled: adapter.canRedo === false,
      hint: adapter.canRedo === false
        ? "Nothing to redo"
        : adapter.redoLabel
          ? `Redo ${adapter.redoLabel}`
          : "Step forward again",
      undo: "yjs",
      onSelect: () => adapter.redo(),
    },
  ];
}
