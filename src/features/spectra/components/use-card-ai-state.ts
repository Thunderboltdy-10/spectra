"use client";

import { useEffect, useState } from "react";

/*
 * What Spectra is doing to a card's work, as the card should show it now.
 *
 * The stored state outlives the moment it describes: Convex can leave a
 * working state behind after a run failed or settled, and an edit is news for
 * a minute and a half, not forever. So a working state counts only while the
 * work changed recently, an edit only until its flash expires, and the card
 * re-renders itself at the moment either stops being true.
 */

export type CardAiState = "generated" | "edited" | "creating" | "updating" | "failed";

const WORKING_WINDOW_MS = 45_000;
const AI_EDITED_FLASH_FALLBACK_MS = 90_000;

export function resolveCardAiState(
  aiState: CardAiState | undefined,
  updatedAt: number | undefined,
  now: number,
  expiresAt?: number,
): CardAiState | undefined {
  if (aiState === "failed") return aiState;
  if (aiState === "creating" || aiState === "updating") {
    const fresh = typeof updatedAt === "number" && now - updatedAt < WORKING_WINDOW_MS;
    return fresh ? aiState : undefined;
  }
  if (aiState === "edited" || aiState === "generated") {
    const expiry = expiresAt ?? (updatedAt ? updatedAt + AI_EDITED_FLASH_FALLBACK_MS : undefined);
    if (expiry && expiry > now) return "edited";
    return undefined;
  }
  return aiState;
}

/** When the resolved state next changes on its own, if it will. */
function nextChange(resolved: CardAiState | undefined, updatedAt: number | undefined, now: number, expiresAt?: number) {
  if (resolved === "creating" || resolved === "updating") return (updatedAt ?? now) + WORKING_WINDOW_MS;
  if (resolved === "edited" || resolved === "generated")
    return expiresAt ?? (updatedAt ? updatedAt + AI_EDITED_FLASH_FALLBACK_MS : undefined);
  return undefined;
}

/**
 * The card's live AI state and the clock it was read at. The clock is 0 on the
 * server and the first client render, so both agree; it starts on mount.
 */
export function useCardAiState(aiState: CardAiState | undefined, updatedAt: number | undefined, expiresAt?: number) {
  const [clock, setClock] = useState(0);
  useEffect(() => setClock(Date.now()), []);
  const resolved = resolveCardAiState(aiState, updatedAt, clock, expiresAt);

  useEffect(() => {
    if (!clock) return;
    const expiry = nextChange(resolved, updatedAt, clock, expiresAt);
    if (!expiry || expiry <= clock) return;
    const timer = window.setTimeout(() => setClock(Date.now()), Math.max(16, expiry - Date.now() + 24));
    return () => window.clearTimeout(timer);
  }, [clock, resolved, updatedAt, expiresAt]);

  return { state: resolved, clock };
}
