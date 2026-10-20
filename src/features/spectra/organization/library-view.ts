"use client";

import { useCallback, useState } from "react";

/*
 * How the reader likes to look at the Library, remembered on this device
 * (LIBRARY.md, "Views"): shelf or list, and whether the list keeps its quick
 * access pane open. Every place keeps the same view, so stepping into a
 * folder or a workspace never changes it, and a new tab opens in it too.
 */

export type LibraryView = "shelf" | "list";

const VIEW_KEY = "spectra.library.view";
const PANE_KEY = "spectra.library.quick-pane";

function read(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A preference is a convenience; without storage it lasts this visit.
  }
}

/** A choice kept on this device: read once, written on every change. */
function useRemembered<T extends string>(key: string, fallback: T, valid: readonly T[]) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return fallback;
    const stored = read(key);
    return valid.includes(stored as T) ? (stored as T) : fallback;
  });
  const remember = useCallback(
    (next: T) => {
      setValue(next);
      write(key, next);
    },
    [key],
  );
  return [value, remember] as const;
}

export function useLibraryView() {
  return useRemembered<LibraryView>(VIEW_KEY, "shelf", ["shelf", "list"]);
}

/** Whether the list shows its quick access pane. Open until the reader closes it. */
export function useQuickPane() {
  const [value, remember] = useRemembered(PANE_KEY, "open", ["open", "closed"]);
  const toggle = useCallback(() => remember(value === "open" ? "closed" : "open"), [remember, value]);
  return [value === "open", toggle] as const;
}

/** How a stack on a shelf shows: closed in its folder, or open as cards with a tab each. */
export function useStackLook(stackId: string) {
  return useRemembered<"folder" | "cards">(`spectra.library.stack.${stackId}`, "folder", ["folder", "cards"]);
}
