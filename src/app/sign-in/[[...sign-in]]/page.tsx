import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
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

function SignInCard({
  redirectUrl,
  invitation,
}: {
  redirectUrl?: string;
  invitation: InvitationLanding | null;
}) {
  const invitationFlow = redirectUrl?.includes("/join?token=") ?? false;

  return (
    <AuthShell home="student">
      <nav aria-label="Sign in or sign up" className="auth-switch">
        <span aria-current="page">Sign in</span>
        <Link href={authHrefForRedirect("/sign-up", redirectUrl)}>Sign up</Link>
      </nav>
      <div>
        <h1 className="auth-title">
          {invitation ? `Join ${invitation.schoolName}` : "Welcome back"}
        </h1>
        <p className="auth-lede">
          {invitation
            ? `You were invited as a ${invitationRoleLabel(invitation.role)}. Sign in with ${invitation.email} to join, or create your account if you're new.`
            : "Pick up where you left off: your work, your chats and your school, in one place."}
        </p>
      </div>
      {invitationFlow && !invitation ? (
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
          initialValues={invitation ? { emailAddress: invitation.email } : undefined}
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
  const invitation = await invitationLanding(joinTokenFromRedirect(redirectUrl));
  return <SignInCard redirectUrl={redirectUrl} invitation={invitation} />;
}
