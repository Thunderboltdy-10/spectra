import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NoAccessPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 shadow-[var(--shadow-soft)]">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--warning)_14%,transparent)]">
          <AlertTriangle className="h-6 w-6 text-[var(--warning)]" />
        </div>
        <h1 className="font-display text-2xl text-[var(--text-primary)]">No school access</h1>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          Your account is not linked to a school workspace. Contact your school administrator for an invitation.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/sign-in">
            <Button>Sign in again</Button>
          </Link>
          <Link href="/">
            <Button variant="secondary">Back to AI School</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
