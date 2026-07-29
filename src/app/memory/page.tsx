import { AppShell } from "@/components/layout/app-shell";
import { MemoryShell } from "@/features/spectra/pages/memory-shell";

export const dynamic = "force-dynamic";

export default function MemoryPage() {
  return (
    <AppShell fullBleed contentClassName="!p-0">
      <MemoryShell />
    </AppShell>
  );
}
