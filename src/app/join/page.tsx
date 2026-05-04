"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import Image from "next/image";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SpectraLogo } from "@/components/spectra-logo";
import { hasClerkPublishableKey } from "@/lib/clerk-config";
import { getAppUrl } from "@/lib/app-url";

type InvitationData = {
  token: string;
  email: string;
  role: string;
  status: string;
  orgId: string;
  expiresAt: number;
  orgName?: string;
  orgWelcomeMessage?: string;
  orgLogoUrl?: string;
  alreadyAccepted?: boolean;
};

type InvitationMachineState =
  | "token_missing"
  | "token_invalid"
  | "token_expired"
  | "token_valid_signed_out"
  | "token_valid_signed_in_wrong_identity"
  | "token_valid_signed_in_match_pending_redeem"
  | "token_redeemed"
  | "token_already_redeemed_same_user"
  | "token_already_redeemed_other_user";

type JoinStateResponse = {
  state: InvitationMachineState;
  invitation: InvitationData | null;
  invitedEmail: string | null;
  viewer: {
    userId: string | null;
    primaryEmail: string | null;
    emails: string[];
  };
  shouldAutoRedirectToAuth: boolean;
  canRedeemNow: boolean;
};

type PageState =
  | { status: "loading" }
  | { status: "resolved"; payload: JoinStateResponse }
  | { status: "error"; message: string };

type JoinPageContentProps = {
  isLoaded: boolean;
  userId: string | null;
};

type RedeemState = { message: string | null };

// Fire-and-forget: tell the server to drop the invitation cookie so the user
// can navigate away from /join without the middleware snapping them back.
async function clearInvitationCookie() {
  try {
    await fetch("/api/invitations/redeem", { method: "DELETE" });
  } catch {
    // Best-effort. The access-state endpoint also clears the cookie whenever
    // the user has access, so a missed DELETE isn't catastrophic.
  }
}

function JoinPageContent({ isLoaded, userId }: JoinPageContentProps) {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [state, setState] = useState<PageState>({ status: "loading" });
  const [redeeming] = useState(false);
  const [redeemState, setRedeemState] = useState<RedeemState>({ message: null });

  useEffect(() => {
    void (async () => {
      try {
        const path = token ? `/api/join?token=${encodeURIComponent(token)}` : "/api/join";
        const response = await fetch(path, { cache: "no-store" });
        if (!response.ok) {
          const text = await response.text();
          let errorMessage = text || "Failed to load invitation.";
          try {
            const json = JSON.parse(text);
            errorMessage = json.error?.message || json.message || errorMessage;
          } catch {
            // Keep original text if not JSON
          }
          setState({ status: "error", message: errorMessage });
          return;
        }

        const data = (await response.json()) as JoinStateResponse;
        setRedeemState({ message: null });
        setState({ status: "resolved", payload: data });
      } catch {
        setState({ status: "error", message: "Could not verify invitation. Please try again." });
      }
    })();
  }, [token]);

  // Whenever we land on a state where the invitation can't help the current
  // user anymore, proactively clear the cookie so any subsequent navigation
  // (Continue, Switch account, manual URL change) isn't redirected back here.
  useEffect(() => {
    if (state.status === "error") {
      void clearInvitationCookie();
    }
  }, [state.status]);

  useEffect(() => {
    if (!isLoaded || state.status !== "resolved") {
      return;
    }

    const { payload } = state;
    const invitationToRedeem = payload.invitation;

    if (payload.shouldAutoRedirectToAuth) {
      if (payload.state === "token_valid_signed_in_wrong_identity") {
        // We do NOT clear the cookie here, because the user needs it to
        // switch to the correct account.
        const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in";
        const appUrl = getAppUrl(typeof window !== "undefined" ? window.location.origin : undefined);
        const redirect = encodeURIComponent(`${appUrl}/join${token ? `?token=${encodeURIComponent(token)}` : ""}`);
        window.location.href = `${signInUrl}?redirect_url=${redirect}`;
        return;
      }
      if (payload.state === "token_valid_signed_out" || payload.state === "token_already_redeemed_other_user") {
        const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in";
        const appUrl = getAppUrl(typeof window !== "undefined" ? window.location.origin : undefined);
        const redirect = encodeURIComponent(`${appUrl}/join${token ? `?token=${encodeURIComponent(token)}` : ""}`);
        window.location.href = `${signInUrl}?redirect_url=${redirect}`;
        return;
      }
      return;
    }

    if (payload.state === "token_already_redeemed_same_user" || payload.state === "token_redeemed") {
      void clearInvitationCookie();
      window.location.replace("/chat");
      return;
    }

    // Auto-redirect if token is missing or invalid and user is signed out
    if (!userId && (payload.state === "token_missing" || payload.state === "token_invalid")) {
      void clearInvitationCookie();
      const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in";
      window.location.href = signInUrl;
      return;
    }

    // Auto-redirect to request-access if token is missing/invalid and user is signed in
    if (userId && (payload.state === "token_missing" || payload.state === "token_invalid")) {
      void clearInvitationCookie();
      window.location.replace("/request-access");
      return;
    }

    // If we have an invitation and a matching user, but we haven't redeemed it yet,
    // we show the "Join" button instead of auto-redeeming immediately.
    // This gives the user a moment to see the school branding and confirm their entry.
    if (!userId || redeeming || !payload.canRedeemNow || !invitationToRedeem) {
      return;
    }
  }, [isLoaded, redeeming, state, token, userId]);

  const resolvedPayload = state.status === "resolved" ? state.payload : null;
  const invitation = resolvedPayload?.invitation ?? null;
  const viewerEmail = resolvedPayload?.viewer.primaryEmail ?? null;
  const viewerEmails = resolvedPayload?.viewer.emails ?? [];
  const viewerHasMatchingEmail = invitation
    ? viewerEmails.some((email) => email.toLowerCase() === invitation.email.toLowerCase())
    : false;

  const shouldAutoRedirect = resolvedPayload && (
    resolvedPayload.shouldAutoRedirectToAuth ||
    (!userId && (resolvedPayload.state === "token_missing" || resolvedPayload.state === "token_invalid")) ||
    (userId && (resolvedPayload.state === "token_missing" || resolvedPayload.state === "token_invalid")) ||
    (resolvedPayload.state === "token_already_redeemed_same_user" || resolvedPayload.state === "token_redeemed")
  );

  async function goToSignIn() {
    // Only clear cookie if it's genuinely invalid/expired.
    // Mismatch scenarios should PRESERVE the cookie.
    await clearInvitationCookie();
    const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in";
    window.location.assign(signInUrl);
  }

  if (state.status === "loading" || shouldAutoRedirect) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-4">
          <SpectraLogo size={56} showTile className="animate-pulse" />
          <p className="text-sm text-[var(--text-secondary)]">
            {state.status === "loading" ? "Verifying invitation..." : "Redirecting you..."}
          </p>
        </div>
      </div>
    );
  }

  // If we reach here and status is error, it means the API call failed entirely.
  // In that case, we should try to redirect them to /chat if they are signed in,
  // or /sign-in if they are not, instead of showing an error.
  if (state.status === "error") {
    if (isLoaded) {
      if (userId) {
        window.location.replace("/chat");
      } else {
        void goToSignIn();
      }
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-4">
          <SpectraLogo size={56} showTile className="animate-pulse" />
          <p className="text-sm text-[var(--text-secondary)]">Redirecting you...</p>
        </div>
      </div>
    );
  }

  if (state.status === "resolved" && state.payload.state === "token_expired") {
    // Instead of showing an expired screen, let's also just try to get them in
    // if they already have access, or send them to sign-in if not.
    if (userId) {
      window.location.replace("/chat");
    } else {
      void goToSignIn();
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-4">
          <SpectraLogo size={56} showTile className="animate-pulse" />
          <p className="text-sm text-[var(--text-secondary)]">Redirecting you...</p>
        </div>
      </div>
    );
  }

  // Final fallback: if somehow we are in a state that doesn't render above
  // (like token_invalid while signed in), force a redirect to /chat.
  if (state.status === "resolved" && (state.payload.state === "token_invalid" || state.payload.state === "token_missing")) {
    if (userId) {
      window.location.replace("/chat");
    } else {
      void goToSignIn();
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-4">
          <SpectraLogo size={56} showTile className="animate-pulse" />
          <p className="text-sm text-[var(--text-secondary)]">Redirecting you...</p>
        </div>
      </div>
    );
  }

  if (state.status === "resolved" && state.payload.state === "token_already_redeemed_same_user") {
    if (viewerHasMatchingEmail) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
          <div className="flex flex-col items-center gap-4">
            <SpectraLogo size={56} showTile className="animate-pulse" />
            <p className="text-sm text-[var(--text-secondary)]">Redirecting you to your workspace...</p>
          </div>
        </div>
      );
    }
  }

  if (!invitation) {
    return null;
  }

  const resolvedInvitation = invitation;

  const expiryDate = new Date(resolvedInvitation.expiresAt).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  function handleJoin() {
    const signUpUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up";
    const appUrl = getAppUrl(typeof window !== "undefined" ? window.location.origin : undefined);
    const redirect = encodeURIComponent(`${appUrl}/join?token=${encodeURIComponent(resolvedInvitation.token)}`);
    const emailParam = `email_address=${encodeURIComponent(resolvedInvitation.email)}`;
    window.location.href = `${signUpUrl}?${emailParam}&redirect_url=${redirect}`;
  }

  function handleSignIn() {
    const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in";
    const appUrl = getAppUrl(typeof window !== "undefined" ? window.location.origin : undefined);
    const redirect = encodeURIComponent(`${appUrl}/join?token=${encodeURIComponent(resolvedInvitation.token)}`);
    window.location.href = `${signInUrl}?redirect_url=${redirect}`;
  }

  async function handleSwitchAccount() {
    // The user needs to leave /join and authenticate as someone else.
    // Clear the cookie first so the middleware doesn't drag them back.
    await clearInvitationCookie();
    handleSignIn();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] px-4">
      {/* Background accent */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden="true"
      >
        <div className="absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-[color-mix(in_oklab,var(--accent-cyan)_8%,transparent)] blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 shadow-[var(--shadow-hover)]">
          {/* School branding */}
          <div className="mb-6 flex flex-col items-center text-center">
            {invitation.orgLogoUrl ? (
              <Image
                src={invitation.orgLogoUrl}
                alt={invitation.orgName ?? "School"}
                width={64}
                height={64}
                className="mb-3 h-16 w-16 rounded-2xl border border-[var(--border-default)] object-cover shadow-[var(--shadow-card)]"
              />
            ) : (
              <SpectraLogo size={64} showTile className="mb-3" />
            )}
            <h1 className="font-display text-2xl text-[var(--text-primary)]">
              {invitation.orgName ?? "Spectra"}
            </h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              You&apos;ve been invited to join
            </p>
          </div>

          {/* Welcome message */}
          {invitation.orgWelcomeMessage && (
            <div className="mb-5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
              <p className="text-sm text-[var(--text-primary)]">{invitation.orgWelcomeMessage}</p>
            </div>
          )}

          {/* Invitation details */}
          <div className="mb-6 space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--text-secondary)]">Invited as</span>
              <span className="font-medium capitalize text-[var(--text-primary)]">{invitation.role}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--text-secondary)]">Email</span>
              <span className="font-medium text-[var(--text-primary)]">{invitation.email}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--text-secondary)]">Expires</span>
              <span className="text-[var(--text-secondary)]">{expiryDate}</span>
            </div>
          </div>

          {/* Accepted indicator */}
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-[color-mix(in_oklab,var(--success)_30%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_6%,transparent)] px-4 py-3">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--success)]" />
            <p className="text-xs text-[var(--success)]">
              {userId ? "This invitation will only be accepted by the invited email address." : "Redirecting you to sign in or sign up with the invited email address."}
            </p>
          </div>

          {userId && viewerEmail && !viewerHasMatchingEmail ? (
            <div className="mb-4 rounded-xl border border-[color-mix(in_oklab,var(--warning)_28%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_8%,transparent)] px-4 py-3 text-xs text-[var(--warning)]">
              You are signed in as {viewerEmail}, but this invitation is for {invitation.email}. Switch to an account that has that email attached.
            </div>
          ) : null}

          {/* CTA */}
          <div className="space-y-3">
            <Button
              onClick={userId ? undefined : handleJoin}
              className="w-full cursor-pointer"
              disabled={redeeming || Boolean(userId)}
            >
              {redeeming ? "Joining..." : userId ? "Checking invitation..." : `Continue to join ${invitation.orgName ?? "School"}`}
            </Button>
            {!userId ? (
              <Button onClick={handleSignIn} variant="secondary" className="w-full cursor-pointer">
                Sign in with existing account
              </Button>
            ) : viewerEmail && !viewerHasMatchingEmail ? (
              <Button
                variant="secondary"
                className="w-full cursor-pointer"
                onClick={() => void handleSwitchAccount()}
              >
                Switch account
              </Button>
            ) : null}
          </div>

          {redeemState.message ? (
            <div className="mt-4 rounded-xl border border-[color-mix(in_oklab,var(--warning)_28%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_8%,transparent)] px-4 py-3 text-xs text-[var(--warning)]">
              {redeemState.message}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function JoinPageContentWithClerk() {
  const { isLoaded, userId } = useAuth();
  return <JoinPageContent isLoaded={isLoaded} userId={userId ?? null} />;
}

export default function JoinPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
        <SpectraLogo size={32} className="animate-pulse" />
      </div>
    }>
      {hasClerkPublishableKey() ? (
        <JoinPageContentWithClerk />
      ) : (
        <JoinPageContent isLoaded userId={null} />
      )}
    </Suspense>
  );
}
