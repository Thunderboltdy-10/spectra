import Link from "next/link";
import { Clock, Mail, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] px-4">
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]">
          <Clock className="h-7 w-7 text-[var(--text-secondary)]" />
        </div>

        <h1 className="font-display text-3xl text-[var(--text-primary)]">Approval pending</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[var(--text-secondary)]">
          Your account is waiting for your school administrator to grant access. You will be able to use AI School once approved.
        </p>

        <div className="mx-auto mt-8 max-w-xs space-y-3">
          <div className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-3 text-left">
            <Mail className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Check your email</p>
              <p className="text-xs text-[var(--text-secondary)]">You may receive an invitation link from your school.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-3 text-left">
            <Clock className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Contact your admin</p>
              <p className="text-xs text-[var(--text-secondary)]">Ask your school administrator for access.</p>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/sign-in">
            <Button variant="secondary" className="gap-2">
              <ArrowLeft className="h-3.5 w-3.5" />
              Sign in again
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
