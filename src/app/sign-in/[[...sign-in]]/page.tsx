import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignedInContinue } from "@/components/signed-in-continue";
import { SignInConnectionState } from "@/components/account-connection-state";
import { authHrefForRedirect } from "@/lib/invitation-session";

function getSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function SignInCard({ redirectUrl }: { redirectUrl?: string }) {
  const invitationFlow = redirectUrl?.includes("/join?token=") ?? false;

  return (
    <AuthShell home="student">
      <nav aria-label="Sign in or sign up" className="auth-switch">
        <span aria-current="page">Sign in</span>
        <Link href={authHrefForRedirect("/sign-up", redirectUrl)}>Sign up</Link>
      </nav>
      <div>
        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-lede">
          Pick up where you left off: your work, your chats and your school, in
          one place.
        </p>
      </div>
      {invitationFlow ? (
        <div className="auth-note">
          Sign in with the email your invitation went to. You&rsquo;ll come back
          to the invitation to join.
        </div>
      ) : null}
      <div className="auth-clerk">
        <SignedInContinue to={redirectUrl} />
        <SignInConnectionState />
        <SignIn
          signUpUrl={authHrefForRedirect("/sign-up", redirectUrl)}
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

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const redirectUrl = getSearchParam(params.redirect_url);
  return <SignInCard redirectUrl={redirectUrl} />;
}
