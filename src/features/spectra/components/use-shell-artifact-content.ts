"use client";

import { useEffect, useMemo, useState } from "react";
import type { SpectraArtifact, SpectraOverview } from "../data/api";
import { retainShellHydratedArtifacts, retainShellOverviewContent } from "./shell-artifact-content";

/** Bodies belong to open work or its pending handoff, never navigation history. */
export function useShellArtifactContent(openArtifactIds: readonly string[], pendingArtifactId?: string) {
  const [overview, setOverview] = useState<SpectraOverview | null>(null);
  const [hydratedArtifacts, setHydratedArtifacts] = useState<Record<string, SpectraArtifact>>({});
  const retentionKey = JSON.stringify([...new Set([
    ...openArtifactIds,
    ...(pendingArtifactId ? [pendingArtifactId] : []),
  ])].sort());
  const retainedIds = useMemo(() => new Set<string>(JSON.parse(retentionKey)), [retentionKey]);
  useEffect(() => {
    setHydratedArtifacts((current) => retainShellHydratedArtifacts(current, retainedIds));
    setOverview((current) => retainShellOverviewContent(current, retainedIds));
  }, [retainedIds, overview, hydratedArtifacts]);
  return { overview, setOverview, hydratedArtifacts, setHydratedArtifacts };
}
