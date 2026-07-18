import { AppShell } from "@/components/layout/app-shell";
import { AgentLibraryShell } from "@/features/spectra/pages/agent-library-shell";

export default function AgentsPage() {
  return (
    <AppShell fullBleed noScroll contentClassName="!p-0">
      <AgentLibraryShell />
    </AppShell>
  );
}
