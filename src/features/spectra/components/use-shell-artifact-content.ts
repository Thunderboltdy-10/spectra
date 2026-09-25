"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SpectraArtifact, SpectraOverview } from "../data/api";
import { retainShellHydratedArtifacts, retainShellOverviewContent, revokeShellOverviewArtifact } from "./shell-artifact-content";

/** Bodies belong to open work or its pending handoff, never navigation history. */
export function useShellArtifactContent(openArtifactIds: readonly string[], pendingArtifactId?: string) {
  const [overview, setOverview] = useState<SpectraOverview | null>(null);
  const [hydratedArtifacts, setHydratedArtifacts] = useState<Record<string, SpectraArtifact>>({});
  const revokeArtifact = useCallback((artifactId: string) => {
    setHydratedArtifacts((current) => {
      if (!current[artifactId]) return current;
      const next = { ...current };
      delete next[artifactId];
      return next;
    });
    setOverview((current) => revokeShellOverviewArtifact(current, artifactId));
  }, []);
  const retentionKey = JSON.stringify([...new Set([
    ...openArtifactIds,
    ...(pendingArtifactId ? [pendingArtifactId] : []),
  ])].sort());
  const retainedIds = useMemo(() => new Set<string>(JSON.parse(retentionKey)), [retentionKey]);
  useEffect(() => {
    setHydratedArtifacts((current) => retainShellHydratedArtifacts(current, retainedIds));
    setOverview((current) => retainShellOverviewContent(current, retainedIds));
  }, [retainedIds, overview, hydratedArtifacts]);
  return { overview, setOverview, hydratedArtifacts, setHydratedArtifacts, revokeArtifact };
}
