import Link from "next/link";

export default function PrivacyNoticePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 text-[var(--text-primary)] sm:px-6">
      <h1 className="font-display text-4xl">Privacy Notice</h1>
      <p className="mt-3 text-sm text-[var(--text-secondary)]">
        This notice explains what data AI School processes and why.
      </p>

      <section className="mt-6 space-y-2">
        <h2 className="text-lg font-semibold">Data we process</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Account profile details, conversation content, attachments you upload, and operational events needed for safety,
          billing, and product reliability.
        </p>
      </section>

      <section className="mt-5 space-y-2">
        <h2 className="text-lg font-semibold">How data is used</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          We use your data to run the product, provide educational features, keep services secure, and improve quality.
          Optional analytics are only active if you consent.
        </p>
      </section>

      <section className="mt-5 space-y-2">
        <h2 className="text-lg font-semibold">Your controls</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          You can update cookie preferences anytime using the cookie settings button in the app.
        </p>
      </section>

      <p className="mt-8 text-xs text-[var(--text-secondary)]">
        Related: <Link className="underline underline-offset-2" href="/legal/cookies">Cookie Policy</Link> and{" "}
        <Link className="underline underline-offset-2" href="/legal/terms">Terms of Service</Link>.
      </p>
    </main>
  );
}
