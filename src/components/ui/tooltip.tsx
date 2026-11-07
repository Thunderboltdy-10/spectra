"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

/* Tooltips wait about 500 ms the first time, then show at once while the
   pointer moves between controls (MOTION.md). */
const FIRST_DELAY_MS = 500;
const WARM_FOR_MS = 700;
let warmUntil = 0;

export function Tooltip({
  label,
  shortcut,
  children,
  side = "top",
  disabled = false,
  className = "inline-flex",
}: {
  label: string;
  /** Shown beside the name, e.g. "⌘K". */
  shortcut?: string;
  children: ReactElement;
  /** "right" for controls on the left edge, like the collapsed rail. */
  side?: "top" | "bottom" | "right";
  /** No tooltip, when the control already shows its name. */
  disabled?: boolean;
  /** The trigger wrapper's layout; a full-width row wants "flex". */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const update = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition(
      side === "right"
        ? { left: rect.right + 8, top: rect.top + rect.height / 2 }
        : {
            left: rect.left + rect.width / 2,
            top: side === "top" ? rect.top - 8 : rect.bottom + 8,
          },
    );
  }, [side]);
  const show = useCallback(() => {
    if (disabled) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(
      () => {
        // The control slid under the pointer and on again while the page moved:
        // only one still under the pointer, or holding keyboard focus, is asked.
        const trigger = triggerRef.current;
        if (!trigger || !(trigger.matches(":hover") || trigger.querySelector(":focus-visible"))) return;
        update();
        setOpen(true);
      },
      Date.now() < warmUntil ? 0 : FIRST_DELAY_MS,
    );
  }, [disabled, update]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const hide = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setOpen((wasOpen) => {
        if (wasOpen) warmUntil = Date.now() + WARM_FOR_MS;
        return false;
      });
    }, 140);
  }, []);
  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );
  useEffect(() => {
    if (!open) return;
    const refresh = () => update();
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    // A control that moved out from under the pointer (a pane opened, a row
    // reflowed) fires no leave of its own: its name goes rather than floating
    // over whatever took its place.
    const start = triggerRef.current?.getBoundingClientRect();
    // A leave can go unseen when the page moved at the same moment; a pointer
    // that is plainly elsewhere settles it.
    const onMove = (event: PointerEvent) => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect || triggerRef.current?.querySelector(":focus-visible")) return;
      const margin = 6;
      if (
        event.clientX < rect.left - margin ||
        event.clientX > rect.right + margin ||
        event.clientY < rect.top - margin ||
        event.clientY > rect.bottom + margin
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    let frame = window.requestAnimationFrame(function watch() {
      const now = triggerRef.current?.getBoundingClientRect();
      if (!now || !start || Math.abs(now.left - start.left) > 4 || (now.width === 0 && now.height === 0)) {
        setOpen(false);
        return;
      }
      frame = window.requestAnimationFrame(watch);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
    };
  }, [open, update]);
  return (
    <>
      <span
        ref={triggerRef}
        className={className}
        onPointerEnter={show}
        onPointerLeave={hide}
        onPointerDown={() => {
          if (timerRef.current) window.clearTimeout(timerRef.current);
          setOpen(false);
        }}
        onFocus={(event) => {
          // Only a move through the page by keyboard asks for the name. Focus
          // put here by a click or by code would keep it up after the pointer
          // has long gone.
          if (document.documentElement.dataset.keys !== undefined && event.target.matches(":focus-visible")) show();
        }}
        onBlur={hide}
      >
        {children}
      </span>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              id={`tooltip-${label.replace(/\W+/g, "-").toLowerCase()}`}
              role="tooltip"
              className="pointer-events-none fixed z-toast max-w-[240px] rounded-chip border border-[var(--border-default)] bg-[var(--text-primary)] px-2 py-1.5 text-micro font-medium leading-4 text-[var(--bg-primary)] shadow-[var(--shadow-lg)]"
              style={{
                left: position.left,
                top: position.top,
                transform:
                  side === "top"
                    ? "translate(-50%,-100%)"
                    : side === "right"
                      ? "translate(0,-50%)"
                      : "translate(-50%,0)",
              }}
            >
              {label}
              {shortcut ? (
                <kbd className="ml-2 font-sans text-micro font-medium opacity-60">{shortcut}</kbd>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
