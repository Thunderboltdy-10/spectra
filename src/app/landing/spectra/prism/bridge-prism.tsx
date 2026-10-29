"use client";

import { useEffect, useState, type RefObject } from "react";
import type { PrismMode } from "@/features/spectra/life/prism";
import { LivePrism } from "./live-prism";

/*
 * Spectra's prism between the laptop and Spectra: the page's live prism, the
 * same body as the icon. The scene sends things through it with `pulse`, and
 * each one turns it round while it works; a visitor can take hold of it and
 * spin it, and it goes on with its work either way.
 */

/** What the scene sends through the prism. */
export type PrismDrive = {
  /** The colour of what is passing through. */
  hue: string;
  /** Set by the prism while it is on the page. */
  listen?: () => void;
};

export const newDrive = (): PrismDrive => ({ hue: "#9a7cff" });

/** Something passes through the prism: it turns once and works while it does. */
export function pulse(drive: PrismDrive, hue: string) {
  drive.hue = hue;
  drive.listen?.();
}

export function BridgePrism({ drive, anchorRef }: { drive: PrismDrive; anchorRef?: RefObject<HTMLDivElement | null> }) {
  const [turns, setTurns] = useState(0);
  const [mode, setMode] = useState<PrismMode>("rest");

  useEffect(() => {
    let timer = 0;
    drive.listen = () => {
      setTurns((count) => count + 1);
      setMode("working");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMode("rest"), 900);
    };
    return () => {
      drive.listen = undefined;
      window.clearTimeout(timer);
    };
  }, [drive]);

  return (
    <div className="sp-bridge-prism">
      <div ref={anchorRef} className="sp-prism-core" aria-hidden />
      <LivePrism
        width="100%"
        mode={mode}
        turns={turns}
        palette="light"
        interactive
        label="Spectra's prism, between the laptop and Spectra. Drag to spin it."
      />
    </div>
  );
}
