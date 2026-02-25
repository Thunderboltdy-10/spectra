import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 text-[var(--text-primary)] sm:px-6">
      <h1 className="font-display text-4xl">Terms of Service</h1>
      <p className="mt-3 text-sm text-[var(--text-secondary)]">
        These terms govern usage of AI School services and features.
      </p>

      <section className="mt-6 space-y-2">
        <h2 className="text-lg font-semibold">Acceptable use</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Use the platform for lawful educational activities. Do not attempt misuse, abuse, or policy evasion.
        </p>
      </section>

      <section className="mt-5 space-y-2">
        <h2 className="text-lg font-semibold">User content</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          You are responsible for content you submit. Upload only materials you are authorized to use.
        </p>
      </section>

      <section className="mt-5 space-y-2">
        <h2 className="text-lg font-semibold">Service changes</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Features can evolve over time, including model availability, limits, and user interface behavior.
        </p>
      </section>

      <section className="mt-5 space-y-2">
        <h2 className="text-lg font-semibold">Privacy and cookies</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Data handling is described in the Privacy Notice and Cookie Policy.
        </p>
      </section>

      <p className="mt-8 text-xs text-[var(--text-secondary)]">
        Related: <Link className="underline underline-offset-2" href="/legal/privacy">Privacy Notice</Link> and{" "}
        <Link className="underline underline-offset-2" href="/legal/cookies">Cookie Policy</Link>.
      </p>
    </main>
  );
}
