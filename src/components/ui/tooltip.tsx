"use client";

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";

export function Tooltip({ label, children, side = "top" }: { label: string; children: ReactElement; side?: "top" | "bottom" }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const update = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ left: rect.left + rect.width / 2, top: side === "top" ? rect.top - 8 : rect.bottom + 8 });
  }, [side]);
  const show = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { update(); setOpen(true); }, 260);
  }, [update]);
  const hide = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setOpen(false), 140);
  }, []);
  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);
  useEffect(() => {
    if (!open) return;
    const refresh = () => update();
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    return () => { window.removeEventListener("scroll", refresh, true); window.removeEventListener("resize", refresh); };
  }, [open, update]);
  return <><span ref={triggerRef} className="inline-flex" onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide}>{children}</span>{open && typeof document !== "undefined" ? createPortal(<div id={`tooltip-${label.replace(/\W+/g, "-").toLowerCase()}`} role="tooltip" onPointerEnter={() => { if (timerRef.current) window.clearTimeout(timerRef.current); }} onPointerLeave={hide} className="pointer-events-auto fixed z-[1000] max-w-[240px] -translate-x-1/2 rounded-[7px] border border-[var(--border-default)] bg-[var(--text-primary)] px-2 py-1.5 text-micro font-medium leading-4 text-[var(--bg-primary)] shadow-[0_10px_30px_rgba(20,15,10,.22)]" style={{ left: position.left, top: position.top, transform: side === "top" ? "translate(-50%,-100%)" : "translate(-50%,0)" }}>{label}</div>, document.body) : null}</>;
}
