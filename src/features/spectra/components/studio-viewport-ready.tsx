"use client";

import { createContext, useContext, useEffect, type ComponentType } from "react";
import { acknowledgeViewportReady } from "../viewport-readiness";

export const StudioViewportContext = createContext<{
  artifactId: string;
  onReady: (ready: boolean) => void;
} | null>(null);

/** Viewport readiness only: this says nothing about collaboration or saves. */
export function useStudioViewportReady(ready = true) {
  const context = useContext(StudioViewportContext);
  useEffect(() => {
    if (!context || !ready) return;
    const frame = requestAnimationFrame(() => {
      context.onReady(true);
      acknowledgeViewportReady({ targetId: context.artifactId, view: "artifact" });
    });
    return () => {
      cancelAnimationFrame(frame);
      context.onReady(false);
    };
  }, [context, ready]);
}

/** Loaded with the selected studio, so its effect cannot run in the fallback. */
export function withStudioViewportReady<Props extends object>(Studio: ComponentType<Props>) {
  function ReadyStudio(props: Props) {
    useStudioViewportReady();
    return <Studio {...props} />;
  }
  return ReadyStudio;
}
