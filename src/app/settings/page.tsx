import { AppShell } from "@/components/layout/app-shell";
import { SettingsApplication } from "@/features/spectra/settings/ui/settings-application";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { section } = await searchParams;
  return (
    <AppShell fullBleed contentClassName="!p-0">
      <SettingsApplication initialSection={section} />
    </AppShell>
  );
}
