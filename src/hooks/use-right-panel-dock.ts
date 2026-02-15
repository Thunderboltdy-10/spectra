"use client";

import { useEffect, useMemo, useState } from "react";

const panelWidths = new Map<string, number>();

function applyDockSpace() {
  if (typeof document === "undefined") return;
  const maxWidth = Math.max(0, ...Array.from(panelWidths.values()));
  if (maxWidth > 0) {
    document.body.classList.add("right-panel-docked");
    document.documentElement.style.setProperty("--right-panel-space", `${Math.round(maxWidth)}px`);
  } else {
    document.body.classList.remove("right-panel-docked");
    document.documentElement.style.removeProperty("--right-panel-space");
  }
}

function shouldDock(open: boolean, compact: boolean) {
  if (!open || compact) return false;
  if (typeof window === "undefined") return false;
  return window.innerWidth >= 1280 && window.innerHeight >= 760;
}

export function useRightPanelDock(params: {
  id: string;
  open: boolean;
  compact: boolean;
  maxWidthPx: number;
}) {
  const { id, open, compact, maxWidthPx } = params;
  const [docked, setDocked] = useState(false);

  const computeWidth = useMemo(
    () => () => Math.min(window.innerWidth * 0.92, maxWidthPx),
    [maxWidthPx],
  );

  useEffect(() => {
    const update = () => {
      const nextDocked = shouldDock(open, compact);
      setDocked(nextDocked);
      if (nextDocked) {
        panelWidths.set(id, computeWidth());
      } else {
        panelWidths.delete(id);
      }
      applyDockSpace();
    };

    update();
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      panelWidths.delete(id);
      applyDockSpace();
    };
  }, [compact, computeWidth, id, open]);

  return docked;
}
