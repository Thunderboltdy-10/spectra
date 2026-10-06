"use client";

import { useLayoutEffect, useRef } from "react";
import { useLifeHandover } from "@/features/spectra/life/use-life";

/**
 * Put inside something that stands in until there is content (an empty
 * state): when it goes, its dots flow into whatever takes its place
 * (LIFE.md, Hand over). It renders nothing visible, so server-rendered
 * stand-ins can carry it.
 */
export function LifeHandover({ bars }: { bars?: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const host = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    host.current = anchor.current?.parentElement ?? null;
  }, []);
  useLifeHandover(host, { bars });
  return <span ref={anchor} hidden />;
}
