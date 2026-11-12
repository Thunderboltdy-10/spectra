"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/*
 * What this person's computer offers: Codex and Claude Code, installed, logged
 * in, which models. Asked once per page and again when they come back to the
 * window, since logging in happens in a terminal.
 */

export type AgentProviderStatus = {
  state: "ready" | "signed-out" | "not-installed" | "no-bridge" | "error";
  account?: string;
  plan?: string;
  models: Array<{ id: string; label: string }>;
};

export type AgentRuntimeStatus = { codex: AgentProviderStatus; claude: AgentProviderStatus };

const STALE_MS = 60_000;

let status: AgentRuntimeStatus | null = null;
let fetchedAt = 0;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function refresh(force = false) {
  if (pending) return pending;
  if (!force && status && Date.now() - fetchedAt < STALE_MS) return Promise.resolve();
  pending = fetch("/api/spectra/agent-runtime", { cache: "no-store" })
    .then((response) => (response.ok ? (response.json() as Promise<AgentRuntimeStatus>) : null))
    .catch(() => null)
    .then((next) => {
      if (next) status = next;
      fetchedAt = Date.now();
      pending = null;
      for (const listener of listeners) listener();
    });
  return pending;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Bridge came or went: what this computer offers may have changed with it. */
export function recheckAgentRuntime() {
  return refresh(true);
}

export function useAgentRuntime() {
  const current = useSyncExternalStore(subscribe, () => status, () => null);
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  return { status: current, recheck: useCallback(() => refresh(true), []) };
}

/** Re-asks when the last answer is older than a minute: the composer calls this as it takes focus. */
export function recheckAgentRuntimeIfStale() {
  return refresh();
}

let warmedAt = 0;

/**
 * Start Codex as the composer takes focus, when this computer said it is
 * ready: the first turn then finds it connected. At most once a minute.
 */
export function warmAgentRuntime(runtime: string) {
  if (runtime !== "codex" || status?.codex.state !== "ready" || Date.now() - warmedAt < STALE_MS) return;
  warmedAt = Date.now();
  void fetch("/api/spectra/agent-runtime", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runtime }),
  }).catch(() => undefined);
}

/**
 * The runtimes this computer last said it can't reach, for a send to start at
 * the next in the person's order. Only a fresh answer counts; an unknown or
 * stale one says nothing and the run finds out itself.
 */
export function knownUnreachableRuntimes(): Array<{ runtime: "codex" | "claude"; state: Exclude<AgentProviderStatus["state"], "ready"> }> {
  if (!status || Date.now() - fetchedAt > STALE_MS) return [];
  return (["codex", "claude"] as const).flatMap((runtime) => {
    const state = status?.[runtime]?.state;
    return state && state !== "ready" ? [{ runtime, state }] : [];
  });
}

export const PROVIDER_LABEL = { codex: "Codex", claude: "Claude Code" } as const;

/** What to tell someone about a provider that isn't ready, in the words they need. */
export function providerProblem(provider: keyof typeof PROVIDER_LABEL, state: AgentProviderStatus["state"]) {
  const name = PROVIDER_LABEL[provider];
  const login = provider === "codex" ? "codex login" : "claude auth login";
  switch (state) {
    case "signed-out":
      return `Not logged in on this computer. Log in here, or run ${login} in a terminal.`;
    case "not-installed":
      return `${name} isn't installed on this computer.`;
    case "no-bridge":
      return "Spectra Bridge isn't running on this computer.";
    case "error":
      return `${name} didn't answer. Try again in a moment.`;
    default:
      return null;
  }
}
