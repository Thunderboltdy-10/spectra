"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { registerComposerBand } from "../components/composer-safe-area";

/**
 * Shared bottom interaction layer for every workbench route.
 *
 * The stack is the `composer-dock` layer — nothing else. Callers used to pick
 * a number (220 in Workspace and Agent Library, 40 in the global workbench),
 * which is how delete confirmations ended up underneath the composer
 * (UX-13) and how two routes silently disagreed about the same dock's height
 * in the stacking order. The layering contract owns the number now.
 *
 * The band also publishes its own height as `--spectra-composer-safe-area`
 * (see `composer-safe-area.ts`), so the surfaces it floats over reserve
 * exactly enough bottom room instead of each guessing a constant.
 */
export function WorkbenchLiveStack({ children }: { children: ReactNode }) {
  const bandRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const band = bandRef.current;
    if (!band) return;
    return registerComposerBand(band);
  }, []);
  return (
    <div
      ref={bandRef}
      className="spectra-workbench-live-stack pointer-events-none absolute inset-x-0 bottom-0 z-composer-dock bg-transparent px-2 pb-4 pt-2 sm:px-5 sm:pb-5 lg:px-8"
    >
      <div className="spectra-live-stack pointer-events-none mx-auto max-w-[880px]">
        {children}
      </div>
    </div>
  );
}
