import { redirect } from "next/navigation";
import { NotesWorkspace } from "@/components/notes/notes-workspace";
import { requireActor } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export default async function NotesPage() {
  try {
    await requireActor();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("AUTH_NO_ACCESS") || message.startsWith("AUTH_ORG_INACTIVE")) {
      redirect(message.startsWith("AUTH_ORG_INACTIVE") ? "/no-access?reason=inactive" : "/no-access");
    }
    if (message.startsWith("AUTH_NOT_SIGNED_IN")) {
      redirect("/sign-in?redirect_url=/notes");
    }
    throw error;
  }

  return <NotesWorkspace />;
}
