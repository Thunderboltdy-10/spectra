"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { recentCause, useLifeEntrance, useLifeVerdict, type Verdict } from "@/features/spectra/life/use-life";

/** The element this anchor sits in, known before the hooks that need it run. */
function useParent() {
  const anchor = useRef<HTMLSpanElement>(null);
  const host = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    host.current = anchor.current?.parentElement ?? null;
  }, []);
  return { anchor, host };
}

/**
 * Put inside something that appears because of what the reader just did (an
 * answer revealed, a result shown): it forms out of the field from that press
 * (LIFE.md, Arrive). Without a recent press (reopening what was already
 * shown) it is simply there. It renders nothing visible.
 */
export function LifeForm({ bars }: { bars?: string }) {
  const { anchor, host } = useParent();
  const [from] = useState(recentCause);
  useLifeEntrance(host, { bars, from, enabled: from !== undefined });
  return <span ref={anchor} hidden />;
}

/**
 * Put inside what a verdict is given on (a checked answer, a graded card):
 * when one arrives, the paper answers in its colour (LIFE.md, Verdict).
 */
export function LifeVerdict({ verdict, immediate }: { verdict: Verdict | null | undefined; immediate?: boolean }) {
  const { anchor, host } = useParent();
  useLifeVerdict(host, verdict, { immediate });
  return <span ref={anchor} hidden />;
}
