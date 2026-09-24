import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { SpectraMark } from "@/components/spectra-mark";
import { SurfaceField } from "@/features/spectra/field/surface-field";
import { SignedInContinue } from "@/components/signed-in-continue";
import { authHrefForRedirect } from "@/lib/invitation-session";

function getSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function SignInCard({ redirectUrl }: { redirectUrl?: string }) {
  const invitationFlow = redirectUrl?.includes("/join?token=") ?? false;

  return (
    <main className="relative isolate grid min-h-screen place-items-center bg-[var(--bg-primary)] px-4 py-8">
      <SurfaceField scale="stage" behind />
      <div className="w-full max-w-4xl">
        <div className="mx-auto mb-6 flex w-fit rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-1">
          <span className="rounded-md bg-[var(--bg-elevated)] px-4 py-1.5 text-sm font-medium text-[var(--text-primary)] shadow-sm">
            Sign in
          </span>
          <Link
            href={authHrefForRedirect("/sign-up", redirectUrl)}
            className="rounded-md px-4 py-1.5 text-sm text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
          >
            Sign up
          </Link>
        </div>

        <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-soft)] md:grid md:grid-cols-[1.1fr_1fr] md:gap-6 md:p-8">
          <section className="mb-6 md:mb-0">
            <div className="mb-5 flex items-center gap-2.5">
              <SpectraMark size={30} />
              <span className="text-subhead font-bold tracking-tight text-[var(--text-primary)]">
                Spectra
              </span>
            </div>
            <h1 className="font-display text-2xl text-[var(--text-primary)]">
              Welcome back
            </h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Continue learning with multiple AI models, custom classroom
              agents, and guided study workflows.
            </p>
            {invitationFlow ? (
              <div className="mt-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--text-secondary)]">
                Sign in with the exact email address that received the
                invitation. After sign-in, the invitation will be completed
                automatically.
              </div>
            ) : null}
          </section>

          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
            <SignedInContinue to={redirectUrl} />
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
