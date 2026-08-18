import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ArtifactsShell } from "@/features/spectra/pages/artifacts-shell";

export const dynamic = "force-dynamic";

export default async function LibraryWorkPage({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  return (
    <AppShell fullBleed noScroll contentClassName="!p-0 overflow-y-auto">
      <Suspense fallback={<div className="h-full min-h-0 bg-[var(--bg-primary)]" />}>
        <ArtifactsShell initialArtifactId={workId} />
      </Suspense>
    </AppShell>
  );
}
