import { SettingsApplication } from "@/features/spectra/settings/ui/settings-application";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { section } = await searchParams;
  return (
    <SettingsApplication initialSection={section} />
  );
}
