import { AppShell } from "@/components/layout/app-shell";
import { ChatShell } from "@/features/spectra/pages/chat-shell";

export const dynamic = "force-dynamic";

export default function ChatPage() {
  return <AppShell fullBleed noScroll contentClassName="!p-0"><ChatShell /></AppShell>;
}
