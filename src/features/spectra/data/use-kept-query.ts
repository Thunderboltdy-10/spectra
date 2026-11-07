"use client";

import { useEffect } from "react";
import { useQuery as useConvexQuery, type ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";

/*
 * Leaving a page drops its subscriptions, and coming back reads everything again.
 * This holds each subscription for a while after its page closes, so going back
 * shows the answer at once and the server isn't asked for it twice.
 */
const KEEP_MS = 90_000;
const MAX_IDLE = 40;

type Kept = { refs: number; stop: () => void; timer: ReturnType<typeof setTimeout> | null };
const kept = new Map<string, Kept>();
let client: ConvexReactClient | null = null;

export function setKeptQueryClient(next: ConvexReactClient | null) {
  client = next;
}

function hold(key: string, query: FunctionReference<"query">, args: Record<string, unknown>) {
  let entry = kept.get(key);
  if (!entry) {
    if (!client) return null;
    entry = { refs: 0, stop: client.watchQuery(query, args).onUpdate(() => undefined), timer: null };
    kept.set(key, entry);
  }
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  entry.refs += 1;
  return entry;
}

function release(key: string, entry: Kept) {
  entry.refs -= 1;
  if (entry.refs > 0) return;
  entry.timer = setTimeout(() => {
    kept.delete(key);
    entry.stop();
  }, KEEP_MS);
  const idle = [...kept].filter(([, other]) => other.refs === 0);
  for (const [oldestKey, oldest] of idle.slice(0, Math.max(0, idle.length - MAX_IDLE))) {
    if (oldest.timer) clearTimeout(oldest.timer);
    kept.delete(oldestKey);
    oldest.stop();
  }
}

function keyOf(query: unknown, args: unknown) {
  if (!client || args === "skip") return null;
  try {
    return JSON.stringify([getFunctionName(query as FunctionReference<"query">), args ?? {}]);
  } catch {
    return null;
  }
}

/** convex/react's useQuery, with the answer kept after the page closes. */
export const useQuery = ((query: FunctionReference<"query">, ...rest: unknown[]) => {
  const value = (useConvexQuery as (...args: unknown[]) => unknown)(query, ...rest);
  const args = rest[0];
  const key = keyOf(query, args);
  useEffect(() => {
    if (!key) return;
    const entry = hold(key, query, (args ?? {}) as Record<string, unknown>);
    return () => {
      if (entry) release(key, entry);
    };
    // The key is the query and its arguments.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return value;
}) as typeof useConvexQuery;
