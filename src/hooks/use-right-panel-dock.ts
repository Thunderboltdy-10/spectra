"use client";

import { useEffect, useMemo, useState } from "react";

const MIN_DOCK_WIDTH = 320;

function shouldDock(params: { open: boolean; compact: boolean; width: number }) {
  const { open, compact, width } = params;
  if (!open || compact) return false;
  if (typeof window === "undefined") return false;
  if (window.innerWidth < 1024) return false;
  return width >= MIN_DOCK_WIDTH && window.innerHeight >= 760;
}

export function useRightPanelDock(params: {
  id: string;
  open: boolean;
  compact: boolean;
  maxWidthPx: number;
  minMainWidthPx?: number;
  reserveLeftPx?: number;
}) {
  const { open, compact, maxWidthPx, minMainWidthPx = 860, reserveLeftPx = 320 } = params;
  const [docked, setDocked] = useState(false);
  const [panelWidth, setPanelWidth] = useState(maxWidthPx);

  const computeWidth = useMemo(
    () => () => {
      const vw = window.innerWidth;
      const ratio = vw <= 1440 ? 0.3 : vw <= 1920 ? 0.34 : 0.4;
      const maxByViewport = Math.floor(vw * ratio);
      const availableAfterGuards = window.innerWidth - minMainWidthPx - reserveLeftPx;
      return Math.max(0, Math.min(maxWidthPx, maxByViewport, availableAfterGuards));
    },
    [maxWidthPx, minMainWidthPx, reserveLeftPx],
  );

  useEffect(() => {
    const update = () => {
      if (!open) {
        setDocked(false);
        setPanelWidth(maxWidthPx);
        return;
      }
      const width = computeWidth();
      const nextDocked = shouldDock({ open, compact, width });
      const nextWidth = nextDocked
        ? Math.max(MIN_DOCK_WIDTH, width)
        : Math.min(maxWidthPx, Math.floor(window.innerWidth * 0.92));

      setDocked((prev) => (prev === nextDocked ? prev : nextDocked));
      setPanelWidth((prev) => (prev === nextWidth ? prev : nextWidth));
    };

    update();
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
    };
  }, [compact, computeWidth, maxWidthPx, open]);

  return {
    docked,
    isOverlay: open && !docked,
    panelWidth,
  };
}
