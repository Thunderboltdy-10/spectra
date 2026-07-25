import { AppShell } from "@/components/layout/app-shell";
import { ModelsShell } from "@/features/spectra/pages/models-shell";

export default function ModelsPage() {
  return (
    <AppShell fullBleed contentClassName="!p-0">
      <ModelsShell />
    </AppShell>
  );
}
