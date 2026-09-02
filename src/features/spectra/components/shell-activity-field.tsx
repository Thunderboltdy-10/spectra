"use client";

/**
 * The shell's ambient activity field.
 *
 * One stage-scale `SurfaceField` behind a whole surface (chat, workspace,
 * library). It is not decoration: the only influence it carries is the live
 * run exchange — while Spectra is working, the field wakes low and central,
 * where the composer and the live dock already focus attention; a failed run
 * reads as a small fault in the same place. Idle surfaces show the resting
 * grain and nothing else.
 */

import { useMemo } from "react";
import {
  SurfaceField,
  type FieldInfluence,
} from "../field/surface-field";
import type { SpectraLiveExchange } from "../ai/use-spectra-run";

export function runFieldInfluences(
  liveExchange: SpectraLiveExchange | null | undefined,
): readonly FieldInfluence[] {
  if (!liveExchange) return [];
  if (liveExchange.status === "failed") {
    return [
      {
        id: "run",
        x: 0.5,
        y: 0.9,
        radius: 0.3,
        strength: 0.7,
        hue: "var(--danger)",
        state: "failure",
      },
    ];
  }
  const working = liveExchange.steps.some((step) => step.status === "running");
  return [
    {
      id: "run",
      x: 0.5,
      y: 0.92,
      radius: 0.34,
      strength: 0.85,
      hue: "var(--brand-primary)",
      state: working ? "typing" : "active",
    },
  ];
}

export function ShellActivityField({
  liveExchange,
  className,
}: {
  liveExchange: SpectraLiveExchange | null | undefined;
  className?: string;
}) {
  const influences = useMemo(
    () => runFieldInfluences(liveExchange),
    [liveExchange],
  );
  return (
    <SurfaceField
      influences={influences}
      scale="stage"
      grain="wave"
      depth
      behind
      className={className}
    />
  );
}
