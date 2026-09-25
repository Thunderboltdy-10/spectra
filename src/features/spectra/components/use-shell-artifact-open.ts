"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSpectraArtifact, type SpectraArtifact } from "../data/api";
import { createLatestStudioLoad } from "./latest-studio-load";

export type ShellArtifactOpen = {
  artifact: SpectraArtifact;
  historyMode: "push" | "replace" | "none";
  mode: "split" | "tab";
  preserveFollow: boolean;
};

/** A single selected open, with no cache of completed bodies. */
export function useShellArtifactOpen() {
  const [pending, setPending] = useState<ShellArtifactOpen | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const generation = useRef(0);
  const [loader] = useState(() => createLatestStudioLoad(
    (id, signal) => getSpectraArtifact(id, { signal }).then((result) => result.artifact),
  ));
  const cancel = useCallback(() => {
    generation.current += 1;
    loader.cancel();
    setPending(null);
    setLoadingId(null);
  }, [loader]);
  useEffect(() => () => {
    generation.current += 1;
    loader.cancel();
  }, [loader]);
  const open = useCallback(async (
    artifactId: string,
    historyMode: ShellArtifactOpen["historyMode"] = "push",
    mode: ShellArtifactOpen["mode"] = "split",
    preserveFollow = false,
  ) => {
    const request = ++generation.current;
    setPending(null);
    setLoadingId(artifactId);
    let artifact: SpectraArtifact | null;
    try {
      artifact = await loader.load(artifactId);
    } catch (error) {
      if (request !== generation.current) return;
      setLoadingId(null);
      throw error;
    }
    if (request !== generation.current || !artifact) return;
    setLoadingId(null);
    // Undefined is a summary row; null and an empty body are valid detail.
    if (artifact.content === undefined) throw new Error("Artifact detail is unavailable.");
    if (artifact.accessLevel === null || artifact.status === "deleted") throw new Error("That work is not available.");
    setPending({ artifact, historyMode, mode, preserveFollow });
  }, [loader]);
  return { pending, loadingId, open, cancel };
}
