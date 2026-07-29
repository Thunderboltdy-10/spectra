import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ArtifactsShell } from "@/features/spectra/pages/artifacts-shell";

export const dynamic = "force-dynamic";

export default function ArtifactsPage() {
  return (
    <AppShell fullBleed noScroll contentClassName="!p-0 overflow-y-auto">
      <Suspense fallback={null}>
        <ArtifactsShell />
      </Suspense>
    </AppShell>
  );
}
