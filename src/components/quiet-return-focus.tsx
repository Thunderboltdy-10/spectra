"use client";

import { useEffect } from "react";

/*
 * Returning to the window (Alt+Tab, a click on the taskbar) makes the browser
 * draw a ring on whatever still had focus, even when it was last reached with
 * the pointer. Only that one element stays quiet, until a key other than a
 * modifier is pressed or focus moves. Every other ring is the browser's own
 * :focus-visible.
 */
const MODIFIERS = new Set(["Alt", "AltGraph", "Control", "Meta", "Shift", "OS"]);

export function QuietReturnFocus() {
  useEffect(() => {
    let pointerLast = false;
    let quiet: Element | null = null;
    const clear = () => {
      quiet?.removeAttribute("data-quiet-focus");
      quiet = null;
    };
    const onPointer = () => {
      pointerLast = true;
      clear();
    };
    const onKey = (event: KeyboardEvent) => {
      if (MODIFIERS.has(event.key)) return;
      pointerLast = false;
      clear();
    };
    const onReturn = () => {
      const active = document.activeElement;
      if (!pointerLast || !active || active === document.body) return;
      clear();
      quiet = active;
      active.setAttribute("data-quiet-focus", "");
    };
    const onFocusIn = (event: FocusEvent) => {
      if (quiet && event.target !== quiet) clear();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("focus", onReturn);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("focusin", onFocusIn, true);
      clear();
    };
  }, []);
  return null;
}
