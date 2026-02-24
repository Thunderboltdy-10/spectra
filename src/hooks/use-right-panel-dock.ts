"use client";

import { useEffect, useMemo, useState } from "react";

const MIN_DOCK_WIDTH = 360;

function shouldDock(params: { open: boolean; compact: boolean; width: number }) {
  const { open, compact, width } = params;
  if (!open || compact) return false;
  if (typeof window === "undefined") return false;
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
  const { open, compact, maxWidthPx, minMainWidthPx = 760, reserveLeftPx = 320 } = params;
  const [docked, setDocked] = useState(false);
  const [panelWidth, setPanelWidth] = useState(maxWidthPx);

  const computeWidth = useMemo(
    () => () => {
      const maxByViewport = Math.floor(window.innerWidth * 0.44);
      const availableAfterGuards = window.innerWidth - minMainWidthPx - reserveLeftPx;
      return Math.max(0, Math.min(maxWidthPx, maxByViewport, availableAfterGuards));
    },
    [maxWidthPx, minMainWidthPx, reserveLeftPx],
  );

  useEffect(() => {
    const update = () => {
      const width = computeWidth();
      const nextDocked = shouldDock({ open, compact, width });
      setDocked(nextDocked);
      setPanelWidth(
        nextDocked
          ? Math.max(MIN_DOCK_WIDTH, width)
          : Math.min(maxWidthPx, Math.floor(window.innerWidth * 0.92)),
      );
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
