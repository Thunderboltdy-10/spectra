import { AppShell } from "@/components/layout/app-shell";
import { SchoolDataShell } from "@/features/spectra/pages/school-data-shell";

export const dynamic = "force-dynamic";

export default function SchoolDataPage() {
  return (
    <AppShell fullBleed contentClassName="!p-0">
      <SchoolDataShell />
    </AppShell>
  );
}
