import Link from "next/link";

export default function CookiePolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 text-[var(--text-primary)] sm:px-6">
      <h1 className="font-display text-4xl">Cookie Policy</h1>
      <p className="mt-3 text-sm text-[var(--text-secondary)]">
        Spectra uses a consent-based cookie model with required and optional categories.
      </p>

      <section className="mt-6 space-y-2">
        <h2 className="text-lg font-semibold">Necessary cookies</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Required for sign-in, security protections, session continuity, and core product functionality.
        </p>
      </section>

      <section className="mt-5 space-y-2">
        <h2 className="text-lg font-semibold">Preference cookies</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Store non-essential UI preferences and personalization settings. Disabled until you grant consent.
        </p>
      </section>

      <section className="mt-5 space-y-2">
        <h2 className="text-lg font-semibold">Analytics cookies</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Used for optional product analytics. Disabled by default unless you choose Accept all or enable Analytics in
          Configure settings.
        </p>
      </section>

      <section className="mt-5 space-y-2">
        <h2 className="text-lg font-semibold">Changing consent</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Use the persistent Cookie settings control in-app to update your choice at any time.
        </p>
      </section>

      <p className="mt-8 text-xs text-[var(--text-secondary)]">
        Related: <Link className="underline underline-offset-2" href="/legal/privacy">Privacy Notice</Link> and{" "}
        <Link className="underline underline-offset-2" href="/legal/terms">Terms of Service</Link>.
      </p>
    </main>
  );
}
