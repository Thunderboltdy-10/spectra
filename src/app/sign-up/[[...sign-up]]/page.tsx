import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignedInContinue } from "@/components/signed-in-continue";
import { SignInConnectionState } from "@/components/account-connection-state";
import { authHrefForRedirect } from "@/lib/invitation-session";

function getSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function SignUpCard({ redirectUrl }: { redirectUrl?: string }) {
  const invitationFlow = redirectUrl?.includes("/join?token=") ?? false;

  return (
    <AuthShell home="teacher">
      <nav aria-label="Sign in or sign up" className="auth-switch">
        <Link href={authHrefForRedirect("/sign-in", redirectUrl)}>Sign in</Link>
        <span aria-current="page">Sign up</span>
      </nav>
      <div>
        <h1 className="auth-title">Create your account</h1>
        <p className="auth-lede">
          Join your school on Spectra to plan, study and make work together,
          with Spectra AI beside you.
        </p>
      </div>
      <div className="auth-note">
        {invitationFlow ? (
          <>
            Use the email your invitation went to. You&rsquo;ll come back to the
            invitation to join.
          </>
        ) : (
          <>
            Spectra works by school invitation. If your school hasn&rsquo;t
            invited you yet, start here:{" "}
            <Link
              href="/request-access"
              className="font-medium text-[var(--text-primary)] underline underline-offset-2"
            >
              Getting into Spectra
            </Link>
          </>
        )}
      </div>
      <div className="auth-clerk">
        <SignedInContinue to={redirectUrl} />
        <SignInConnectionState />
        <SignUp
          signInUrl={authHrefForRedirect("/sign-in", redirectUrl)}
          appearance={{
            elements: {
              rootBox: { width: "100%" },
              cardBox: { width: "100%" },
              card: { width: "100%" },
            },
          }}
          fallbackRedirectUrl={redirectUrl || "/workspace"}
          forceRedirectUrl={redirectUrl || "/workspace"}
        />
      </div>
    </AuthShell>
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
