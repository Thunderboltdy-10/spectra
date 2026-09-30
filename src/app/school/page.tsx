import { AppShell } from "@/components/layout/app-shell";
import { SchoolDataShell } from "@/features/spectra/pages/school-data-shell";
import { SchoolMembershipGate } from "@/features/spectra/components/school-membership-gate";

export const dynamic = "force-dynamic";

export default function SchoolPage() {
  return (
    <AppShell fullBleed contentClassName="!p-0">
      <SchoolMembershipGate>
        <SchoolDataShell />
      </SchoolMembershipGate>
    </AppShell>
  );
}
