import { AppShell } from "@/components/layout/app-shell";
import { ChatShell } from "@/features/spectra/pages/chat-shell";

export const dynamic = "force-dynamic";

/** Home: the day at a glance, and the conversations started from it, in place. */
export default function HomePage() {
  return <AppShell fullBleed noScroll contentClassName="!p-0"><ChatShell /></AppShell>;
}
