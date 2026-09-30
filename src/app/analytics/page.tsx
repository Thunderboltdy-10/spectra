import { AppShell } from "@/components/layout/app-shell";
import { AnalyticsShell } from "@/features/spectra/pages/analytics-shell";
import { SchoolMembershipGate } from "@/features/spectra/components/school-membership-gate";

export const dynamic = "force-dynamic";

export default function AnalyticsPage() {
  return (
    <AppShell fullBleed contentClassName="!p-0">
      <SchoolMembershipGate>
        <AnalyticsShell />
      </SchoolMembershipGate>
    </AppShell>
  );
}
