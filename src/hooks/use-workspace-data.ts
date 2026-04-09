"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Workstream = {
  _id: string;
  type: "subject" | "project" | "general";
  title: string;
  description?: string;
  emoji?: string;
  color?: string;
  status: "active" | "completed" | "archived";
  canvasX?: number;
  canvasY?: number;
  canvasWidth?: number;
  canvasHeight?: number;
  subjectCode?: string;
  linkedAgentId?: string;
  linkedPackId?: string;
  defaultMode?: string;
  artifactCount?: number;
  threadCount?: number;
  lastActivityAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
};

export function useWorkspaceData() {
  const [workstreams, setWorkstreams] = useState<Workstream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const parseApiError = useCallback(
    async (res: Response, fallback: string) => {
      try {
        const payload = (await res.json()) as {
          error?: { message?: string };
          message?: string;
        };
        const message = payload.error?.message ?? payload.message;
        return message && message.trim().length > 0 ? message : fallback;
      } catch {
        return fallback;
      }
    },
    [],
  );

  const fetchWorkstreams = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch("/api/workstreams", { signal: ac.signal });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to load workstreams"));
      }
      const data = (await res.json()) as { workstreams: Workstream[] };
      setWorkstreams(data.workstreams ?? []);
      setError(null);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, [parseApiError]);

  useEffect(() => {
    void fetchWorkstreams();
    return () => abortRef.current?.abort();
  }, [fetchWorkstreams]);

  const createWorkstream = useCallback(
    async (data: {
      type: string;
      title: string;
      description?: string;
      emoji?: string;
      color?: string;
      canvasX?: number;
      canvasY?: number;
    }) => {
      const res = await fetch("/api/workspace-orchestration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "createWorkstream", ...data }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to create workstream"));
      }
      const result = (await res.json()) as { workstreamId?: string };
      if (!result.workstreamId) throw new Error("Failed to create workstream");
      await fetchWorkstreams();
      return result.workstreamId;
    },
    [fetchWorkstreams, parseApiError],
  );

  const updateWorkstream = useCallback(
    async (
      workstreamId: string,
      data: Partial<Omit<Workstream, "_id" | "createdAt" | "updatedAt">>,
    ) => {
      const res = await fetch("/api/workstreams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", workstreamId, ...data }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to update workstream"));
      }
      await fetchWorkstreams();
    },
    [fetchWorkstreams, parseApiError],
  );

  const deleteWorkstream = useCallback(
    async (workstreamId: string) => {
      const res = await fetch("/api/workstreams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", workstreamId }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to delete workstream"));
      }
      await fetchWorkstreams();
    },
    [fetchWorkstreams, parseApiError],
  );

  return {
    workstreams,
    loading,
    error,
    refresh: fetchWorkstreams,
    createWorkstream,
    updateWorkstream,
    deleteWorkstream,
  };
}
