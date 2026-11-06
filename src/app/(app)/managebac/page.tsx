import { ManageBacIntegrationShell } from "@/features/spectra/pages/managebac-integration-shell";
import { SchoolMembershipGate } from "@/features/spectra/components/school-membership-gate";

export const dynamic = "force-dynamic";

export default function ManageBacPage() {
  return (
    <SchoolMembershipGate>
      <ManageBacIntegrationShell />
    </SchoolMembershipGate>
  );
}
