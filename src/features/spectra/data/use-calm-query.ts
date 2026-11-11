"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import type { FunctionReference } from "convex/server";

/*
 * A run rewrites the work it edits many times a minute, and every subscription
 * that reads that work runs again each time, whether or not its answer changed.
 * Details around the document (who it's shared with, where its file lives) can
 * wait, so while a run is live they keep their last answer and read again when
 * it ends.
 */
let runLive = false;
const listeners = new Set<() => void>();

export function setRunLive(live: boolean) {
  if (runLive === live) return;
  runLive = live;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRunLive() {
  return useSyncExternalStore(subscribe, () => runLive, () => false);
}

/**
 * The query's answer, read while no run is live. `peekMs` reads again that often
 * during a run, for what the run itself may add to the page.
 */
export function useCalmQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: Query["_args"] | "skip",
  { peekMs }: { peekMs?: number } = {},
): Query["_returnType"] | undefined {
  const live = useRunLive();
  const key = args === "skip" ? "skip" : JSON.stringify(args);
  const kept = useRef<{ key: string; value: Query["_returnType"] | undefined }>({ key, value: undefined });
  if (kept.current.key !== key) kept.current = { key, value: undefined };
  const [peeking, setPeeking] = useState(false);
  // A new target has nothing kept, so it reads once even during a run.
  const paused = live && !peeking && kept.current.value !== undefined;
  const value = useQuery(query, paused || args === "skip" ? ("skip" as never) : (args as never)) as
    | Query["_returnType"]
    | undefined;
  if (value !== undefined) kept.current.value = value;

  useEffect(() => {
    if (!live || !peekMs) return;
    const timer = window.setInterval(() => setPeeking(true), peekMs);
    return () => window.clearInterval(timer);
  }, [live, peekMs]);
  useEffect(() => {
    if (peeking && value !== undefined) setPeeking(false);
  }, [peeking, value]);

  return kept.current.value;
}
