"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function FloatingMenu({
  anchor,
  open,
  onClose,
  children,
  width = 250,
  maxHeight = 320,
}: {
  anchor: DOMRect | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  maxHeight?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: globalThis.PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  if (!open || !anchor || typeof document === "undefined") return null;
  const gap = 8;
  const viewportPadding = 12;
  const spaceBelow = window.innerHeight - anchor.bottom - viewportPadding;
  const placeAbove = spaceBelow < Math.min(maxHeight, 220) && anchor.top > spaceBelow;
  const left = Math.max(viewportPadding, Math.min(anchor.right - width, window.innerWidth - width - viewportPadding));
  const top = placeAbove
    ? Math.max(viewportPadding, anchor.top - Math.min(maxHeight, anchor.top - viewportPadding) - gap)
    : Math.min(anchor.bottom + gap, window.innerHeight - viewportPadding - 80);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[120] overflow-y-auto rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_18px_44px_rgba(27,20,12,0.18)]"
      style={{ left, top, width, maxHeight: placeAbove ? Math.min(maxHeight, anchor.top - viewportPadding - gap) : Math.min(maxHeight, spaceBelow) }}
      role="menu"
    >
      {children}
    </div>,
    document.body,
  );
}
