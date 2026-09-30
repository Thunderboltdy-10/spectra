"use client";

import { useEffect } from "react";
import { spectraBus } from "../events";
import type { createShellArtifactAccess } from "./shell-artifact-access";

/** A null reactive metadata result is unavailable; undefined is still loading. */
export function useWorkAvailability(workId: string, metadata: object | null | undefined) {
  const unavailable = metadata === null;
  useEffect(() => {
    if (unavailable) spectraBus.emit("work.unavailable", { workId });
  }, [unavailable, workId]);
}

/** Feed authoritative reactive denial into the shell's existing eviction ordering. */
export function subscribeShellWorkAvailability(access: Pick<ReturnType<typeof createShellArtifactAccess>, "observeUnavailable">) {
  return spectraBus.on("work.unavailable", ({ workId }) => {
    access.observeUnavailable(workId);
  });
}
