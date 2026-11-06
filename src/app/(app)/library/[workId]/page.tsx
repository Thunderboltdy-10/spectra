import { Suspense } from "react";
import { SpectraShell } from "@/features/spectra/pages/spectra-shell";

export const dynamic = "force-dynamic";

export default async function LibraryWorkPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const { workId } = await params;
  return (
    <Suspense
      fallback={<div className="h-full min-h-0" />}
    >
      <SpectraShell surface="library" initialArtifactId={workId} />
    </Suspense>
  );
}
