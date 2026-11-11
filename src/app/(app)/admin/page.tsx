import { SchoolAdminShell } from "@/features/spectra/pages/school-admin-shell";
import { requireAccessPrincipal } from "@/lib/auth-server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SchoolAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ operatorSessionId?: string }>;
}) {
  const params = await searchParams;
  const principal = await requireAccessPrincipal(
    params.operatorSessionId ? "platform" : "school",
  );
  if (
    principal.kind === "school" &&
    principal.actor.schoolRole !== "school_admin"
  )
    redirect("/workspace");
  return (
    <SchoolAdminShell />
  );
}
