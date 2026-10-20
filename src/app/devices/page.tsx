import { AppShell } from "@/components/layout/app-shell";
import { DevicesPage } from "@/features/spectra/devices/devices-page";

export const dynamic = "force-dynamic";

export default async function Devices() {
  return (
    <AppShell fullBleed contentClassName="!p-0">
      <DevicesPage />
    </AppShell>
  );
}
