"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/*
 * The chat page's thread column: closed when the page opens, so the
 * conversation has the room, and opened from the header when it is wanted.
 * It steps aside while a work is open beside the conversation (three columns
 * would crush all three) and comes back when the work closes. While it shows,
 * the island centres itself over the conversation rather than the whole sheet.
 */

export const THREAD_COLUMN_WIDTH = 304;

export function useThreadColumn(studioBeside: boolean) {
  const [open, setOpen] = useState(false);
  const restoreAfterStudio = useRef(false);

  const choose = (next: boolean) => {
    setOpen(next);
    restoreAfterStudio.current = false;
  };

  useEffect(() => {
    if (studioBeside && open) {
      restoreAfterStudio.current = true;
      setOpen(false);
    } else if (!studioBeside && restoreAfterStudio.current) {
      restoreAfterStudio.current = false;
      setOpen(true);
    }
    // Only the studio's arrival and departure move the column on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioBeside]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (open) root.style.setProperty("--spectra-lead-width", `${THREAD_COLUMN_WIDTH}px`);
    else root.style.removeProperty("--spectra-lead-width");
    return () => {
      root.style.removeProperty("--spectra-lead-width");
    };
  }, [open]);

  return { open, setOpen: choose };
}
