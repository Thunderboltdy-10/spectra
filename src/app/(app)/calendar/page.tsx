import { CalendarApplication } from "@/features/spectra/calendar/ui/calendar-application";

export const dynamic = "force-dynamic";

/** ?at=<epoch ms> opens the calendar on that week: a card for an event Spectra added links here. */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ at?: string }> }) {
  const at = Number((await searchParams).at);
  return <CalendarApplication focusAt={Number.isFinite(at) && at > 0 ? at : undefined} />;
}
