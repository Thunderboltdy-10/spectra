"use client";

import { useEffect } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { usePathname } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import { syncSpectraManageBacOnLogin } from "../data/api";

/** Membership becomes available after accepting an invite, even without a reload. */
export function SchoolLoginSync() {
  const { isAuthenticated } = useConvexAuth();
  const membership = useQuery(api.catalogGraph.identity, isAuthenticated ? {} : "skip");
  const setup = useQuery(api.managebac.onboardingStatus, isAuthenticated ? {} : "skip");
  const status = useQuery(api.school.syncStatus, isAuthenticated && membership ? {} : "skip");
  const pathname = usePathname();
  const accountId = membership?.accountId;
  const schoolId = membership?.schoolId;
  const phase = setup?.phase;
  const ready = status?.connection.state === "connected" || status?.connection.state === "degraded" ||
    status?.connection.problem?.code === "INTEGRATION_IDENTITY_REQUIRED";
  useEffect(() => {
    if (!accountId || !schoolId || !ready || !phase || phase === "choose_classes" || phase === "ready") return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const attempt = async () => {
      let nextAttemptAt: number | undefined;
      try {
        const result = await syncSpectraManageBacOnLogin();
        nextAttemptAt = result.nextAttemptAt;
        if (!stopped && !result.skipped) {
          if (!result.queued.length && result.jobs.length && result.jobs.every((job) => !job.errorCode && !job.suspended && ["completed", "awaiting_review"].includes((job.completion as { status?: string } | undefined)?.status ?? ""))) nextAttemptAt = undefined;
        }
      } catch {
        nextAttemptAt = Date.now() + 5 * 60_000;
      }
      if (!stopped && nextAttemptAt) retry = setTimeout(() => void attempt(), Math.max(5_000, nextAttemptAt - Date.now()));
    };
    void attempt();
    return () => { stopped = true; if (retry) clearTimeout(retry); };
  }, [accountId, schoolId, ready, pathname, phase]);
  return null;
}
