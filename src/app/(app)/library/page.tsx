import { Suspense } from "react";
import { SpectraShell } from "@/features/spectra/pages/spectra-shell";

export const dynamic = "force-dynamic";

export default function LibraryPage() {
  return (
    <Suspense
      fallback={<div className="h-full min-h-0" />}
    >
      <SpectraShell surface="library" />
    </Suspense>
  );
}
