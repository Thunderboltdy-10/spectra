import { SuperadminShell } from "@/features/spectra/pages/superadmin-shell";
import { requirePlatformOperator } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export default async function SuperadminPage() {
  await requirePlatformOperator();
  return (
    <SuperadminShell />
  );
}
