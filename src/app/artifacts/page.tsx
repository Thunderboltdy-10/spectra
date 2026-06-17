import { AppShell } from "@/components/layout/app-shell";
import { ArtifactsShell } from "@/features/spectra/pages/artifacts-shell";

export default function ArtifactsPage() {
  return (
    <AppShell fullBleed noScroll contentClassName="!p-0 overflow-y-auto">
      <ArtifactsShell />
    </AppShell>
  );
}
