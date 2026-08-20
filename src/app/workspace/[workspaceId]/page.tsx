import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { SpectraShell } from "@/features/spectra/pages/spectra-shell";

export const dynamic = "force-dynamic";

export default async function WorkspaceByIdPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return (
    <AppShell fullBleed noScroll contentClassName="!p-0">
      <Suspense
        fallback={<div className="h-full min-h-0 bg-[var(--bg-primary)]" />}
      >
        <SpectraShell surface="workspace" initialWorkspaceId={workspaceId} />
      </Suspense>
    </AppShell>
  );
}
