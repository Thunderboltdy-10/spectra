import { AppShell } from "@/components/layout/app-shell";
import { ManageBacIntegrationShell } from "@/features/spectra/pages/managebac-integration-shell";

export const dynamic = "force-dynamic";

export default function ManageBacPage() {
  return (
    <AppShell fullBleed contentClassName="!p-0">
      <ManageBacIntegrationShell />
    </AppShell>
  );
}
