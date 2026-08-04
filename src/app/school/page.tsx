import { AppShell } from "@/components/layout/app-shell";
import { SchoolDataShell } from "@/features/spectra/pages/school-data-shell";

export const dynamic = "force-dynamic";

export default function SchoolPage() {
  return <AppShell fullBleed contentClassName="!p-0"><SchoolDataShell /></AppShell>;
}
