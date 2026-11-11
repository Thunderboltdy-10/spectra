"use client";

import { useEffect } from "react";
import { toast } from "@/components/ui/toast";
import { spectraBus } from "../../events";
import type { SpectraCommandOutcome } from "../../events/contracts";
import { disposeReusablePythonWorker } from "../../code/python-runtime";

export function LocalComputeCacheController() {
  useEffect(
    () =>
      spectraBus.handle("settings.clearLocalComputeCache", async () => {
        disposeReusablePythonWorker();
        for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
          const key = window.localStorage.key(index);
          if (key?.startsWith("spectra:compute:")) window.localStorage.removeItem(key);
        }
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(
            keys
              .filter((key) => key.startsWith("spectra-compute-"))
              .map((key) => caches.delete(key)),
          );
        }
        toast.success("Local compute cache cleared. Your artifacts and original files were not changed.");
        return {
          status: "completed",
          message: "Local compute cache cleared. Your artifacts and original files were not changed.",
        } satisfies SpectraCommandOutcome;
      }),
    [],
  );
  return null;
}
