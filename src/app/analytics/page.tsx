import { AppShell } from "@/components/layout/app-shell";
import { AnalyticsShell } from "@/features/spectra/pages/analytics-shell";

export default function AnalyticsPage() {
  return (
    <AppShell fullBleed contentClassName="!p-0">
      <AnalyticsShell />
    </AppShell>
  );
}
