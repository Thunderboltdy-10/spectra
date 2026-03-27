"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type PlannerItem = {
  _id: string;
  workstreamId?: string;
  title: string;
  description?: string;
  type: "deadline" | "milestone" | "goal" | "reminder";
  priority: "low" | "medium" | "high";
  status: "pending" | "in_progress" | "completed" | "cancelled";
  dueAt?: number;
  completedAt?: number;
  sourceType: "user_manual" | "ai_suggested" | "managebac_sync";
  createdAt: number;
  updatedAt: number;
};

export function usePlannerData(workstreamId?: string) {
  const [plannerItems, setPlannerItems] = useState<PlannerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPlannerItems = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const qs = new URLSearchParams();
      if (workstreamId) qs.set("workstreamId", workstreamId);
      qs.set("limit", "100");

      const response = await fetch(`/api/planner?${qs.toString()}`, {
        signal: ac.signal,
      });
      if (!response.ok) throw new Error("Failed to load planner items");
      const data = (await response.json()) as { plannerItems: PlannerItem[] };
      setPlannerItems(data.plannerItems ?? []);
      setError(null);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Failed to load planner items");
      }
    } finally {
      setLoading(false);
    }
  }, [workstreamId]);

  useEffect(() => {
    void fetchPlannerItems();
    return () => abortRef.current?.abort();
  }, [fetchPlannerItems]);

  return {
    plannerItems,
    loading,
    error,
    refresh: fetchPlannerItems,
  };
}
