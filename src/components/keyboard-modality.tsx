"use client";

import { useEffect } from "react";

/*
 * Focus rings are for finding your way by keyboard. The browser's own guess
 * also shows them after Alt+Tab, or any key held on return to the window, on
 * whatever had focus; so the page says when the keyboard is actually being
 * used to move: Tab turns rings on, the pointer turns them off.
 */
export function KeyboardModality() {
  useEffect(() => {
    const root = document.documentElement;
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === "Tab" || event.key === "F6") && !event.altKey && !event.metaKey && !event.ctrlKey) root.dataset.keys = "";
    };
    const onPointer = () => {
      delete root.dataset.keys;
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);
  return null;
}
