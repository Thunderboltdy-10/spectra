import { requireActor } from "@/lib/auth-server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ManageBacPage() {
  const actor = await requireActor({ fresh: true });
  redirect(actor.schoolRole === "school_admin" ? "/admin?tab=integrations" : "/school");
}
