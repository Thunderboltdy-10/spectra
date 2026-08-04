import { AppShell } from "@/components/layout/app-shell";
import { CalendarApplication } from "@/features/spectra/calendar/ui/calendar-application";

export const dynamic = "force-dynamic";

export default function CalendarPage() {
  return <AppShell fullBleed noScroll contentClassName="!p-0"><CalendarApplication /></AppShell>;
}
