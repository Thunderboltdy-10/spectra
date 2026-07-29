import { AppShell } from "@/components/layout/app-shell";
import { TimetablePageShell } from "@/features/spectra/pages/timetable-page-shell";

export const dynamic = "force-dynamic";

export default function TimetablePage() {
  return (
    <AppShell fullBleed noScroll contentClassName="!p-0">
      <TimetablePageShell />
    </AppShell>
  );
}
