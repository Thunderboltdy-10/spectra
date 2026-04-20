import { redirect } from "next/navigation";
import { ChatLayout } from "@/components/chat/chat-layout";
import { requireActor } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  try {
    await requireActor();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("AUTH_NO_ACCESS") || message.startsWith("AUTH_ORG_INACTIVE")) {
      redirect(message.startsWith("AUTH_ORG_INACTIVE") ? "/request-access?reason=inactive" : "/request-access");
    }
    if (message.startsWith("AUTH_NOT_SIGNED_IN")) {
      redirect("/sign-in?redirect_url=/chat");
    }
    throw error;
  }

  return <ChatLayout />;
}
