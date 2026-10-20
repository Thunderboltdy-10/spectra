import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { SpectraShell } from "@/features/spectra/pages/spectra-shell";

export const dynamic = "force-dynamic";

export default function LibraryPage() {
  return (
    <AppShell fullBleed noScroll workTabs contentClassName="!p-0">
      <Suspense
        fallback={<div className="h-full min-h-0" />}
      >
        <SpectraShell surface="library" />
      </Suspense>
    </AppShell>
  );
}
