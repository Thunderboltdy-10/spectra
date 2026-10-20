"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { recentCause, useLifeDeparture, useLifeEntrance, useLifeJoin, useLifeVerdict, type Verdict } from "@/features/spectra/life/use-life";

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
 * answer revealed, a result shown): the skeleton's band crosses it once as it
 * lands (LIFE.md, Arrive). Without a recent press (reopening what was already
 * shown) it is simply there. It renders nothing visible.
 */
export function LifeForm() {
  const { anchor, host } = useParent();
  const [from] = useState(recentCause);
  useLifeEntrance(host, from !== undefined);
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

/**
 * Put inside an item of a list, with what it shows as `id` (or inside a
 * table cell, with `of="tr"`): made just now, by the reader or by Spectra, it
 * lands crossed once by the skeleton's band; removed, it parts where it was
 * (LIFE.md, Create by hand, Delete). What the list opened with is simply there.
 */
export function LifeKey({ id, of, bars }: { id: string; of?: string; bars?: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const host = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const parent = anchor.current?.parentElement ?? null;
    host.current = of ? (parent?.closest<HTMLElement>(of) ?? parent) : parent;
  }, [of]);
  const figure = bars ? { bars } : {};
  useLifeJoin(host, id);
  useLifeDeparture(host, true, figure);
  return <span ref={anchor} hidden />;
}
