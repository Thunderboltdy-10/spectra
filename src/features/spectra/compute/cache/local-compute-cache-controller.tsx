"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { spectraBus } from "../../events";
import { disposeReusableBuildWorker } from "../build";
import { disposeReusablePythonWorker } from "../../code/python-runtime";

export function LocalComputeCacheController() {
  useEffect(
    () =>
      spectraBus.handle("settings.clearLocalComputeCache", () => {
        disposeReusableBuildWorker();
        disposeReusablePythonWorker();
        for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
          const key = window.localStorage.key(index);
          if (key?.startsWith("spectra:compute:")) window.localStorage.removeItem(key);
        }
        if ("caches" in window) {
          void caches.keys().then((keys) =>
            Promise.all(
              keys
                .filter((key) => key.startsWith("spectra-compute-"))
                .map((key) => caches.delete(key)),
            ),
          );
        }
        toast.success("Local compute cache cleared. Your work and original files were not changed.");
      }),
    [],
  );
  return null;
}
