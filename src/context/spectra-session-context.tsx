"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type LocalThreadArtifact = {
  runId: string;
  title: string;
  createdAt: number;
  messages: Array<{ id: string; role: "user" | "assistant"; content: string; runId?: string; createdAt: number }>;
};

type SpectraSessionValue = {
  localThreads: LocalThreadArtifact[];
  activeLocalThreadRunId: string | null;
  openLocalThread: (runId: string, title: string) => void;
  activateLocalThread: (runId: string) => void;
  closeLocalThread: (runId: string) => void;
  appendLocalExchange: (rootRunId: string, prompt: string, response: string, runId?: string) => void;
  clearActivePanel: () => void;
};

const SpectraSessionContext = createContext<SpectraSessionValue | null>(null);
const STORAGE_KEY = "spectra.session.local-thread-artifacts.v1";

export function SpectraSessionProvider({ children }: { children: React.ReactNode }) {
  const [localThreads, setLocalThreads] = useState<LocalThreadArtifact[]>([]);
  const [activeLocalThreadRunId, setActiveLocalThreadRunId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "[]") as LocalThreadArtifact[];
      setLocalThreads(parsed.filter((item) => item && typeof item.runId === "string" && typeof item.title === "string").slice(-20));
    } catch { window.sessionStorage.removeItem(STORAGE_KEY); }
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(localThreads));
  }, [localThreads]);

  const openLocalThread = useCallback((runId: string, title: string) => {
    setLocalThreads((current) => current.some((item) => item.runId === runId) ? current : [...current, { runId, title: title.trim().slice(0, 64) || "Conversation", createdAt: Date.now(), messages: [] }].slice(-20));
    setActiveLocalThreadRunId(runId);
  }, []);
  const activateLocalThread = useCallback((runId: string) => setActiveLocalThreadRunId(runId), []);
  const closeLocalThread = useCallback((runId: string) => {
    setLocalThreads((current) => current.filter((item) => item.runId !== runId));
    setActiveLocalThreadRunId((current) => current === runId ? null : current);
  }, []);
  const clearActivePanel = useCallback(() => setActiveLocalThreadRunId(null), []);
  const appendLocalExchange = useCallback((rootRunId: string, prompt: string, response: string, childRunId?: string) => {
    const now = Date.now();
    setLocalThreads((current) => current.map((thread) => thread.runId === rootRunId ? { ...thread, messages: [...(thread.messages ?? []), { id: `local-user:${childRunId ?? now}`, role: "user" as const, content: prompt, runId: childRunId, createdAt: now }, { id: `local-assistant:${childRunId ?? now}`, role: "assistant" as const, content: response, runId: childRunId, createdAt: now + 1 }] } : thread));
  }, []);

  const value = useMemo(() => ({ localThreads, activeLocalThreadRunId, openLocalThread, activateLocalThread, closeLocalThread, appendLocalExchange, clearActivePanel }), [activeLocalThreadRunId, activateLocalThread, appendLocalExchange, clearActivePanel, closeLocalThread, localThreads, openLocalThread]);
  return <SpectraSessionContext.Provider value={value}>{children}</SpectraSessionContext.Provider>;
}

export function useSpectraSession() {
  const value = useContext(SpectraSessionContext);
  if (!value) throw new Error("useSpectraSession must be used within SpectraSessionProvider");
  return value;
}
