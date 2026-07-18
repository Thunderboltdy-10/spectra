import { AppShell } from "@/components/layout/app-shell";
import { SuperadminShell } from "@/features/spectra/pages/superadmin-shell";
import { requirePlatformOperator } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export default async function SuperadminPage() {
  await requirePlatformOperator();
  return (
    <AppShell fullBleed contentClassName="!p-0">
      <SuperadminShell />
    </AppShell>
  );
}
