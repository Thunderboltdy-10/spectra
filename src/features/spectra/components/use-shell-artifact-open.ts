"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSpectraArtifactForDeepLink, type SpectraArtifact } from "../data/api";
import { createLatestStudioLoad } from "./latest-studio-load";

export type ShellArtifactOpen = {
  artifact: SpectraArtifact;
  historyMode: "push" | "replace" | "none";
  mode: "split" | "tab";
  preserveFollow: boolean;
};

/** A single selected open, with no cache of completed bodies. */
export function useShellArtifactOpen(readArtifact = getSpectraArtifactForDeepLink) {
  const [pending, setPending] = useState<ShellArtifactOpen | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const generation = useRef(0);
  const requestedId = useRef<string | null>(null);
  const [loader] = useState(() => createLatestStudioLoad(
    (id, signal) => readArtifact(id, { signal }).then((result) => result.artifact),
  ));
  const cancel = useCallback((artifactId?: string) => {
    if (artifactId && requestedId.current !== artifactId) return false;
    generation.current += 1;
    requestedId.current = null;
    loader.cancel();
    setPending(null);
    setLoadingId(null);
    return true;
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
    mountedArtifact?: SpectraArtifact,
  ) => {
    const request = ++generation.current;
    requestedId.current = artifactId;
    setPending(null);
    // Focusing or changing the presentation of a mounted studio does not
    // reopen it. The caller must not pass a body from a closed-work cache.
    if (mountedArtifact?._id === artifactId && mountedArtifact.content !== undefined &&
      mountedArtifact.accessLevel !== null && mountedArtifact.status !== "deleted") {
      loader.cancel();
      setLoadingId(null);
      setPending({ artifact: mountedArtifact, historyMode, mode, preserveFollow });
      return;
    }
    setLoadingId(artifactId);
    let artifact: SpectraArtifact | null;
    try {
      artifact = await loader.load(artifactId);
    } catch (error) {
      if (request !== generation.current) return;
      requestedId.current = null;
      setLoadingId(null);
      throw error;
    }
    if (request !== generation.current) return;
    setLoadingId(null);
    if (!artifact || artifact.accessLevel === null || artifact.status === "deleted") {
      requestedId.current = null;
      throw new Error("That work is not available.");
    }
    // Undefined is a summary row; null and an empty body are valid detail.
    if (artifact.content === undefined) {
      requestedId.current = null;
      throw new Error("Artifact detail is unavailable.");
    }
    setPending({ artifact, historyMode, mode, preserveFollow });
  }, [loader]);
  return { pending, loadingId, open, cancel };
}
