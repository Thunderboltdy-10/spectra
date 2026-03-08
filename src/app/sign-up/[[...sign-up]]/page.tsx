import Link from "next/link";
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--bg-primary)] px-4 py-8">
      <div className="w-full max-w-4xl">
        <div className="mx-auto mb-6 flex w-fit rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-1">
          <Link
            href="/sign-in"
            className="rounded-md px-4 py-1.5 text-sm text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
          >
            Sign in
          </Link>
          <span className="rounded-md bg-[var(--bg-elevated)] px-4 py-1.5 text-sm font-medium text-[var(--text-primary)] shadow-sm">
            Sign up
          </span>
        </div>

        <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-soft)] md:grid md:grid-cols-[1.1fr_1fr] md:gap-6 md:p-8">
          <section className="mb-6 md:mb-0">
            <h1 className="font-display text-2xl text-[var(--text-primary)]">Create your account</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Join your school workspace to chat with AI, use curriculum resources, and build subject-specific agents.
            </p>
            <div className="mt-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--text-secondary)]">
              School access is invitation-based. If your school has not invited you yet, submit an access request first.
              {" "}
              <Link href="/request-access" className="text-[var(--accent-cyan)] hover:underline">
                Request access
              </Link>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
            <SignUp />
          </section>
        </div>
      </div>
    </main>
  );
}
