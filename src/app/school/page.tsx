import { AppShell } from "@/components/layout/app-shell";
import { SchoolPage as SchoolSurface } from "@/features/spectra/school/school-page";
import { SchoolMembershipGate } from "@/features/spectra/components/school-membership-gate";

export const dynamic = "force-dynamic";

export default function SchoolPage() {
  return (
    <AppShell fullBleed contentClassName="!p-0">
      <SchoolMembershipGate>
        <SchoolSurface />
      </SchoolMembershipGate>
    </AppShell>
  );
}
