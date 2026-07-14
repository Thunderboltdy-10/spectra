import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ChatShell } from "@/features/spectra/pages/chat-shell";
import { requireActor } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  try {
    await requireActor();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("AUTH_NOT_SIGNED_IN")) {
      redirect("/sign-in?redirect_url=/chat");
    }
    throw error;
  }

  return <AppShell fullBleed noScroll contentClassName="!p-0"><ChatShell /></AppShell>;
}
