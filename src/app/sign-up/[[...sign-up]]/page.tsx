import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignedInContinue } from "@/components/signed-in-continue";
import { SignInConnectionState } from "@/components/account-connection-state";
import { authHrefForRedirect } from "@/lib/invitation-session";
import {
  invitationLanding,
  invitationRoleLabel,
  joinTokenFromRedirect,
  type InvitationLanding,
} from "@/lib/invitation-landing";

function getSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function SignUpCard({
  redirectUrl,
  invitation,
}: {
  redirectUrl?: string;
  invitation: InvitationLanding | null;
}) {
  const invitationFlow = redirectUrl?.includes("/join?token=") ?? false;

  return (
    <AuthShell home="teacher">
      <nav aria-label="Sign in or sign up" className="auth-switch">
        <Link href={authHrefForRedirect("/sign-in", redirectUrl)}>Sign in</Link>
        <span aria-current="page">Sign up</span>
      </nav>
      <div>
        <h1 className="auth-title">
          {invitation ? `Join ${invitation.schoolName}` : "Create your account"}
        </h1>
        <p className="auth-lede">
          {invitation
            ? `You were invited as a ${invitationRoleLabel(invitation.role)}. Create your account with ${invitation.email} and you'll join straight after.`
            : "Spectra is by invitation. Sign up with the email your school invited, and you'll join your school straight after."}
        </p>
      </div>
      <div className="auth-note">
        {invitation ? (
          <>
            Already have an account?{" "}
            <Link
              href={authHrefForRedirect("/sign-in", redirectUrl)}
              className="font-medium text-[var(--text-primary)] underline underline-offset-2"
            >
              Sign in instead
            </Link>
          </>
        ) : invitationFlow ? (
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
          initialValues={invitation ? { emailAddress: invitation.email } : undefined}
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
  const invitation = await invitationLanding(joinTokenFromRedirect(redirectUrl));
  return <SignUpCard redirectUrl={redirectUrl} invitation={invitation} />;
}
