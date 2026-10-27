import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { SpectraMark } from "@/components/spectra-mark";
import { SignedInContinue } from "@/components/signed-in-continue";
import { SignInConnectionState } from "@/components/account-connection-state";
import { authHrefForRedirect } from "@/lib/invitation-session";

function getSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function SignUpCard({ redirectUrl }: { redirectUrl?: string }) {
  const invitationFlow = redirectUrl?.includes("/join?token=") ?? false;

  return (
    <main className="spectra-wave-y relative isolate grid min-h-dvh place-items-center bg-[var(--bg-primary)] px-4 py-8 text-[var(--text-primary)]">
      <div className="w-full min-w-0 max-w-4xl">
        <nav aria-label="Sign in or sign up" className="mx-auto mb-6 flex w-fit rounded-control border border-[var(--border-default)] bg-[var(--bg-secondary)] p-1">
          <Link
            href={authHrefForRedirect("/sign-in", redirectUrl)}
            className="rounded-control px-4 py-1.5 text-caption text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          >
            Sign in
          </Link>
          <span aria-current="page" className="rounded-control bg-[var(--bg-elevated)] px-4 py-1.5 text-caption font-medium text-[var(--text-primary)] shadow-[var(--shadow-soft)]">
            Sign up
          </span>
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
              Create your account
            </h1>
            <p className="mt-2 text-ui leading-6 text-[var(--text-secondary)]">
              Join your school on Spectra to plan, study and make work
              together, with Spectra AI beside you.
            </p>
            <div className="mt-4 rounded-card border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-caption leading-5 text-[var(--text-secondary)]">
              {invitationFlow ? (
                <>
                  Use the email your invitation went to. You&rsquo;ll come
                  back to the invitation to join.
                </>
              ) : (
                <>
                  Spectra works by school invitation. If your school
                  hasn&rsquo;t invited you yet, start here:{" "}
                  <Link
                    href="/request-access"
                    className="font-medium text-[var(--text-primary)] underline underline-offset-2"
                  >
                    Getting into Spectra
                  </Link>
                </>
              )}
            </div>
          </section>

          <section className="min-w-0 overflow-x-auto rounded-card border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
            <SignedInContinue to={redirectUrl} />
            <SignInConnectionState />
            <SignUp
              signInUrl={authHrefForRedirect("/sign-in", redirectUrl)}
              appearance={{ elements: {
                rootBox: { width: "100%" },
                cardBox: { width: "100%" },
                card: { width: "100%" },
              } }}
              fallbackRedirectUrl={redirectUrl || "/workspace"}
              forceRedirectUrl={redirectUrl || "/workspace"}
            />
          </section>
        </div>
      </div>
    </main>
  );
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const redirectUrl = getSearchParam(params.redirect_url);
  return <SignUpCard redirectUrl={redirectUrl} />;
}
