"use client";

import type { ComponentProps, ReactNode } from "react";
import { LiveDock } from "../components/live-dock";
import { WorkbenchLiveStack } from "./workbench-live-stack";

/**
 * The single dock/composer frame shared by Workspace and Library. Route shells
 * provide their contextual actions, but neither route owns positioning,
 * attachment hosting, or the Live Dock mount anymore.
 */
export function WorkbenchDockShell({
  zIndex,
  attachmentsHostRef,
  dock,
  selection,
  composer,
}: {
  zIndex: number;
  attachmentsHostRef: (node: HTMLDivElement | null) => void;
  dock: ComponentProps<typeof LiveDock>;
  selection?: ReactNode;
  composer: ReactNode;
}) {
  return (
    <WorkbenchLiveStack zIndex={zIndex}>
      <div ref={attachmentsHostRef} />
      <LiveDock {...dock} />
      {selection}
      {composer}
    </WorkbenchLiveStack>
  );
}
