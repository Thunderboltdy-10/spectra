import Link from "next/link";

export default function RequestAccessPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--bg-primary)] px-4 py-10">
      <div className="w-full max-w-2xl rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 shadow-[var(--shadow-soft)]">
        <p className="text-micro font-medium uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          Spectra access
        </p>
        <h1 className="mt-2 font-display text-3xl text-[var(--text-primary)]">
          Request school access
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
          Spectra is invitation-based. Ask your school administrator to invite
          the exact email you will use to sign up, or contact Spectra support if
          your school is not yet onboarded.
        </p>
        <ol className="mt-6 space-y-3 text-sm text-[var(--text-secondary)]">
          <li className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
            1. Confirm the school email you will register with.
          </li>
          <li className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
            2. Ask a school admin to send an invitation for that email.
          </li>
          <li className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
            3. Open the invitation link, create your account, and join.
          </li>
        </ol>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/sign-up"
            className="rounded-xl bg-[var(--accent-primary)] px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            Continue to sign up
          </Link>
          <Link
            href="/sign-in"
            className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
          >
            Sign in
          </Link>
          <Link
            href="/join"
            className="rounded-xl border border-[var(--border-default)] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
          >
            I already have an invitation
          </Link>
        </div>
      </div>
    </main>
  );
}
