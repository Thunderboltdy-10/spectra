import { AppShell } from "@/components/layout/app-shell";
import { WorkspaceShell } from "@/features/spectra/pages/workspace-shell";

export const dynamic = "force-dynamic";

export default async function WorkspaceByIdPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  return <AppShell fullBleed noScroll contentClassName="!p-0"><WorkspaceShell initialWorkspaceId={workspaceId} /></AppShell>;
}
