import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { SpectraMark } from "@/components/spectra-mark";
import { SignedInContinue } from "@/components/signed-in-continue";
import { SignInConnectionState } from "@/components/account-connection-state";
import { authHrefForRedirect } from "@/lib/invitation-session";

function getSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function SignInCard({ redirectUrl }: { redirectUrl?: string }) {
  const invitationFlow = redirectUrl?.includes("/join?token=") ?? false;

  return (
    <main className="spectra-wave-y relative isolate grid min-h-dvh place-items-center bg-[var(--bg-primary)] px-4 py-8 text-[var(--text-primary)]">
      <div className="w-full min-w-0 max-w-4xl">
        <nav aria-label="Sign in or sign up" className="mx-auto mb-6 flex w-fit rounded-control border border-[var(--border-default)] bg-[var(--bg-secondary)] p-1">
          <span aria-current="page" className="rounded-control bg-[var(--bg-elevated)] px-4 py-1.5 text-caption font-medium text-[var(--text-primary)] shadow-[var(--shadow-soft)]">
            Sign in
          </span>
          <Link
            href={authHrefForRedirect("/sign-up", redirectUrl)}
            className="rounded-control px-4 py-1.5 text-caption text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          >
            Sign up
          </Link>
        </nav>

        <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-soft)] md:grid md:grid-cols-[1.1fr_1fr] md:gap-6 md:p-8">
          <section className="mb-6 md:mb-0">
            <Link href="/" aria-label="Spectra home" className="mb-5 inline-flex items-center gap-2.5 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]">
              <SpectraMark size={28} />
              <span className="font-display text-subhead font-semibold text-[var(--text-primary)]">
                Spectra
              </span>
            </Link>
            <h1 className="font-display text-display font-semibold leading-tight tracking-[-0.03em] text-[var(--text-primary)]">
              Welcome back
            </h1>
            <p className="mt-2 text-ui leading-6 text-[var(--text-secondary)]">
              Pick up where you left off: your work, your chats and your
              school, in one place.
            </p>
            {invitationFlow ? (
              <div className="mt-4 rounded-card border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-caption leading-5 text-[var(--text-secondary)]">
                Sign in with the email your invitation went to. You&rsquo;ll
                come back to the invitation to join.
              </div>
            ) : null}
          </section>

          <section className="min-w-0 overflow-x-auto rounded-card border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
            <SignedInContinue to={redirectUrl} />
            <SignInConnectionState />
            <SignIn
              fallbackRedirectUrl={redirectUrl || "/workspace"}
              forceRedirectUrl={redirectUrl || "/workspace"}
            />
          </section>
        </div>
      </div>
    </main>
  );
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const redirectUrl = getSearchParam(params.redirect_url);
  return <SignInCard redirectUrl={redirectUrl} />;
}
