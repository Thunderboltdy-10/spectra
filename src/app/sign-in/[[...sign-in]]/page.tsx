import Link from "next/link";
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--bg-primary)] px-4 py-8">
      <div className="w-full max-w-4xl">
        <div className="mx-auto mb-6 flex w-fit rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-1">
          <span className="rounded-md bg-[var(--bg-elevated)] px-4 py-1.5 text-sm font-medium text-[var(--text-primary)] shadow-sm">
            Sign in
          </span>
          <Link
            href="/sign-up"
            className="rounded-md px-4 py-1.5 text-sm text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
          >
            Sign up
          </Link>
        </div>

        <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-soft)] md:grid md:grid-cols-[1.1fr_1fr] md:gap-6 md:p-8">
          <section className="mb-6 md:mb-0">
            <h1 className="font-display text-2xl text-[var(--text-primary)]">Welcome back</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Continue learning with multiple AI models, custom classroom agents, and guided study workflows.
            </p>
          </section>

          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
            <SignIn />
          </section>
        </div>
      </div>
    </main>
  );
}
