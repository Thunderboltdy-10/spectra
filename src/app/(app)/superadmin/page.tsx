import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-state";
import { SuperadminShell } from "@/features/spectra/pages/superadmin-shell";
import { requirePlatformOperator } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export default async function SuperadminPage() {
  try {
    await requirePlatformOperator();
  } catch (error) {
    // Anyone else who reaches the address is told plainly, not shown a failure.
    if (!(error instanceof Error) || !error.message.startsWith("AUTH_OPERATOR_REQUIRED")) throw error;
    return (
      <main className="grid h-full min-h-0 flex-1 place-items-center" data-spectra-app-surface="true">
        <EmptyState
          icon="identity"
          title="This page is for Spectra's operators."
          action={<Link href="/home" className={buttonVariants({ variant: "ghost" })}>Go to Home</Link>}
        />
      </main>
    );
  }
  return (
    <SuperadminShell />
  );
}
