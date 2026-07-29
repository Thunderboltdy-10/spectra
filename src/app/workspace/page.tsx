import { AppShell } from "@/components/layout/app-shell";
import { WorkspaceShell } from "@/features/spectra/pages/workspace-shell";

export const dynamic = "force-dynamic";

export default function WorkspacePage() {
  return (
    <AppShell fullBleed noScroll contentClassName="!p-0">
      <WorkspaceShell />
    </AppShell>
  );
}
