import { Suspense } from "react";
import { redirect } from "next/navigation";
import { HOME_PATH } from "@/features/spectra/chat/home-routes";
import { SpectraShell } from "@/features/spectra/pages/spectra-shell";
import { isLibraryTarget } from "@/features/spectra/today/home-route";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // Without something to open, /workspace was Home.
  if (!isLibraryTarget((key) => params[key] !== undefined)) redirect(HOME_PATH);
  return (
    <Suspense fallback={<div className="h-full min-h-0" />}>
      <SpectraShell surface="workspace" />
    </Suspense>
  );
}
