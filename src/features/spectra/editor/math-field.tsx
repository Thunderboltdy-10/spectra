"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { MathfieldElement } from "mathlive";

/**
 * The equation editor that sits on the page itself.
 *
 * An equation is typed where it is, as in Word or a rendered Overleaf preview:
 * fractions stack as they are typed, `/` makes one, `\` starts a LaTeX command,
 * and every keystroke is saved to the document, so an equation left half
 * written is still there. MathLive (MIT) draws it with the KaTeX fonts the app
 * already loads, so nothing else is downloaded.
 */

let loading: Promise<typeof import("mathlive")> | undefined;

function loadMathLive() {
  loading ??= import("mathlive").then((module) => {
    // The KaTeX fonts are already on the page; MathLive must not fetch its own
    // copies, and an editor in a document makes no sound.
    module.MathfieldElement.fontsDirectory = null;
    module.MathfieldElement.soundsDirectory = null;
    module.MathfieldElement.keypressSound = null;
    module.MathfieldElement.plonkSound = null;
    return module;
  });
  return loading;
}

/** Warm the editor before an equation is opened, so the first one opens at once. */
export function preloadMathField() {
  if (typeof window !== "undefined") void loadMathLive();
}

/**
 * LaTeX the rest of Spectra reads: KaTeX draws it and the Word writer turns it
 * into Word's own math. Empty slots are dropped (the field still shows them)
 * and MathLive's own spellings become standard ones.
 */
export function normalizeMathLatex(latex: string) {
  return latex
    .replace(/\\placeholder(?:\[[^\]]*\])?\{[^{}]*\}/gu, "")
    .replace(/\\mleft/gu, "\\left")
    .replace(/\\mright/gu, "\\right")
    .replace(/\\differentialD/gu, "\\mathrm{d}")
    .replace(/\\exponentialE/gu, "e")
    .replace(/\\imaginaryI/gu, "i")
    .replace(/\\imaginaryJ/gu, "j")
    .trim();
}

/** A template with its `#?` slots read as plain LaTeX, for when no field is open. */
export function templateAsLatex(template: string) {
  return template.replace(/#[?0@]/gu, "");
}

/* -------------------------------------------------------------- the editor */

type ActiveMath = {
  insert: (template: string) => void;
  source: boolean;
};

let active: ActiveMath | null = null;
let sourceMode = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** The equation being edited, so the Equation tab can insert into it. */
export function activeMathEditor() {
  return active;
}

/** Whether equations are edited as LaTeX source rather than as maths. */
export function useMathSourceMode() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => sourceMode,
    () => false,
  );
}

export function setMathSourceMode(next: boolean) {
  if (sourceMode === next) return;
  sourceMode = next;
  emit();
}

export function registerMathEditor(editor: ActiveMath) {
  active = editor;
  return () => {
    if (active === editor) active = null;
  };
}

type MathFieldProps = {
  value: string;
  inline: boolean;
  label: string;
  onChange: (latex: string) => void;
  /** Leaves the equation: forward after it, backward before it. */
  onExit: (direction: "forward" | "backward") => void;
  /** Shown until the editor has loaded: the equation as it is drawn. */
  fallback?: ReactNode;
};

export function MathField({ value, inline, label, onChange, onExit, fallback }: MathFieldProps) {
  const [ready, setReady] = useState(false);
  const host = useRef<HTMLSpanElement>(null);
  const field = useRef<MathfieldElement | null>(null);
  // What this field last saved: a value coming back unchanged is its own echo,
  // and setting it again would drop the caret and the empty slots.
  const saved = useRef(value);
  const handlers = useRef({ onChange, onExit });
  handlers.current = { onChange, onExit };

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    void loadMathLive().then(({ MathfieldElement }) => {
      if (cancelled || !host.current) return;
      const element = new MathfieldElement();
      element.smartFence = true;
      element.smartSuperscript = true;
      element.mathVirtualKeyboardPolicy = "manual";
      element.defaultMode = inline ? "inline-math" : "math";
      element.setAttribute("aria-label", label);
      element.setAttribute("placeholder", "\\text{Type equation here}");
      element.className = "spectra-math-field";
      element.value = value;
      const commit = () => {
        const latex = normalizeMathLatex(element.getValue("latex"));
        saved.current = latex;
        handlers.current.onChange(latex);
      };
      const onInput = () => commit();
      const onMoveOut = (event: Event) => {
        const direction = (event as CustomEvent<{ direction: string }>).detail?.direction;
        if (direction !== "forward" && direction !== "backward") return;
        event.preventDefault();
        handlers.current.onExit(direction);
      };
      const onKeyDown = (event: KeyboardEvent) => {
        // Escape leaves the equation, unless a LaTeX command is being typed:
        // then Escape ends that command, as it does in MathLive.
        // An Escape a workbar gallery already used to close itself stays there.
        if (event.key === "Escape" && !event.defaultPrevented && element.mode !== "latex") {
          event.preventDefault();
          event.stopPropagation();
          handlers.current.onExit("forward");
        }
      };
      element.addEventListener("input", onInput);
      element.addEventListener("move-out", onMoveOut);
      element.addEventListener("keydown", onKeyDown, { capture: true });
      host.current.replaceChildren(element);
      field.current = element;
      setReady(true);
      const unregister = registerMathEditor({
        source: false,
        insert: (template) => {
          element.focus();
          element.insert(template, { format: "latex", selectionMode: "placeholder", focus: true });
          commit();
          requestAnimationFrame(() => element.focus());
        },
      });
      requestAnimationFrame(() => {
        if (!cancelled) element.focus();
      });
      cleanup = () => {
        unregister();
        element.removeEventListener("input", onInput);
        element.removeEventListener("move-out", onMoveOut);
        element.removeEventListener("keydown", onKeyDown, { capture: true });
        element.remove();
        field.current = null;
      };
    });
    return () => {
      cancelled = true;
      cleanup();
    };
    // The field is made once per opening; later values arrive through `value`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inline]);

  useEffect(() => {
    const element = field.current;
    if (!element || value === saved.current) return;
    // Changed from outside (undo, the AI, Word): show it.
    saved.current = value;
    element.setValue(value, { silenceNotifications: true });
  }, [value]);

  return <>
    {ready ? null : fallback}
    <span ref={host} className={inline ? "spectra-math-host is-inline" : "spectra-math-host"} data-math-host="true" />
  </>;
}
