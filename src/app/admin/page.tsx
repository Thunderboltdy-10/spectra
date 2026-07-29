import { AppShell } from "@/components/layout/app-shell";
import { SchoolAdminShell } from "@/features/spectra/pages/school-admin-shell";
import { requireActor } from "@/lib/auth-server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SchoolAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ operatorSessionId?: string }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  if (actor.schoolRole !== "school_admin" && !params.operatorSessionId)
    redirect("/workspace");
  return (
    <AppShell fullBleed contentClassName="!p-0">
      <SchoolAdminShell />
    </AppShell>
  );
}
